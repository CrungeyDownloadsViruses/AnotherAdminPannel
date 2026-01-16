import fs from "fs";
import path from "path";
import * as url from "url";
import { spawn } from "child_process";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Paths
const baseDir = path.join(__dirname, "base");
const pluginDir = path.join(__dirname, "plugins");

// Load base files
let backend = fs.readFileSync(path.join(baseDir, "index.js"), "utf8");

// Helper: insert at a specific line number
function insertAtLine(content, lineNumber, text) {
  const lines = content.split("\n");
  const index = Math.min(Math.max(0, lineNumber - 1), lines.length);
  lines.splice(index, 0, text);
  return lines.join("\n");
}

// Helper: replace a range of lines (inclusive)
function replaceLines(content, startLine, endLine, text) {
  const lines = content.split("\n");
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, endLine);
  lines.splice(start, end - start, text);
  return lines.join("\n");
}

// Helper: remove a range of lines
function removeLines(content, startLine, endLine) {
  const lines = content.split("\n");
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, endLine);
  lines.splice(start, end - start);
  return lines.join("\n");
}

// Find plugins
let plugins = fs.readdirSync(pluginDir).filter(f => f.endsWith(".js"));
console.log(`🧩 Found plugins: ${plugins.join(", ") || "none"}`);

for (const pluginFile of plugins) {
  const pluginPath = path.join(pluginDir, pluginFile);
  try {
    const pluginModule = await import(url.pathToFileURL(pluginPath));
    if (typeof pluginModule.default === "function") {
      console.log(`⚙️ Applying plugin: ${pluginFile}`);
      const result = pluginModule.default({
        backend,
        insertAtLine,
        replaceLines,
        removeLines
      });
      if (result) {
        if (result.backend) backend = result.backend;
      }
    } else {
      console.warn(`⚠️ Plugin ${pluginFile} has no default export function`);
    }
  } catch (err) {
    console.error(`❌ Error in plugin ${pluginFile}:`, err);
  }
}

// Write updated files
fs.writeFileSync(path.join(__dirname, "index.js"), backend);

console.log("Starting index.js...");
const child = spawn("node", ["index.js"], {
  cwd: __dirname,
  stdio: "inherit", // show its output in your console
});

child.on("exit", (code) => {
  console.log(`index.js exited with code ${code}`);
});
