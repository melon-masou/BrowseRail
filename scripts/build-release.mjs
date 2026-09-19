import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const versionArg = process.argv[2] || process.env.BROWSERAIL_RELEASE_VERSION || process.env.RELEASE_VERSION;

if (!versionArg) {
  console.error("Error: Please specify a release version, e.g. pnpm build:release 0.2.0");
  process.exit(1);
}

const rawVersion = versionArg.trim();
const normalizedVersion = rawVersion.replace(/^v/, "");
const releaseTag = `v${normalizedVersion}`;

console.log(`[build:release] Starting release build for version=${normalizedVersion}, tag=${releaseTag}`);

const env = {
  ...process.env,
  BROWSERAIL_RELEASE_VERSION: normalizedVersion,
  BROWSERAIL_RELEASE_TAG: releaseTag,
};

function run(cmd, args) {
  console.log(`[build:release] Running: ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env, shell: process.platform === "win32" });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    console.error(`[build:release] Command failed with exit code ${res.status}: ${cmd} ${args.join(" ")}`);
    process.exit(res.status ?? 1);
  }
}

// 1. Clean build directory
run("pnpm", ["clean:build"]);

// 2. Build protocol
run("pnpm", ["--filter", "@browserail/protocol", "build"]);

// 3. Build extension
run("pnpm", ["--filter", "@browserail/extension", "build"]);

// 4. Build desktop
if (process.platform === "win32" || process.env.BUILD_WINDOWS_DESKTOP === "1") {
  run("pnpm", ["build:windows"]);
} else {
  run("pnpm", ["--filter", "@browserail/desktop", "build"]);
}

console.log(`[build:release] Successfully built release assets for ${normalizedVersion} (${releaseTag})`);
