// Chrome offscreen document. A service worker has no DOM, so it cannot host the
// sandbox iframe directly; this offscreen page does, and relays run requests
// from the service worker to the sandbox over runtime messaging.

import { createSandboxHost } from "../sandbox/host";

declare const chrome: {
  runtime: {
    getURL(path: string): string;
    onMessage: {
      addListener(
        cb: (
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | undefined,
      ): void;
    };
  };
};

const host = createSandboxHost(chrome.runtime.getURL("sandbox.html"));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as
    | { __dynHost?: unknown; code?: unknown; args?: unknown; timeoutMs?: unknown }
    | undefined;
  if (!msg || msg.__dynHost !== true || typeof msg.code !== "string") {
    return undefined;
  }
  host
    .run(msg.code, msg.args, typeof msg.timeoutMs === "number" ? msg.timeoutMs : 200)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true; // keep the message channel open for the async response
});
