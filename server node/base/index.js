import express from "express";
import os from "os";
import fs from "fs";
import path from "path";
import multer from "multer";
import { spawn } from "child_process";
import * as url from "url";
import http from "http";
import { WebSocketServer } from "ws";
import axios from "axios";
import crypto from "crypto";
import disk from "diskusage";
import archiver from "archiver";
import unzipper from "unzipper";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
const PORT = 3031; // node port
const PORT2 = 3032; // wss port
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ port: PORT2,

  verifyClient: (info, done) => {
    const origin = info.origin;
    // allow localhost:3031
    if (origin != "http://localhost:" + PORT2) done(true);
    else done(false, 403, "Forbidden");
  }

 });



let nodename = "";

app.use(express.json());
app.use(express.static(path.join(__dirname, "assets")));
const upload = multer({ dest: "uploads/" });

// ------------------------ Persistent Config ------------------------
const cfgPath = path.join(__dirname, "cfg.json");
let cfg = {
  keyphrase: "",
};

let tokens1 = [];
let stringtokens = "";

let allowedidsstring = "";

// Load if exists
if (fs.existsSync(cfgPath)) {
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    console.log(`[Node] Loaded keyphrase from cfg.json`);
  } catch (err) {
    console.error(`[Node] Failed to parse cfg.json:`, err);
  }
}

// Generate new keyphrase if missing
if (!cfg.keyphrase || cfg.keyphrase.trim() === "") {
  cfg.keyphrase = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  console.log(`[Node] Generated new keyphrase: ${cfg.keyphrase}`);
}

// ------------------------ Node Identity ------------------------
let tokens = "";
let myip = "";
let instancePath = "";
let allProcesses = [];
let instances2 = fs.readdirSync(path.join(__dirname, "instances"));
for (let i = 0; i < instances2.length; i++) {
  instances2[i] = path.join(__dirname, "instances", instances2[i], "server");
  allProcesses.push("null");
}
let currentArgs = "";
let status = 0;


// ------------------------ Utility ------------------------
async function getPublicIP() {
  const response = await fetch("https://api.ipify.org");
  return await response.text();
}

async function registerWithPanel() {
  try {
    myip = await getPublicIP();
    await axios.post(`${PANEL_URL}/linkNode`, {
      ip: myip + ":" + PORT,
      secret: cfg.keyphrase,
      name: os.hostname(),
    }, {
      headers: { "x-password": PANEL_PASSWORD }
    });
    console.log(`[Node] Registered with panel at ${PANEL_URL}`);
  } catch (err) {
    console.log(`[Node] Registration failed: ${err.message}`);
  }
}

