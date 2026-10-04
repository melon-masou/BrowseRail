import browser from "webextension-polyfill";
import { canUseSandbox } from "./capability";
import { createSandboxHost, type SandboxHost, type DynamicRunResult, type SandboxStatus } from "../pages/sandbox/host";
export type { DynamicRunResult };

interface ChromeHost {
  offscreen?: {
    hasDocument?(): Promise<boolean>;
    closeDocument?(): Promise<void>;
    createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void>;
  };
}
const chromeApi = (globalThis as unknown as { chrome?: ChromeHost }).chrome;
let localHost: SandboxHost | undefined;
let offscreenReady: Promise<void> | undefined;
let support: Promise<SandboxStatus> | undefined;

async function ensureOffscreen(): Promise<void> {
  const offscreen = chromeApi?.offscreen;
  if (!offscreen) throw new Error("Sandbox host unavailable");
  if (await offscreen.hasDocument?.()) return;
  offscreenReady ??= offscreen.createDocument({
    url: "offscreen.html", reasons: ["IFRAME_SCRIPTING"],
    justification: "Run dynamic bookmark functions in an isolated sandbox.",
  }).catch(async error => {
    offscreenReady = undefined;
    if (!await offscreen.hasDocument?.()) throw error;
  });
  await offscreenReady;
}
function host(): SandboxHost {
  return localHost ??= createSandboxHost(browser.runtime.getURL("sandbox.html"));
}
export function initializeSandbox(): Promise<SandboxStatus> {
  return support ??= (async (): Promise<SandboxStatus> => {
    if (!await canUseSandbox()) return "unsupported";
    if (typeof document !== "undefined") return host().probe();
    await ensureOffscreen();
    let status: SandboxStatus = "failed";
    try {
      const result = await browser.runtime.sendMessage({ __dynHost: "probe" });
      if (result === "supported" || result === "unsupported" || result === "failed") status = result;
      return status;
    } finally {
      if (status !== "supported") await chromeApi?.offscreen?.closeDocument?.();
    }
  })().catch(() => "failed");
}
export async function runDynamic(code: string, args: unknown, timeoutMs = 200): Promise<DynamicRunResult> {
  const status = await initializeSandbox();
  if (status !== "supported") return { ok: false, error: status === "unsupported" ? "sandbox unsupported" : "sandbox initialization failed" };
  if (typeof document !== "undefined") return host().run(code, args, timeoutMs);
  try {
    const result = await browser.runtime.sendMessage({ __dynHost: "run", code, args, timeoutMs });
    if (result && typeof result === "object" && "ok" in result && typeof result.ok === "boolean") return result as DynamicRunResult;
    return { ok: false, error: "no sandbox response" };
  } catch (error) { return { ok: false, error: String(error) }; }
}
