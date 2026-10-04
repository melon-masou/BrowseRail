import browser from "webextension-polyfill";

let capability: Promise<boolean> | undefined;
// Only checks that a sandbox frame can be hosted. Whether the browser honours the
// sandbox declaration is decided by the frame's own isolation probe.
export function canUseSandbox(): Promise<boolean> {
  return capability ??= detectSandbox();
}
async function detectSandbox(): Promise<boolean> {
  const manifest = browser.runtime.getManifest() as { sandbox?: { pages?: string[] } };
  if (!manifest.sandbox?.pages?.includes("sandbox.html")) return false;
  if (typeof document !== "undefined") return true;
  const chrome = (globalThis as unknown as { chrome?: { offscreen?: { createDocument?: unknown } } }).chrome;
  return typeof chrome?.offscreen?.createDocument === "function";
}
