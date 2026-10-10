import browser from "webextension-polyfill";
import { createRewriteHost } from "./rewrite-host";
import { applyRewrite, type RewriteResult } from "../../lib/rewrite/rewrite";
import { REWRITE_RUN, type RewriteRun } from "./messages";
import { request } from "../../lib/messaging";

interface ChromeHost {
  offscreen?: {
    hasDocument?(): Promise<boolean>;
    closeDocument?(): Promise<void>;
    createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void>;
  };
}
const chromeApi = (globalThis as unknown as { chrome?: ChromeHost }).chrome;
let offscreenReady: Promise<void> | undefined;
let rewriteHost: ReturnType<typeof createRewriteHost> | undefined;

async function ensureOffscreen(): Promise<void> {
  const offscreen = chromeApi?.offscreen;
  if (!offscreen) throw new Error("Dynamic bookmark host unavailable");
  if (await offscreen.hasDocument?.()) return;
  offscreenReady ??= offscreen.createDocument({
    url: "offscreen.html", reasons: ["WORKERS"],
    justification: "Run URL rewrite workers.",
  }).catch(async error => {
    offscreenReady = undefined;
    if (!await offscreen.hasDocument?.()) throw error;
  });
  await offscreenReady;
}
export async function runRewrite(source: string, url: string): Promise<RewriteResult> {
  try {
    if (typeof document !== "undefined") {
      rewriteHost ??= createRewriteHost(browser.runtime.getURL("rewrite-worker.js"));
      return await rewriteHost.run(source, url);
    }
    if (typeof chromeApi?.offscreen?.createDocument !== "function") return applyRewrite(source, url);
    await ensureOffscreen();
    // No reply arrives when the offscreen page has no listener yet.
    const result: RewriteResult | undefined = await request<RewriteRun>({ type: REWRITE_RUN, source, url });
    if (typeof result?.ok === "boolean") return result;
    return { ok: false, error: "No rewrite response" };
  } catch (error) { return { ok: false, error: String(error) }; }
}
