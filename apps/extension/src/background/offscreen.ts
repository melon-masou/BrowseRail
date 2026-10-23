import { listenOffscreenRequests, offscreenResourceUrl, isRewriteRun } from "@browserail/runtime-adapter/extension";
import { createRewriteHost } from "@browserail/runtime-adapter/rewrite";

const rewrite = createRewriteHost(offscreenResourceUrl("rewrite-worker.js"));
listenOffscreenRequests(message => {
  if (!isRewriteRun(message)) return;
  return rewrite.run(message.source, message.url);
});
