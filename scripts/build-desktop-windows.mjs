import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = "x86_64-pc-windows-msvc";
const cargoArgs = [
  ...(process.platform === "win32" ? [] : ["xwin"]),
  "build",
  "--release",
  "--target",
  target,
  "--manifest-path",
  "apps/desktop/src-tauri/Cargo.toml",
];
const result = spawnSync("cargo", cargoArgs, { cwd: root, stdio: "inherit" });

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const source = resolve(
  root,
  "apps/desktop/src-tauri/target",
  target,
  "release/browserail-desktop.exe",
);
const destination = resolve(root, "build/desktop/BrowseRail.exe");

await mkdir(resolve(root, "build/desktop"), { recursive: true });
await copyFile(source, destination);
console.log(`Created ${destination}`);
