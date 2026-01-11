import express from "express";
import os from "os";
import fs from "fs";
import path from "path";
import multer from "multer";
import { exec, spawn } from "child_process";
import * as url from "url";
import http, { get } from "http";
import { WebSocketServer } from "ws";
import axios from "axios";
import crypto from "crypto";
import { json } from "stream/consumers";
import { constrainedMemory } from "process";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3030;


app.use(express.json());

app.use(express.static(path.join(__dirname, "assets")));

let tokens = [];
let stringtokens="";

let allowedidsstring="";
//discord client auth instead of a standard login. read client id and secret from loginCfg.json
let clientId = JSON.parse(fs.readFileSync(path.join(__dirname, "loginCfg.json"), 'utf-8')).clientId || "discord client id";
let clientSecret = JSON.parse(fs.readFileSync(path.join(__dirname, "loginCfg.json"), 'utf-8')).clientSecret || "discord client secret";

const upload = multer({ dest: "uploads/" });

let instancePath = path.join(__dirname, "instances/server/server");

let currentArgs = "-Xmx10000M -Xms10000M";

//return folder in instances that is the most recently updated
function getLatestInstance() {
  const instances = fs.readdirSync(path.join(__dirname, "instances"));
  if (instances.length === 0) return "server";

  const sortedInstances = instances.sort((a, b) => {
    const aDate = fs.statSync(path.join(__dirname, "instances", a)).mtime;
    const bDate = fs.statSync(path.join(__dirname, "instances", b)).mtime;
    return bDate - aDate;
  });
  return sortedInstances[0];
}

//if exists, remove empty.txt from instances folder
if(fs.existsSync(path.join(__dirname, "instances", "empty.txt")))
{
  fs.unlinkSync(path.join(__dirname, "instances", "empty.txt"));
}

instancePath = path.join(__dirname, "instances/" + getLatestInstance() + "/server");

function instanceRoot() {
  const lastFolder = path.basename(instancePath);
  if(lastFolder === undefined || lastFolder === '')
  {
    return path.join(__dirname, "instances");
  }
  else
  {
    return path.dirname(instancePath);
  }
}

function getInstanceName()
{
  return path.basename(path.dirname(instancePath));
}

let currentArgsBuffer = "";

if(fs.existsSync(path.join(instanceRoot(), "cfg.json")))
{
  currentArgsBuffer = fs.readFileSync(path.join(instanceRoot(), "cfg.json"), "utf-8");
  currentArgs = JSON.parse(currentArgsBuffer).args;
}
else
{
  currentArgs = "";
}



let status = 0;

// ==================== SERVER CONTROL ====================
let jarProcess = null;
let allProcesses = [];
let instances2 = fs.readdirSync(path.join(__dirname, "instances"));
for (let i = 0; i < instances2.length; i++) {
  instances2[i] = path.join(__dirname, "instances", instances2[i], "server");
  allProcesses.push("null");
}

// Start the Minecraft server

function curInstId()
{
  return instances2.indexOf(instancePath);
}


// ===== TERMINAL ENDPOINT =====
app.get("/terminal", (req, res) => {
  if (!checkPassword(req, res)) return;

  const cmd = req.query.cmd;
  if (!cmd) return res.status(400).send("Missing ?cmd parameter");

  if (cmd === "start") {
    if (allProcesses[curInstId()] != "null") return res.send("Server already running.");

    const jarPath = path.join(instancePath, "server.jar");
    if (!fs.existsSync(jarPath))
      return res.status(404).send("server.jar not found in /server");

    allProcesses[curInstId()] = spawn("java", [currentArgs + " -jar", "server.jar nogui"], {
      cwd: path.join(instancePath),
      shell: true,
    });

    status = 1;

    allProcesses[curInstId()].stdout.on("data", (data) => broadcastConsole(data.toString()));
    allProcesses[curInstId()].stderr.on("data", (data) => broadcastConsole(data.toString()));

    allProcesses[curInstId()].on("close", (code) => {
      broadcastConsole(`Server stopped (exit code ${code})`);
      allProcesses[curInstId()] = "null";
      status = 0;
    });

    return res.send("Started paper.jar");
  }

  if (cmd === "stop") {
    if (allProcesses[curInstId()] == "null") return res.send("Server not running.");
    allProcesses[curInstId()].stdin.write("stop\n");
    return res.send("Stopping server...");
  }

  return res.status(400).send("Invalid command. Use start or stop.");
});

