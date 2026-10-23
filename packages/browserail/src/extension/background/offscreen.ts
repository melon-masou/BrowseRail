import { listenOffscreenRequests, offscreenResourceUrl } from "@browserail/runtime-adapter/extension";
import { createRewriteHost } from "../features/dynamic/rewrite-host";
import { dispatch } from "@browserail/protocol/message";
import { REWRITE_RUN, isRewriteRun, type RewriteRun } from "@browserail/browserail/features/dynamic/messages";

const rewrite = createRewriteHost(offscreenResourceUrl("rewrite-worker.js"));
listenOffscreenRequests(message => {
  if (!isRewriteRun(message)) return;
  return dispatch<RewriteRun>({ [REWRITE_RUN]: ({ source, url }) => rewrite.run(source, url) }, message);
});
