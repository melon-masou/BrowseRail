// Blob workers inherit the sandbox CSP, including its blocked network access.
const workerSource = `
let supported = false;
try {
  supported = typeof chrome === "undefined" && typeof browser === "undefined" && new Function("return true")() === true;
} catch {}
self.postMessage({ phase: "ready", supported });
self.onmessage = function(event) {
  const id = event.data.id;
  self.postMessage({ phase: "started", id });
  try {
    const factory = new Function('"use strict";\\n' + event.data.code + '\\n;return typeof dynamicBookmark === "function" ? dynamicBookmark : null;');
    const fn = factory();
    if (typeof fn !== "function") throw new Error("dynamicBookmark is not defined");
    const value = fn(event.data.args);
    if (value && typeof value.then === "function") throw new Error("dynamicBookmark must return synchronously");
    self.postMessage({ phase: "result", id, ok: true, value: JSON.parse(JSON.stringify(value ?? null)) });
  } catch (error) { self.postMessage({ phase: "result", id, ok: false, error: String(error) }); }
};`;
let worker: Worker | undefined;
let workerUrl: string | undefined;
let workerReady: Promise<Worker> | undefined;
let bootReject: ((error: Error) => void) | undefined;
let activeId: string | undefined;
function stopWorker(): void {
  worker?.terminate();
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  worker = undefined;
  workerUrl = undefined;
  workerReady = undefined;
  bootReject?.(new Error("sandbox worker unavailable"));
  bootReject = undefined;
}
function finish(id: string, result: { ok: boolean; value?: unknown; error?: string }): void {
  if (activeId !== id) return;
  activeId = undefined;
  parent.postMessage({ __dyn: true, id, ...result }, "*");
}
function ensureWorker(): Promise<Worker> {
  if (workerReady) return workerReady;
  workerReady = new Promise<Worker>((resolve, reject) => {
    bootReject = reject;
    workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    const created = new Worker(workerUrl);
    worker = created;
    created.onmessage = event => {
      if (worker !== created) return;
      const data = event.data;
      if (data?.phase === "ready") {
        bootReject = undefined;
        if (data.supported === true) resolve(created);
        else { reject(new Error("sandbox unsupported")); stopWorker(); }
      } else if (data?.id === activeId && typeof activeId === "string") {
        if (data.phase === "started") parent.postMessage({ __dyn: true, id: activeId, started: true }, "*");
        else if (data.phase === "result" && typeof data.ok === "boolean") finish(activeId, data);
      }
    };
    created.onerror = () => {
      const id = activeId;
      stopWorker();
      if (id) finish(id, { ok: false, error: "sandbox worker unavailable" });
    };
  });
  return workerReady;
}
let isolated = false;
try {
  isolated = (globalThis as { chrome?: { runtime?: unknown } }).chrome?.runtime === undefined
    && (globalThis as { browser?: { runtime?: unknown } }).browser?.runtime === undefined
    && new Function("return true")() === true;
} catch { /* An unsupported declaration may leave an ordinary extension page. */ }
window.addEventListener("pagehide", stopWorker);
window.addEventListener("message", event => {
  if (event.source !== parent || !event.data || event.data.__dyn !== true) return;
  const data = event.data;
  if (typeof data.cancel === "string") {
    if (activeId === data.cancel) { activeId = undefined; stopWorker(); }
    return;
  }
  if (data.probe === true) {
    if (!isolated) { parent.postMessage({ __dyn: true, ready: true, status: "unsupported" }, "*"); return; }
    void ensureWorker().then(() => {
      parent.postMessage({ __dyn: true, ready: true, status: "supported" }, "*");
    }).catch(error => {
      stopWorker();
      parent.postMessage({ __dyn: true, ready: true, status: String(error) === "Error: sandbox unsupported" ? "unsupported" : "failed" }, "*");
    });
    return;
  }
  if (!isolated || typeof data.id !== "string" || typeof data.code !== "string") return;
  if (activeId) {
    parent.postMessage({ __dyn: true, id: data.id, ok: false, error: "sandbox busy" }, "*");
    return;
  }
  activeId = data.id;
  void ensureWorker().then(ready => {
    if (activeId === data.id) ready.postMessage({ id: data.id, code: data.code, args: data.args });
  }).catch(error => {
    if (activeId !== data.id) return;
    stopWorker();
    finish(data.id, { ok: false, error: String(error) });
  });
});

export {};
