import browser from "webextension-polyfill";
import { MAX_EXTERNAL_MESSAGE_BYTES } from "@browserail/protocol/api";
import {
  EXTERNAL_RECEIVER_CONFIG, EXTERNAL_RECEIVER_REFRESH, EXTERNAL_RELAY_MESSAGE, EXTERNAL_RUN_MESSAGE, userscriptUpdateEvent,
} from "@browserail/protocol/content";

export function createExternalReceiver(target: Document) {
  let token = "";
  let revision = 0;
  let destroyed = false;

  function receive(event: Event): void {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== "string" || detail.length > MAX_EXTERNAL_MESSAGE_BYTES) return;
    let message: unknown;
    try { message = JSON.parse(detail); } catch { return; }
    void browser.runtime.sendMessage({ type: EXTERNAL_RELAY_MESSAGE, token, message }).catch(() => {});
  }

  // External actions: the background resolves the event name; the detail is the action's JSON text.
  function run(message: unknown): Promise<boolean> | undefined {
    if (!message || typeof message !== "object") return undefined;
    // The extension announces userscript access changes; the token lives only in extension storage.
    if ((message as { type?: unknown }).type === EXTERNAL_RECEIVER_REFRESH) { void refresh(); return undefined; }
    if ((message as { type?: unknown }).type !== EXTERNAL_RUN_MESSAGE) return undefined;
    const { eventName, detail } = message as { eventName?: unknown; detail?: unknown };
    if (!token || typeof eventName !== "string" || !eventName || (detail !== null && typeof detail !== "string")) return Promise.resolve(false);
    target.dispatchEvent(new CustomEvent(eventName, { detail }));
    return Promise.resolve(true);
  }

  function setToken(next: string): void {
    if (next === token) return;
    if (token) target.removeEventListener(userscriptUpdateEvent(token), receive);
    token = next;
    if (token) target.addEventListener(userscriptUpdateEvent(token), receive);
  }

  async function refresh(): Promise<void> {
    if (destroyed) return;
    const current = ++revision;
    // Drop the old listener while checking revocation or a changed token.
    setToken("");
    try {
      const config: unknown = await browser.runtime.sendMessage({ type: EXTERNAL_RECEIVER_CONFIG });
      if (destroyed || current !== revision) return;
      if (config && typeof config === "object" && "token" in config && typeof config.token === "string") setToken(config.token);
    } catch { /* Extension unload or revoked website access. */ }
  }

  browser.runtime.onMessage.addListener(run);
  return {
    refresh,
    destroy(): void {
      destroyed = true;
      ++revision;
      setToken("");
      browser.runtime.onMessage.removeListener(run);
    },
  };
}
