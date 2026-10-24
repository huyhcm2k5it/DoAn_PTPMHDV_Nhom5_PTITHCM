const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const targets = [
  path.join(root, "mongo"),
  path.join(root, "services/patient/src"),
  path.join(root, "services/appointment/src"),
  path.join(root, "services/pharmacy/src"),
  __dirname,
];
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith(".js")) files.push(file);
  }
}
for (const target of targets) walk(target);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exitCode = result.status || 1;
}