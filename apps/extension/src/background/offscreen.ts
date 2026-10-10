import { createRewriteHost } from "../features/dynamic/rewrite-host";
import { dispatch } from "@browserail/protocol/message";
import { REWRITE_RUN, isRewriteRun, type RewriteRun } from "../features/dynamic/messages";
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
  if (!isRewriteRun(message)) return;
  void dispatch<RewriteRun>({ [REWRITE_RUN]: ({ source, url }) => rewrite.run(source, url) }, message).then(respond);
  return true;
});
