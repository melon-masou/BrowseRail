import { createRewriteHost } from "../features/dynamic/rewrite-host";
import { REWRITE_RUN } from "../features/dynamic/messages";
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
  const data = message as { type?: unknown; source?: unknown; url?: unknown } | null;
  if (data?.type === REWRITE_RUN && typeof data.source === "string" && typeof data.url === "string") {
    void rewrite.run(data.source, data.url).then(respond);
    return true;
  }
});
