import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = "x86_64-pc-windows-msvc";

// Project-level configurable target directory:
// Can be overridden by BROWSERAIL_WIN_TARGET_DIR or CARGO_TARGET_DIR.
// When invoking Windows native cargo in WSL, placing target-dir on Windows local disk
// eliminates the 9P network filesystem latency bottleneck.
const useWindowsCargo =
  process.env.USE_WINDOWS_CARGO === "1" ||
  process.env.USE_WINDOWS_CARGO === "true" ||
  Boolean(process.env.BROWSERAIL_WIN_TARGET_DIR);

let source;

if (process.platform === "win32") {
  const targetDir = process.env.CARGO_TARGET_DIR || resolve(root, "apps/desktop/src-tauri/target");
  const result = spawnSync(
    "cargo",
    ["build", "--release", "--target", target, "--manifest-path", "apps/desktop/src-tauri/Cargo.toml"],
    { cwd: root, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  source = resolve(targetDir, target, "release/browserail-desktop.exe");
} else if (useWindowsCargo) {
  const winRoot = spawnSync("wslpath", ["-w", root], { encoding: "utf8" }).stdout.trim();
  const winTargetDir =
    process.env.BROWSERAIL_WIN_TARGET_DIR || "%LOCALAPPDATA%\\browserail\\target";
  const escapedWinTargetDir = winTargetDir.replaceAll("'", "''");

  console.log(`Building with Windows native cargo (target dir: ${winTargetDir})...`);
  const psScript = `
    $winRoot = '${winRoot}';
    $targetDir = [System.Environment]::ExpandEnvironmentVariables('${escapedWinTargetDir}');
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null;
    Set-Location $winRoot;
    $env:CARGO_TARGET_DIR = $targetDir;
    cargo build --release --target ${target} --manifest-path apps/desktop/src-tauri/Cargo.toml
  `;

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", psScript],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);

  const wslTargetDir = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p = '${escapedWinTargetDir}'; [System.Environment]::ExpandEnvironmentVariables($p)`,
    ],
    { encoding: "utf8" },
  ).stdout.trim();
  const resolvedWslTarget = spawnSync("wslpath", ["-u", wslTargetDir], {
    encoding: "utf8",
  }).stdout.trim();

  source = resolve(resolvedWslTarget, target, "release/browserail-desktop.exe");
} else {
  const targetDir = process.env.CARGO_TARGET_DIR || resolve(root, "apps/desktop/src-tauri/target");
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
