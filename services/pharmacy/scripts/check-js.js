const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith(".js")) files.push(file);
  }
}
for (const folder of ["src", "tests", "scripts"]) {
  const absolute = path.join(root, folder);
  if (fs.existsSync(absolute)) walk(absolute);
}
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exitCode = result.status || 1;
}