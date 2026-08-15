import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const manifest = JSON.parse(await readFile(
  new URL("../chrome-extension/manifest.json", import.meta.url),
  "utf8",
));

if (manifest.version !== packageJson.version) {
  throw new Error(
    `Extension manifest version ${manifest.version} does not match package version ${packageJson.version}`,
  );
}
