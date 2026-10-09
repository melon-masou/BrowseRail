import { createRewriteHost } from "../features/dynamic/rewrite-host";
declare const chrome: {
  runtime: {
    id: string;
    getURL(path: string): string;
    onMessage: { addListener(listener: (message: unknown, sender: { id?: string; tab?: unknown }, respond: (response: unknown) => void) => boolean | undefined): void };
  };
};
const rewrite = createRewriteHost(chrome.runtime.getURL("rewrite-worker.js"));
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return;
  const data = message as { __rewriteHost?: unknown; source?: unknown; url?: unknown } | null;
  if (data?.__rewriteHost === true && typeof data.source === "string" && typeof data.url === "string") {
    void rewrite.run(data.source, data.url).then(respond);
    return true;
  }
});