function resolvePath(userPath) {
  if (!userPath) throw new Error("Invalid path");
  const fullPath = path.resolve(instancePath, userPath);
  const relative = path.relative(instancePath, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Access denied");
  return fullPath;
}

// ------------------------ PING ------------------------
app.get("/ping", (req, res) => {
  console.log("pinged");

  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();

  let drivePath;
  if (os.platform() === "win32") {
    drivePath = path.parse(__dirname).root.replace(/\\$/, "");
  } else {
    drivePath = "/";
  }

  let totalDiskSpace = 0;
  let freeDiskSpace = 0;
  let pcount = 0;

  try {
    const info = disk.checkSync(drivePath);
    totalDiskSpace = info.total || 0;
    freeDiskSpace = info.available || 0;
  } catch (err) {
    console.error("[ping] disk.checkSync failed:", err.message);
    // still respond with zeros
  }

  try {
    for (const proc of allProcesses) {
      if (proc && proc !== "null") pcount++;
    }

    // Always use res.json() (adds headers + end() automatically)
    res.json({
      totalMemory,
      freeMemory,
      totalDiskSpace,
      freeDiskSpace,
      processes: `${pcount}/${allProcesses.length}`,
    });
  } catch (err) {
    // If something fails here, make absolutely sure we close the socket
    console.error("[ping] Response send failed:", err.message);
    try {
      res.status(500).json({
        totalMemory,
        freeMemory,
        totalDiskSpace: 0,
        freeDiskSpace: 0,
        processes: "0/0",
        error: err.message,
      });
    } catch {
      // fallback close
      res.end();
    }
  }
});

// ------------------------ TOKEN SYNC ------------------------
app.post("/token", (req, res) => {
  const headerSecret = req.headers["secret"];
  if (headerSecret !== cfg.keyphrase) return res.status(401).send("Invalid secret");
  stringtokens = req.body.token;
  nodename = req.body.name;
  console.log(`[Node] Tokens updated`);
  console.log(nodename);
  res.send("Token synced");
});

// ------------------------ FILE OPS ------------------------
app.get("/files", (req, res) => {
  if (!checkPassword(req, res))
    return res.status(401).send("Unauthorized: wrong password");
  const relPath = req.query.path || "";
  try {
    const dirPath = resolvePath(relPath || ".");
    const files = fs.readdirSync(dirPath, { withFileTypes: true }).map(f => ({
      name: f.name,
      isDirectory: f.isDirectory(),
      size: f.isFile() ? fs.statSync(path.join(dirPath, f.name)).size : 0
    }));
    res.json(files);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.delete("/files/*", (req, res) => {
  if (!checkPassword(req, res))
    return res.status(401).send("Unauthorized: wrong password");
  try {
    const target = resolvePath(req.params[0]);
    if (!fs.existsSync(target)) return res.status(404).send("Not found");
    const stats = fs.statSync(target);
    if (stats.isDirectory()) {
      if (fs.readdirSync(target).length > 0)
        return res.status(400).send("Dir not empty");
      fs.rmdirSync(target);
    } else fs.unlinkSync(target);
    res.send("Deleted");
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.post("/files/upload/*", upload.single("file"), (req, res) => {
  if (!checkPassword(req, res)) return;

  const file = req.file;
  if (!file) return res.status(400).send("No file uploaded");

  let relPath = req.params[0] || ""; // nothing after /upload/

  try {
    // If no relPath or ends with '/', append original filename
    if (!relPath || relPath.endsWith("/")) relPath += file.originalname;

    const destPath = resolvePath(relPath);
    const parentDir = path.dirname(destPath);

    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

    fs.renameSync(file.path, destPath);
    res.send("Upload successful");
  } catch (e) {
    console.error("Upload error:", e);
    try {
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch (_) {}
    res.status(500).send("Failed to move uploaded file: " + e.message);
  }
});

app.get("/files/read/*", (req, res) => {
  if (!checkPassword(req, res))
    return res.status(401).send("Unauthorized: wrong password");
  try {
    const p = resolvePath(req.params[0]);
    if (!fs.existsSync(p)) return res.status(404).send("Not found");
    res.send(fs.readFileSync(p, "utf-8"));
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.post("/files/save/*", (req, res) => {
  if (!checkPassword(req, res))
    return res.status(401).send("Unauthorized: wrong password");
  const relPath = req.params[0];
  try {
    const dest = resolvePath(relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, req.body.content || "", "utf-8");
    res.send("Saved");
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.post("/files/create", express.json(), (req, res) => {
  if (!checkPassword(req, res)) return;

  const { name, content } = req.body;
  if (!name) return res.status(400).send("Missing file name");

  try {
    const filePath = resolvePath(name);
    const hasExtension = name.includes(".");
    const isDir = !hasExtension;

    if (isDir) {
      if (fs.existsSync(filePath))
        return res.status(400).send("Directory already exists");
      fs.mkdirSync(filePath, { recursive: true });
    } else {
      if (fs.existsSync(filePath))
        return res.status(400).send("File already exists");
      // Ensure parent dir exists
      const p = path.dirname(filePath);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
      fs.writeFileSync(filePath, content || "", "utf-8");
    }

    res.send(
      isDir ? "Directory created successfully" : "File created successfully"
    );
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.post("/files/rename", express.json(), (req, res) => {
  if (!checkPassword(req, res)) return;

  let { filepath, newPath } = req.body;
  if (!filepath || !newPath)
    return res.status(400).send("Missing filepath or newPath");

  // Trim any trailing slashes
  filepath = filepath.replace(/[/\\]+$/, "");
  newPath = newPath.replace(/[/\\]+$/, "");

  try {
    const src = resolvePath(filepath);
    const dest = resolvePath(newPath);

    // Prevent overwriting server directory
    const serverDirResolved = path.resolve(instancePath);
    if (
      path.resolve(src) === serverDirResolved ||
      path.resolve(dest) === serverDirResolved
    ) {
      return res.status(403).send("Refusing to rename/move server directory");
    }

    // Check if source exists
    if (!fs.existsSync(src))
      return res.status(404).send("Source file or directory does not exist");

    // Ensure parent directory exists for destination
    const parentDir = path.dirname(dest);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

    // Ensure destination does not exist
    if (fs.existsSync(dest))
      return res.status(400).send("Destination already exists");

    // Rename/move
    fs.renameSync(src, dest);

    res.send("Rename/move successful");
  } catch (err) {
    console.error("Rename/move error:", err);
    res.status(500).send("Failed to rename/move: " + err.message);
  }
});

// ===== READ FILE (FOR EDITING) =====
app.get("/files/read/*", (req, res) => {
  if (!checkPassword(req, res)) return;

  try {
    const relPath = req.params[0]; // Express wildcard param
    if (!relPath) return res.status(400).send("Missing file path");

    const filePath = resolvePath(relPath);

    // Check if path exists
    if (!fs.existsSync(filePath)) return res.status(404).send("File not found");

    // Ensure it is a file
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) return res.status(400).send("Path is not a file");

    // Read file content
    const content = fs.readFileSync(filePath, "utf-8");
    res.send(content);
  } catch (e) {
    console.error("Read file error:", e);
    res.status(500).send("Failed to read file: " + e.message);
  }
});

app.get("/files/download/*", async (req, res) => {
  if (!checkPassword(req, res)) return;

  let relPath = req.params[0];
  if (!relPath || relPath === "/") relPath = "";
  
  try {
    let filePath = instancePath;
    if(relPath != "")
    {
      filePath = resolvePath(relPath);
    }
    

    if (!fs.existsSync(filePath))
      return res.status(404).send("File not found");

    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      // Create a temporary zip file in the system temp directory
      const zipName = path.basename(filePath) + ".zip";
      const tempZipPath = path.join(os.tmpdir(), `${Date.now()}-${zipName}`);

      const output = fs.createWriteStream(tempZipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      archive.pipe(output);
      archive.directory(filePath, false);
      archive.finalize();

      output.on("close", () => {
        res.download(tempZipPath, zipName, (err) => {
          // Delete the temporary zip file after sending
          fs.unlink(tempZipPath, (unlinkErr) => {
            if (unlinkErr) console.error("Failed to delete temp zip:", unlinkErr);
          });

          if (err) {
            console.error("Download error:", err);
            if (!res.headersSent)
              res.status(500).send("Failed to download zip: " + err.message);
          }
        });
      });

      archive.on("error", (err) => {
        console.error("Archive error:", err);
        res.status(500).send("Error creating zip: " + err.message);
      });
    } else {
      // Handle normal file download
      res.download(filePath, path.basename(filePath), (err) => {
        if (err) {
          console.error("Download error:", err);
          if (!res.headersSent)
            res.status(500).send("Failed to download file: " + err.message);
        }
      });
    }
  } catch (e) {
    console.error("Download exception:", e);
    res.status(500).send("Error processing download: " + e.message);
  }
});

app.get("/files/extract/*", async (req, res) => {
  if (!checkPassword(req, res)) return;

  const relPath = req.params[0];
  if (!relPath) return res.status(400).send("Missing file path");

  try {
    const filePath = resolvePath(relPath);

    if (!fs.existsSync(filePath))
      return res.status(404).send("File not found");

    if (fs.statSync(filePath).isDirectory())
      return res.status(400).send("Cannot extract a directory");

    if (path.extname(filePath).toLowerCase() !== ".zip")
      return res.status(400).send("File is not a ZIP archive");

    const extractDir = path.dirname(filePath);

    // Create read stream and unzip to directory
    fs.createReadStream(filePath)
      .pipe(unzipper.Extract({ path: extractDir }))
      .on("close", () => {
        res.send(`Successfully extracted to ${extractDir}`);
      })
      .on("error", (err) => {
        console.error("Extraction error:", err);
        res.status(500).send("Failed to extract zip: " + err.message);
      });
  } catch (e) {
    console.error("Extract exception:", e);
    res.status(500).send("Error processing extraction: " + e.message);
  }
});

// ------------------------ INSTANCE OPS ------------------------
function getLatestInstance() {
  const instances = fs.readdirSync(path.join(__dirname, "instances"));
  if (instances.length === 0) return "server";
  return instances.sort((a, b) => {
    const aDate = fs.statSync(path.join(__dirname, "instances", a)).mtime;
    const bDate = fs.statSync(path.join(__dirname, "instances", b)).mtime;
    return bDate - aDate;
  })[0];
}

if (!fs.existsSync(path.join(__dirname, "instances")))
  fs.mkdirSync(path.join(__dirname, "instances"), { recursive: true });
instancePath = path.join(__dirname, "instances", getLatestInstance(), "server");
if (!fs.existsSync(instancePath)) fs.mkdirSync(instancePath, { recursive: true });

allProcesses = fs
  .readdirSync(path.join(__dirname, "instances"))
  .map(i => "null");

function curInstId() {
  const list = fs.readdirSync(path.join(__dirname, "instances"));
  console.log(list.indexOf(path.basename(path.dirname(instancePath))));
  return list.indexOf(path.basename(path.dirname(instancePath)));
}

app.get("/instanceList", (req, res) => {
  //console.log("instanceList: " + instances2);
  const instances = fs.readdirSync(path.join(__dirname, "instances"));

  //return each folder name and the description.txt inside each folder
  let instanceList = instances.map((instance) => {
    const descriptionPath = path.join(
      __dirname,
      "instances",
      instance,
      "description.txt"
    );
    let description = "";
    if (fs.existsSync(descriptionPath)) {
      description = fs.readFileSync(descriptionPath, "utf-8");
    } else {
      fs.writeFileSync(descriptionPath, "");
    }
    return { name: instance, description };
  });

  let instison = [];
  for (var i = 0; i < instanceList.length; i++) {
    if (allProcesses[i] == "null" || null) {
      instanceList[i]["online"] = false;
    } else {
      instanceList[i]["online"] = true;
    }
    instanceList[i]["node"] = nodename;
    instanceList[i]["ip"] = myip + ":" + PORT;
  }

  //for each instance retrive instances/instancename/server/server.properties
  for (let i = 0; i < instanceList.length; i++) {
    const serverPropertiesPath = path.join(
      __dirname,
      "instances",
      instanceList[i].name,
      "server",
      "server.properties"
    );

    if (fs.existsSync(serverPropertiesPath)) {
      const serverProperties = fs.readFileSync(serverPropertiesPath, "utf-8");

      // Normalize line endings and trim
      const lines = serverProperties.replace(/\r/g, "").split("\n");

      // Find the line starting with 'server-port=' (ignoring whitespace)
      const portLine = lines.find((line) =>
        line.trim().startsWith("server-port=")
      );

      if (portLine) {
        const port = portLine.split("=")[1].trim();
        instanceList[i].port = port || null;
      } else {
        instanceList[i].port = null;
      }
    } else {
      instanceList[i].port = null;
    }
  }

  res.json({
    instances: instanceList,
  });
});

app.post("/instanceCreate", upload.single("file"), (req, res) => {
  console.log("create");
  if (!checkPassword(req, res))
    return res.status(401).send("Unauthorized: wrong password");
  const name = req.body.name;
  const desc = req.body.description;
  if (!req.file || !name) return res.status(400).send("Missing fields");
  const baseDir = path.join(__dirname, "instances", name);
  fs.mkdirSync(path.join(baseDir, "server"), { recursive: true });
  fs.mkdirSync(path.join(baseDir, "backups"), { recursive: true });
  fs.renameSync(req.file.path, path.join(baseDir, "server", "server.jar"));
  fs.writeFileSync(path.join(baseDir, "description.txt"), desc);
  res.send("Instance created");
});

app.post("/instanceCopy", upload.single("file"), (req, res) => {
  if (!checkPassword(req, res))
    return res.status(401).send("Unauthorized: wrong password");

  const name = req.body.name;

  if (!name) return res.status(400).send("name is required");

  try {
    const baseDir = path.join(__dirname, "instances", name);
    const copyDir = path.join(__dirname, "instances", name + "-copy");
    fs.mkdirSync(path.join(baseDir, "server"), { recursive: true });
    fs.mkdirSync(path.join(baseDir, "backups"), { recursive: true });

    fs.cpSync(path.join(baseDir, "server"), path.join(copyDir, "server"), {
      recursive: true,
    });

    fs.cpSync(
      path.join(baseDir, "description.txt"),
      path.join(copyDir, "description.txt"),
      { recursive: true }
    );
    fs.cpSync(path.join(baseDir, "cfg.json"), path.join(copyDir, "cfg.json"), {
      recursive: true,
    });

    res.send("Copy successful");
  } catch (e) {
    res.status(500).send("Failed to upload file: " + e.message);
  }
});

app.post("/instanceDel", (req, res) => {
  if (!checkPassword(req, res))
    return res.status(401).send("Unauthorized: wrong password");
  const name = req.body.name;
  try {
    fs.rmSync(path.join(__dirname, "instances", name), { recursive: true, force: true });
    res.send("Instance deleted");
  } catch (e) {
    res.status(500).send(e.message);
  }
});

function getInstNameFromPath(pth)
{
  //path is like E:\downloads\AnotherAdminPannel-main\AnotherAdminPannel-main\instances\test\server
  //return test

  return path.basename(path.dirname(pth));
}

app.post("/setInstance", (req, res) => {
  if (!checkPassword(req, res))
    return res.status(401).send("Unauthorized: wrong password");
  const name = req.body.name;
  instancePath = path.join(__dirname, "instances", name, "server");
  res.send("Instance switched");
});

app.get("/currentInstInfo", (req, res) => {
  console.log(instancePath.split("/")[instancePath.split("/").length - 2]);

  const instanceDir = path.basename(path.dirname(instancePath));

  if (!fs.existsSync(path.join(__dirname, "instances", instanceDir))) {
    instancePath = path.join(
      __dirname,
      "instances/" + getLatestInstance() + "/server"
    );
  }
  const descriptionPath = path.join(
    __dirname,
    "instances",
    instanceDir,
    "description.txt"
  );

  let isOnline = false;
    //look through all processes and match to instance names
    for (let i = 0; i < allProcesses.length; i++) {
      if(getInstNameFromPath(instances2[i]) == instanceDir && allProcesses[i] != "null") {
        isOnline = true;
        break;
      }
      //console.log(instances2[i] + " " + instanceDir);
    }

  res.send(
    JSON.stringify({
      name: instanceDir,
      desc: fs.readFileSync(descriptionPath, "utf-8"),
      node: nodename,
      ip: myip + ":" + PORT,
      wsip: myip + ":" + PORT2,
      isOnline: isOnline
    })
  );
});

app.get("/instanceIcon", (req, res) => {
  const name = req.query.name;
  const iconPath = path.join(
    __dirname,
    "instances",
    name,
    "server/server-icon.png"
  );
  if (fs.existsSync(iconPath)) {
    res.sendFile(iconPath);
  } else {
    try {
      res.sendFile(path.join(__dirname, "assets/pack.png"));
    } catch (e) {
      res.status(500).send("Error" + e.message);
    }
  }
});

function getInstanceName() {
  return path.basename(path.dirname(instancePath));
}

app.post("/mrdl", async (req, res) => {
  if (!checkPassword(req, res))
    return res.status(401).send("Unauthorized: wrong password");

  const link = req.body.link;
  if (!link) return res.status(400).send("Missing name, description, or link");

  const baseDir = path.join(
    __dirname,
    "instances",
    getInstanceName(),
    "server"
  );

  try {
    fs.mkdirSync(path.join(baseDir, "plugins"), { recursive: true });

    const fileName = path.basename(link.split("?")[0]);
    const destPath = path.join(baseDir, "plugins", fileName);

    console.log(`Downloading file from body link: ${link}`);

    // Download the file
    const response = await fetch(link);
    if (!response.ok)
      throw new Error(`Failed to fetch file: ${response.statusText}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destPath, buffer);

    res.send("✅ Download and setup successful");
  } catch (e) {
    console.error(e);
    res.status(500).send("Failed to download or save file: " + e.message);
  }
});

function checkPassword(req, res) {
  const pw = req.headers["x-password"] || "";
  if (!stringtokens.includes("," + pw + ",")) {
    res.status(401).send("Unauthorized: wrong password");
    console.log(stringtokens + " " + pw);
    return false;
  }
  return true;
}



// ------------------------ TERMINAL OPS ------------------------
const authorizedClients = new Set();





app.get("/terminal", (req, res) => {
  if (!checkPassword(req, res)) return;

  const cmd = req.query.cmd;
  if (!cmd) return res.status(400).send("Missing ?cmd parameter");

  if (cmd === "start") {
    if (allProcesses[curInstId()] != "null")
      return res.send("Server already running.");

    const jarPath = path.join(instancePath, "server.jar");
    if (!fs.existsSync(jarPath))
      return res.status(404).send("server.jar not found in /server");

    allProcesses[curInstId()] = spawn(
      "java",
      [currentArgs + " -jar", "server.jar nogui"],
      {
        cwd: path.join(instancePath),
        shell: true,
      }
    );

    status = 1;

    allProcesses[curInstId()].stdout.on("data", (data) => broadcastConsole(data.toString()));
    //allProcesses[curInstId()].stdout.on("data", (data) => console.log(data.toString()));
    //allProcesses[curInstId()].stderr.on("data", (data) => console.log(data.toString()));
    allProcesses[curInstId()].stderr.on("data", (data) => broadcastConsole(data.toString()));

    allProcesses[curInstId()].on("close", (code) => {
      broadcastConsole(`Server stopped (exit code ${code})`);
      allProcesses[curInstId()] = "null";
      status = 0;
    });

    return res.send("Started paper.jar");
  }

  if (cmd === "stop") {
    if (allProcesses[curInstId()] == "null")
      return res.send("Server not running.");
    allProcesses[curInstId()].stdin.write("stop\n");
    return res.send("Stopping server...");
  }

  return res.status(400).send("Invalid command. Use start or stop.");
});

wss.on("connection", (ws) => {
  let isAuthorized = false;

  ws.send(
    JSON.stringify({
      type: "info",
      data: "Connected to console. Please authenticate 11111.",
    })
  );

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      ws.send(
        JSON.stringify({ type: "info", data: "Invalid message format." })
      );
      return;
    }

    // --- Authentication ---
    if (data.type === "auth") {
      if (stringtokens.includes("," + data.password + ",")) {
        
        isAuthorized = true;
        authorizedClients.add(ws);
        ws.send(JSON.stringify({ type: "auth", success: true }));
        ws.send(
          JSON.stringify({
            type: "info",
            data: "Authorized. Console access granted. Connected on " + myip + ":" + PORT,
          })
        );
      } else {
        ws.send(JSON.stringify({ type: "auth", success: false }));
        ws.send(JSON.stringify({ type: "info", data: "Unauthorized" }));
        ws.close();
      }
      return;
    }

    // --- Require authorization ---
    if (!isAuthorized) {
      ws.send(JSON.stringify({ type: "info", data: "Unauthorized" }));
      ws.close();
      return;
    }

    // --- Handle commands ---
    if (
      data.type === "cmd" &&
      allProcesses[curInstId()] &&
      allProcesses[curInstId()].stdin.writable
    ) {
      allProcesses[curInstId()].stdin.write(data.data + "\n");
    }
  });

  ws.on("close", () => {
    authorizedClients.delete(ws);
    console.log("Client disconnected");
  });
});

function broadcastConsole(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {  // only check readyState
      client.send(JSON.stringify({ type: "console", data: message }));
    }
  });
}

// ------------------------ START ------------------------
server.listen(PORT, async () => {
  console.log(`[Node] Running at http://localhost:${PORT}`);
  await registerWithPanel();
});
