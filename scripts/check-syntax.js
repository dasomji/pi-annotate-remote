import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// Syntax only. Each file needs its own Node invocation; extra paths are arguments.
function checkFile(file) {
  const result = spawnSync(process.execPath, ["--check", file], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function checkDirectory(directory) {
  for (const entry of readdirSync(new URL(directory, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      checkDirectory(`${directory}${entry.name}/`);
    } else if (/\.(js|ts)$/.test(entry.name)) {
      const file = fileURLToPath(new URL(`${directory}${entry.name}`, import.meta.url));
      checkFile(file);
    }
  }
}

for (const directory of ["../broker/", "../chrome-extension/", "../annotation/", "../scripts/", "../test/"]) {
  checkDirectory(directory);
}
for (const file of ["index.ts", "types.ts", "playwright.config.js"]) checkFile(file);
