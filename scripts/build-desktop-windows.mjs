import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = "x86_64-pc-windows-msvc";
const targetDir = process.env.CARGO_TARGET_DIR || resolve(root, "apps/desktop/src-tauri/target");

let source;

if (process.platform === "win32") {
  const result = spawnSync(
    "cargo",
    ["build", "--release", "--target", target, "--manifest-path", "apps/desktop/src-tauri/Cargo.toml"],
    { cwd: root, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  source = resolve(targetDir, target, "release/browserail-desktop.exe");
} else {
  const cargoArgs = [
    "xwin",
    "build",
    "--release",
    "--target",
    target,
    "--manifest-path",
    "apps/desktop/src-tauri/Cargo.toml",
  ];
  const result = spawnSync("cargo", cargoArgs, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  source = resolve(targetDir, target, "release/browserail-desktop.exe");
}

const destination = resolve(root, "build/desktop/BrowseRail.exe");
await mkdir(resolve(root, "build/desktop"), { recursive: true });
await copyFile(source, destination);
console.log(`Created ${destination}`);
