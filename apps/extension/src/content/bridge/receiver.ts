import browser from "webextension-polyfill";
import { EXTERNAL_AUTHORIZATION_STORAGE_KEY } from "../../lib/config/external-authorization";
import { MAX_EXTERNAL_MESSAGE_BYTES } from "@browserail/protocol/api";
import { EXTERNAL_RECEIVER_CONFIG, EXTERNAL_RELAY_MESSAGE, EXTERNAL_RUN_MESSAGE } from "./messages";

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
    if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== EXTERNAL_RUN_MESSAGE) return undefined;
    const { eventName, detail } = message as { eventName?: unknown; detail?: unknown };
    if (!token || typeof eventName !== "string" || !eventName || (detail !== null && typeof detail !== "string")) return Promise.resolve(false);
    target.dispatchEvent(new CustomEvent(eventName, { detail }));
    return Promise.resolve(true);
  }

  function setToken(next: string): void {
    if (next === token) return;
    if (token) target.removeEventListener(`browserail:${token}`, receive);
    token = next;
    if (token) target.addEventListener(`browserail:${token}`, receive);
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

  const changed = (changes: Record<string, browser.Storage.StorageChange>, area: string): void => {
    if (area === "local" && changes[EXTERNAL_AUTHORIZATION_STORAGE_KEY]) void refresh();
  };
  browser.storage.onChanged.addListener(changed);
  browser.runtime.onMessage.addListener(run);
  return {
    refresh,
    destroy(): void {
      destroyed = true;
      ++revision;
      setToken("");
      browser.storage.onChanged.removeListener(changed);
      browser.runtime.onMessage.removeListener(run);
    },
  };
}
