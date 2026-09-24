// Background-facing API to run a user's dynamic-bookmark function in the sandbox.
//
// Firefox: the background is an event page with a DOM, so it hosts the sandbox
//   iframe directly.
// Chrome: the background is a service worker (no DOM), so it delegates to an
//   offscreen document that hosts the iframe (created on demand).

import browser from "webextension-polyfill";

import { createSandboxHost, type DynamicRunResult, type SandboxHost } from "./host";

export type { DynamicRunResult };

const DEFAULT_TIMEOUT_MS = 200;

const chromeApi = (globalThis as unknown as { chrome?: ChromeOffscreen }).chrome;

interface ChromeOffscreen {
  offscreen?: {
    hasDocument?(): Promise<boolean>;
    createDocument(options: {
      url: string;
      reasons: string[];
      justification: string;
    }): Promise<void>;
  };
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
}

const hasDom = typeof document !== "undefined" && typeof document.createElement === "function";

let localHost: SandboxHost | null = null;
let offscreenReady: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const offscreen = chromeApi?.offscreen;
  if (!offscreen) return;
  try {
    if (await offscreen.hasDocument?.()) return;
  } catch {
    // fall through to creation
  }
  if (!offscreenReady) {
    offscreenReady = offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["IFRAME_SCRIPTING"],
        justification: "Run user-defined dynamic bookmark functions in a sandboxed iframe.",
      })
      .catch(() => {
        // Another createDocument may have won the race; treat as ready.
        offscreenReady = null;
      });
  }
  await offscreenReady;
}

export async function runDynamic(
  code: string,
  args: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DynamicRunResult> {
  if (hasDom) {
    if (!localHost) {
      localHost = createSandboxHost(browser.runtime.getURL("sandbox.html"));
    }
    return localHost.run(code, args, timeoutMs);
  }
  if (!chromeApi?.offscreen) {
    return { ok: false, error: "no sandbox host available" };
  }
  await ensureOffscreen();
  try {
    const response = (await chromeApi.runtime.sendMessage({
      __dynHost: true,
      code,
      args,
      timeoutMs,
    })) as DynamicRunResult | undefined;
    return response ?? { ok: false, error: "no sandbox response" };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