// ===== WEBSOCKET TERMINAL =====


const authorizedClients = new Set();

// ========== WEBSOCKET TERMINAL ==========
wss.on("connection", (ws) => {
  let isAuthorized = false;

  ws.send(JSON.stringify({ type: "info", data: "Connected to console. Please authenticate." }));

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      ws.send(JSON.stringify({ type: "info", data: "Invalid message format." }));
      return;
    }

    // --- Authentication ---
    if (data.type === "auth") {
      if (stringtokens.includes("," + data.password + ",") ) {
        isAuthorized = true;
        authorizedClients.add(ws);
        ws.send(JSON.stringify({ type: "auth", success: true }));
        ws.send(JSON.stringify({ type: "info", data: "Authorized. Console access granted." }));
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
    if (data.type === "cmd" && allProcesses[curInstId()] && allProcesses[curInstId()].stdin.writable) {
      allProcesses[curInstId()].stdin.write(data.data + "\n");
    }
  });

  ws.on("close", () => {
    authorizedClients.delete(ws);
    console.log("Client disconnected");
  });
});

// --- Broadcast console output only to authorized clients ---
function broadcastConsole(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && authorizedClients.has(client)) {
      client.send(JSON.stringify({ type: "console", data: message }));
    }
  });
}

// ===== PASSWORD PROTECTION =====
 // <-- set your password here
//const SERVER_DIR = path.join(__dirname, 'server');

function checkPassword(req, res) {
  
  const pw = req.headers['x-password'] || '';
  if (!stringtokens.includes("," + pw + ",")) {
    res.status(401).send("Unauthorized: wrong password");
    console.log(stringtokens + " " + pw);
    return false;
  }
  return true;
}


function makeid(length, seed = '') {
  var result           = '';
  var characters       = seed + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var charactersLength = characters.length;
  var random = crypto.createHash('sha256').update(seed).digest();
  for ( var i = 0; i < length; i++ ) {
     result += characters.charAt(parseInt(random.slice(i*2, (i+1)*2), 16) % charactersLength);
  }
  return result;
}


// ----- secure path resolver -----
function resolvePath(userPath) {
  if (!userPath) throw new Error("Invalid path");

  // Resolve relative to SERVER_DIR
  const fullPath = path.resolve(instancePath, userPath);

  // Ensure the resolved path is inside the server dir
  // Use path.relative to avoid prefix-matching pitfalls (e.g. /srv/server vs /srv/server2)
  const relative = path.relative(instancePath, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Access denied");
  }

  return fullPath;
}

app.get('/currentInstInfo', (req, res) => {
  console.log(instancePath.split("/")[instancePath.split("/").length - 2],);

  

  const instanceDir = path.basename(path.dirname(instancePath));

  if (!fs.existsSync(path.join(__dirname, "instances", instanceDir)))
  {
    instancePath = path.join(__dirname, "instances/" + getLatestInstance() + "/server");
  }
  const descriptionPath = path.join(__dirname, "instances", instanceDir, "description.txt");

  res.send(
    JSON.stringify({
      name: instanceDir,
      desc: fs.readFileSync(descriptionPath, "utf-8"),
    })
  );
});

// List files in a directory
// List files in a directory (now uses resolvePath)
app.get('/files', (req, res) => {
  if (!checkPassword(req, res)) return;

  const relPath = req.query.path || '';
  let dirPath;
  try {
    dirPath = resolvePath(relPath || '.'); // default to SERVER_DIR
  } catch (e) {
    return res.status(403).send(e.message);
  }

  if (!fs.existsSync(dirPath)) return res.status(404).send("Directory not found");

  fs.readdir(dirPath, { withFileTypes: true }, (err, files) => {
    if (err) return res.status(500).send("Failed to list files");

    const output = files.map(f => ({
      name: f.name,
      isDirectory: f.isDirectory(),
      size: f.isFile() ? fs.statSync(path.join(dirPath, f.name)).size : 0
    }));

    res.json(output); // MUST be an array
  });
});

