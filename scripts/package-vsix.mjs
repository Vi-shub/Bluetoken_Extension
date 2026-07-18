/**
 * Package BlueToken into releases/<version>/bluetoken-<version>.vsix
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const outDir = path.join(root, "releases", version);
const outFile = path.join(outDir, `bluetoken-${version}.vsix`);

mkdirSync(outDir, { recursive: true });

console.log(`Packaging BlueToken ${version} → ${path.relative(root, outFile)}`);
execSync(
  `npx --no-install vsce package --allow-missing-repository --skip-license -o "${outFile}"`,
  { cwd: root, stdio: "inherit", shell: true }
);
console.log(`Done: ${outFile}`);
