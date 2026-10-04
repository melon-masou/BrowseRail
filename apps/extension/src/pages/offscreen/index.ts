import { createSandboxHost } from "../sandbox/host";
declare const chrome: {
  runtime: {
    id: string;
    getURL(path: string): string;
    onMessage: { addListener(listener: (message: unknown, sender: { id?: string; tab?: unknown }, respond: (response: unknown) => void) => boolean | undefined): void };
  };
};
const host = createSandboxHost(chrome.runtime.getURL("sandbox.html"));
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return;
  const data = message as { __dynHost?: unknown; code?: unknown; args?: unknown; timeoutMs?: unknown } | null;
  if (data?.__dynHost === "probe") {
    // A Chrome background restart can leave the offscreen document alive.
    host.destroy();
    void host.probe().then(respond).catch(() => respond("failed"));
    return true;
  }
  if (data?.__dynHost !== "run" || typeof data.code !== "string") return;
  void host.run(data.code, data.args, typeof data.timeoutMs === "number" ? data.timeoutMs : 200)
    .then(respond).catch(error => respond({ ok: false, error: String(error) }));
  return true;
});