// ===== DELETE FILE ===== (now uses resolvePath and blocks deleting server dir)
app.delete('/files/*', (req, res) => {
  if (!checkPassword(req, res)) return;

  const relPath = req.params[0];
  if (!relPath) return res.status(400).send("Missing file path");

  try {
    const targetPath = resolvePath(relPath);

    // Prevent deleting the main server directory
    if (path.resolve(targetPath) === path.resolve(instancePath)) {
      return res.status(403).send("Refusing to delete server directory");
    }

    if (!fs.existsSync(targetPath)) return res.status(404).send("File or directory not found");

    const stats = fs.statSync(targetPath);

    if (stats.isDirectory()) {
      // Only allow deleting an empty directory by default
      const files = fs.readdirSync(targetPath);
      if (files.length > 0) {
        return res.status(400).send("Directory is not empty. Delete files inside first.");
      }
      fs.rmdirSync(targetPath);
      return res.send("Empty directory deleted successfully");
    } else {
      fs.unlinkSync(targetPath);
      return res.send("File deleted successfully");
    }

  } catch (e) {
    res.status(500).send("Failed to delete: " + e.message);
  }
});

// ===== UPLOAD FILE ===== (use resolvePath for destination file)
// ===== UPLOAD FILE TO SPECIFIED PATH =====
app.post('/files/upload/*', upload.single('file'), (req, res) => {
  if (!checkPassword(req, res)) return;

  const file = req.file;
  if (!file) return res.status(400).send("No file uploaded");

  const relPath = req.params[0]; // path after /upload/
  if (!relPath) return res.status(400).send("Specify target location after /upload/");

  try {
    // If path ends with '/', append original filename
    const targetPath = relPath.endsWith('/') ? `${relPath}${file.originalname}` : relPath;
    const destPath = resolvePath(targetPath);

    const parentDir = path.dirname(destPath);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

    fs.renameSync(file.path, destPath);
    res.send("Upload successful");
  } catch (e) {
    try { if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (_) {}
    res.status(500).send("Failed to move uploaded file: " + e.message);
  }
});


// ===== CREATE NEW FILE ===== (use resolvePath)
app.post('/files/create', express.json(), (req, res) => {
  if (!checkPassword(req, res)) return;

  const { name, content } = req.body;
  if (!name) return res.status(400).send("Missing file name");

  try {
    const filePath = resolvePath(name);
    const hasExtension = name.includes('.');
    const isDir = !hasExtension;

    if (isDir) {
      if (fs.existsSync(filePath)) return res.status(400).send("Directory already exists");
      fs.mkdirSync(filePath, { recursive: true });
    } else {
      if (fs.existsSync(filePath)) return res.status(400).send("File already exists");
      // Ensure parent dir exists
      const p = path.dirname(filePath);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
      fs.writeFileSync(filePath, content || '', 'utf-8');
    }

    res.send(isDir ? "Directory created successfully" : "File created successfully");
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ===== RENAME / MOVE FILE OR DIRECTORY =====
// ===== RENAME / MOVE FILE OR DIRECTORY (REVISED) =====
app.post('/files/rename', express.json(), (req, res) => {
  if (!checkPassword(req, res)) return;

  let { filepath, newPath } = req.body;
  if (!filepath || !newPath) return res.status(400).send("Missing filepath or newPath");

  // Trim any trailing slashes
  filepath = filepath.replace(/[/\\]+$/, '');
  newPath = newPath.replace(/[/\\]+$/, '');

  try {
    const src = resolvePath(filepath);
    const dest = resolvePath(newPath);

    // Prevent overwriting server directory
    const serverDirResolved = path.resolve(instancePath);
    if (path.resolve(src) === serverDirResolved || path.resolve(dest) === serverDirResolved) {
      return res.status(403).send("Refusing to rename/move server directory");
    }

    // Check if source exists
    if (!fs.existsSync(src)) return res.status(404).send("Source file or directory does not exist");

    // Ensure parent directory exists for destination
    const parentDir = path.dirname(dest);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

    // Ensure destination does not exist
    if (fs.existsSync(dest)) return res.status(400).send("Destination already exists");

    // Rename/move
    fs.renameSync(src, dest);

    res.send("Rename/move successful");
  } catch (err) {
    console.error("Rename/move error:", err);
    res.status(500).send("Failed to rename/move: " + err.message);
  }
});

// ===== READ FILE (FOR EDITING) =====
app.get('/files/read/*', (req, res) => {
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
    const content = fs.readFileSync(filePath, 'utf-8');
    res.send(content);
  } catch (e) {
    console.error("Read file error:", e);
    res.status(500).send("Failed to read file: " + e.message);
  }
});

// ===== CREATE OR EDIT FILE =====
// ===== CREATE OR EDIT FILE =====
app.post('/files/save/*', express.json(), (req, res) => {
  if (!checkPassword(req, res)) return;

  const content = req.body.content || '';
  // Extract relative file path from URL
  const relPath = req.params[0];
  if (!relPath) return res.status(400).send("Missing file name in URL");

  try {
    const filePath = resolvePath(relPath);

    // Prevent overwriting a directory
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      return res.status(400).send("Cannot overwrite a directory with a file");
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

    // Write file content
    fs.writeFileSync(filePath, content, 'utf-8');

    res.send("Saved successfully");
  } catch (e) {
    console.error("Save file error:", e);
    res.status(500).send("Failed to save file: " + e.message);
  }
});

// ===== DOWNLOAD FILE =====
app.get('/files/download/*', (req, res) => {
  if (!checkPassword(req, res)) return;

  // Capture everything after /files/download/
  const relPath = req.params[0];
  if (!relPath) return res.status(400).send("Missing file path");

  try {
    // Resolve the full path safely inside SERVER_DIR (supports subdirectories)
    const filePath = resolvePath(relPath);

    // Ensure the file exists
    if (!fs.existsSync(filePath))
      return res.status(404).send("File not found");

    // Prevent downloading directories
    if (fs.statSync(filePath).isDirectory())
      return res.status(400).send("Cannot download a directory");

    // Send file for download
    res.download(filePath, path.basename(filePath), (err) => {
      if (err) {
        console.error("Download error:", err);
        if (!res.headersSent)
          res.status(500).send("Failed to download file: " + err.message);
      }
    });
  } catch (e) {
    console.error("Download exception:", e);
    res.status(500).send("Error processing download: " + e.message);
  }
});




app.post('/instanceCreate', upload.single('file'), (req, res) => {
  if (!checkPassword(req, res)) return res.status(401).send("Unauthorized: wrong password");

  const name = req.body.name;
  const desc = req.body.description;
  const filePath = req.file?.path;

  if (!filePath || !name || !desc) return res.status(400).send("Both file and name and description are required");

  const baseDir = path.join(__dirname, "instances", name);
  if (fs.existsSync(baseDir)) return res.status(400).send(`Instance with name "${name}" already exists`);

  try {
    fs.mkdirSync(path.join(baseDir, "server"), { recursive: true });
    fs.mkdirSync(path.join(baseDir, "backups"), { recursive: true });

    let destPath = path.join(baseDir, "server", req.file.originalname);
    if(req.file.originalname.endsWith(".jar"))
    {
      destPath = path.join(baseDir, "server", "server.jar");
    }
    fs.renameSync(filePath, destPath);

    fs.writeFileSync(path.join(baseDir, "description.txt"), desc);

    fs.writeFileSync(path.join(baseDir, "cfg.json"), JSON.stringify({args: ""}));

    res.send("Upload successful");
  } catch (e) {
    res.status(500).send("Failed to upload file: " + e.message);
  }
});

app.post('/mrdl', async (req, res) => {
  if (!checkPassword(req, res)) return res.status(401).send("Unauthorized: wrong password");

  const link = req.body.link;
  if (!link)
    return res.status(400).send("Missing name, description, or link");

  const baseDir = path.join(__dirname, "instances", getInstanceName(), "server");
  

  try {
    fs.mkdirSync(path.join(baseDir, "plugins"), { recursive: true });

    const fileName = path.basename(link.split("?")[0]);
    const destPath = path.join(baseDir, "plugins", fileName);

    console.log(`Downloading file from body link: ${link}`);

    // Download the file
    const response = await fetch(link);
    if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destPath, buffer);

    res.send("✅ Download and setup successful");
  } catch (e) {
    console.error(e);
    res.status(500).send("Failed to download or save file: " + e.message);
  }
});


app.post('/instanceEdit', (req, res) => {
  if (!checkPassword(req, res)) return res.status(401).send("Unauthorized: wrong password");

  
  console.log(req.body);
  const name = req.body.name;
  const newdesc = req.body.newdesc;
  const newname = req.body.newname;

  if (!newname || !name || !newdesc) return res.status(400).send("all fields are required");

  try {
    const baseDir = path.join(__dirname, "instances", name);
    fs.writeFileSync(path.join(baseDir, "description.txt"), newdesc);

    fs.renameSync(baseDir, path.join(__dirname, "instances", newname));

    instancePath = path.join(__dirname, "instances", newname, "server");
    currentArgsBuffer = fs.readFileSync(path.join(instanceRoot(), "cfg.json"), "utf-8");
    currentArgs = JSON.parse(currentArgsBuffer).args;

    res.send("Edit successful");
  } catch (e) {
    res.status(500).send("Failed to edit: " + e.message);
  }
});

app.post('/instanceEditArgs', (req, res) => {
  if (!checkPassword(req, res)) return res.status(401).send("Unauthorized: wrong password");

  
  console.log(req.body);
  const name = req.body.name;
  let args = req.body.args;

  if (!name) return res.status(400).send("all fields are required");
  if (!args) args = "";

  try {
    const baseDir = path.join(__dirname, "instances", name);


    currentArgsBuffer = fs.readFileSync(path.join(instanceRoot(), "cfg.json"), "utf-8");
    currentArgsBuffer = JSON.parse(currentArgsBuffer)
    currentArgsBuffer.args = args;
    fs.writeFileSync(path.join(instanceRoot(), "cfg.json"), JSON.stringify(currentArgsBuffer));

    res.send("Edit successful");
  } catch (e) {
    res.status(500).send("Failed to edit: " + e.message);
  }
});


app.post('/instanceGetArgs', (req, res) => {
  if (!checkPassword(req, res)) return res.status(401).send("Unauthorized: wrong password");

  
  //console.log(req.body);
  const name = req.body.name;

  if (!name) return res.status(400).send("all fields are required");

  try {
    const baseDir = path.join(__dirname, "instances", name);


    currentArgsBuffer = fs.readFileSync(path.join(instanceRoot(), "cfg.json"), "utf-8");
    currentArgsBuffer = JSON.parse(currentArgsBuffer)
    res.send(JSON.stringify({args: currentArgsBuffer.args}));
  } catch (e) {
    res.status(500).send("Failed to send: " + e.message);
  }
});

app.post('/editAccess', (req, res) => {
  if (!checkPassword(req, res)) return res.status(401).send("Unauthorized: wrong password");

  console.log(req.body);
  const access = req.body.access;

  if (!access) return res.status(400).send("all fields are required");

  try {
    
    fs.writeFileSync(path.join(__dirname, "allowedids.txt"), access);

    res.send("Edit successful");
  } catch (e) {
    res.status(500).send("Failed to edit: " + e.message);
  }
});

app.post('/getAccess', (req, res) => {
  if (!checkPassword(req, res)) return res.status(401).send("Unauthorized: wrong password");

  
  

  

  try {
    
    let a = fs.readFileSync(path.join(__dirname, "allowedids.txt"), "utf-8");

    res.send(JSON.stringify({access: a}));
  } catch (e) {
    res.status(500).send("Failed to send: " + e.message);
  }
});

app.post('/instanceCopy', upload.single('file'), (req, res) => {
  if (!checkPassword(req, res)) return res.status(401).send("Unauthorized: wrong password");

  const name = req.body.name;
  

  if (!name) return res.status(400).send("name is required");

  try {
    const baseDir = path.join(__dirname, "instances", name);
    const copyDir = path.join(__dirname, "instances", name + "-copy");
    fs.mkdirSync(path.join(baseDir, "server"), { recursive: true });
    fs.mkdirSync(path.join(baseDir, "backups"), { recursive: true });

    fs.cpSync(path.join(baseDir, "server"), path.join(copyDir, "server"), { recursive: true });
    
    fs.cpSync(path.join(baseDir, "description.txt"), path.join(copyDir, "description.txt"), { recursive: true });   
    fs.cpSync(path.join(baseDir, "cfg.json"), path.join(copyDir, "cfg.json"), { recursive: true });   

    res.send("Copy successful");
  } catch (e) {
    res.status(500).send("Failed to upload file: " + e.message);
  }
});

app.post('/instanceDel', (req, res) => {
  if (!checkPassword(req, res)) return res.status(401).send("Unauthorized: wrong password");

  const name = req.body.name;
  

  if (!name) return res.status(400).send("name is required");
  console.log(name);
  console.log(getInstanceName());
  if(allProcesses[curInstId()] == null || name != getInstanceName())
  {
  try {
    const baseDir = path.join(__dirname, "instances", name);
    fs.mkdirSync(path.join(baseDir, "backups", name), { recursive: true });
    fs.cpSync(path.join(baseDir, "server"), path.join(__dirname, "backups", name), { recursive: true });
    //const copyDir = path.join(__dirname, "instances", name + "-copy");
    fs.rmSync(baseDir, { recursive: true, force: true });

    instancePath = path.join(__dirname, "instances/" + getLatestInstance() + "/server");
    res.send("Delete successful");
  } catch (e) {
    res.status(500).send("Failed to upload file: " + e.message);
  }
}
else
  {
    allProcesses[curInstId()].stdin.write("stop\n");
    res.status(500).send("Stopping current server first. Please wait.");
  }
});

app.get('/instanceList', (req, res) => {
  //console.log("instanceList: " + instances2);
  const instances = fs.readdirSync(path.join(__dirname, "instances"));

  //return each folder name and the description.txt inside each folder
  let instanceList = instances.map(instance => {
    const descriptionPath = path.join(__dirname, "instances", instance, "description.txt");
    let description = "";
    if (fs.existsSync(descriptionPath)) {
      description = fs.readFileSync(descriptionPath, 'utf-8');
    } else {
      fs.writeFileSync(descriptionPath, "");
    }
    return { name: instance, description };
  });

  let instison = [];
  for(var i = 0; i < instanceList.length; i++)
  {
    if(allProcesses[i] == "null" || null)
    {
      instanceList[i]["online"] = false;
    }
    else
    {
      instanceList[i]["online"] = true;
    }
  }

  //for each instance retrive instances/instancename/server/server.properties
for (let i = 0; i < instanceList.length; i++) {
  const serverPropertiesPath = path.join(__dirname, "instances", instanceList[i].name, "server", "server.properties");

  if (fs.existsSync(serverPropertiesPath)) {
    const serverProperties = fs.readFileSync(serverPropertiesPath, 'utf-8');
    
    // Normalize line endings and trim
    const lines = serverProperties.replace(/\r/g, '').split('\n');
    
    // Find the line starting with 'server-port=' (ignoring whitespace)
    const portLine = lines.find(line => line.trim().startsWith('server-port='));
    
    if (portLine) {
      const port = portLine.split('=')[1].trim();
      instanceList[i].port = port || null;
    } else {
      instanceList[i].port = null;
    }
  } else {
    instanceList[i].port = null;
  }
}

  res.json({
    instances: instanceList
  })
});

app.post('/setInstance', (req, res) => {

    if (!checkPassword(req, res)) return res.status(401).send("Unauthorized: wrong password");

    const name1 = req.body.name;
    //console.log(name1);

    if (!name1) return res.status(400).send("name is required");

    try {
      instancePath = path.join(__dirname, "instances", name1, "server");
      if(fs.existsSync(path.join(instanceRoot(), "cfg.json")) == false)
      {
        fs.writeFileSync(path.join(instanceRoot(), "cfg.json"), JSON.stringify({args: ""}));
      }
      currentArgsBuffer = fs.readFileSync(path.join(instanceRoot(), "cfg.json"), "utf-8");
      currentArgs = JSON.parse(currentArgsBuffer).args;

      res.header("Content-Type", "application/json");
      res.send(JSON.stringify({message: "Upload successful"}));
    } catch (e) {
      res.header("Content-Type", "application/json");
      res.status(500).send(JSON.stringify({message: "Error" + e.message}));
    }
});


app.get('/instanceIcon', (req, res) => {
  const name = req.query.name;
  const iconPath = path.join(__dirname, "instances", name, "server/server-icon.png");
  if (fs.existsSync(iconPath)) {
    res.sendFile(iconPath);
  } else {
    try
    {
      res.sendFile(path.join(__dirname, "assets/pack.png"));
    }
    catch(e)
    {
      res.status(500).send("Error" + e.message);
    }
  }
  });





// ==================== SYSTEM USAGE ====================
app.get("/ram-usage", (req, res) => {
  const totalRAM = os.totalmem();
  const freeRAM = os.freemem();
  res.json({
    totalRAM,
    freeRAM,
    usedRAM: totalRAM - freeRAM,
  });
});

app.get("/cpu-usage", async (req, res) => {
  function cpuAverage() {
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;

    cpus.forEach(core => {
      for (let type in core.times) {
        totalTick += core.times[type];
      }
      totalIdle += core.times.idle;
    });

    return { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
  }

  const start = cpuAverage();

  setTimeout(() => {
    const end = cpuAverage();
    const idleDiff = end.idle - start.idle;
    const totalDiff = end.total - start.total;
    const usage = 100 - (100 * idleDiff / totalDiff);

    res.json({ calculatedCpuUsage: parseFloat(usage.toFixed(1)) });
  }, 100); // sample 100ms interval
});

app.get('/', async (req, response) => {
	const { code } = req.query;

	if (code) {
		try {
			const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
				method: 'POST',
				body: new URLSearchParams({
					client_id: clientId,
					client_secret: clientSecret,
					code,
					grant_type: 'authorization_code',
					redirect_uri: req.protocol + "://" + req.get('host'),
					scope: 'identify',
				}).toString(),
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			});

			const oauthData = await tokenResponse.json();
			console.log(oauthData);

      try{
        const res2 = await fetch('https://discord.com/api/users/@me', {
          headers: {
            Authorization: `Bearer ${oauthData.access_token}`,
          }
        });
        const userData = await res2.json();
        console.log(userData);
        //check discord user id
        if(allowedidsstring.includes("," + userData.id + ",")){
          console.log("authorized " + userData.id + " " + code);
          let date = new Date();
          // dd/mm/yyyy
          date.setDate(date.getDate() + 5);
          let formatteddate = date.getFullYear() + "-" + (date.getMonth()+1) + "-" + date.getDate();
          
          
          tokens.push([code, formatteddate]);
          let tempstr = ",";
          let i = 0;
          for(i = 0; i < tokens.length; i++){
            tempstr += tokens[i][0] + ",";
          }
          stringtokens = tempstr;
          
        }
      }
      catch (error) {
        console.error(error);
      }
      
		} catch (error) {
			// NOTE: An unauthorized token will not throw an error
			// tokenResponseData.statusCode will be 401
			console.error(error);
		}
	}
  
  response.sendFile(path.join(__dirname, "index.html"));
});

app.get('/discordLogin', (req, res) => {
  res.redirect(`https://discord.com/oauth2/authorize?client_id=` + clientId + `&response_type=code&redirect_uri=` + req.protocol + "://" + req.get('host') + `&scope=identify`);
});


//wait 5 days then execute, then loop
setInterval(() => {
  let date = new Date();
  let formatteddate = date.getFullYear() + "-" + (date.getMonth()+1) + "-" + date.getDate();
  for(let i = 0; i < tokens.length; i++){
    if(tokens[i][1] == formatteddate){
      tokens.splice(i, 1);
      let tempstr = ",";
          for(i = 0; i < tokens.length; i++){
            tempstr += tokens[i][0] + ",";
          }
          stringtokens = tempstr;
    }
  }

  allowedidsstring = fs.readFileSync(path.join(__dirname, "allowedids.txt"), 'utf-8');
  
}, 1000);

// ==================== START SERVER ====================
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
