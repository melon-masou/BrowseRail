import { applyRewrite } from "./rewrite";

self.onmessage = (event: MessageEvent<{ source: string; url: string }>) => {
  self.postMessage({ started: true });
  self.postMessage(applyRewrite(event.data.source, event.data.url));
};
self.postMessage({ ready: true });
