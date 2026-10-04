import browser from "webextension-polyfill";
import type { SandboxStatus } from "../pages/sandbox/host";
export type { SandboxStatus };

export async function getSandboxStatus(): Promise<SandboxStatus> {
  try {
    const status = await browser.runtime.sendMessage({ type: "getDynamicSandboxStatus" });
    return status === "supported" || status === "unsupported" ? status : "failed";
  } catch { return "failed"; }
}
