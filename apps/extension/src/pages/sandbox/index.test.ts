// @vitest-environment happy-dom
import { createContext, runInContext, type Context } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const blobs = new Map<string, Blob>();
let replies: Record<string, unknown>[];
let hooks: ReturnType<typeof vi.spyOn>;
let stallNext = false;
let currentWorker: TestWorker | undefined;
class TestWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  stopped = false;
  context: Context;
  constructor(url: string) {
    currentWorker = this;
    this.context = createContext({
      URL, URLSearchParams,
      postMessage: (data: unknown) => queueMicrotask(() => {
        if (!this.stopped) this.onmessage?.({ data: structuredClone(data) });
      }),
    });
    this.context.self = this.context;
    void blobs.get(url)!.text().then(source => {
      if (!this.stopped) runInContext(source, this.context);
    });
  }
  postMessage(data: unknown): void {
    if (stallNext) { stallNext = false; return; }
    queueMicrotask(() => {
      if (!this.stopped) this.context.onmessage({ data: structuredClone(data) });
    });
  }
  terminate(): void { this.stopped = true; }
}
beforeEach(async () => {
  vi.resetModules(); replies = []; stallNext = false;
  hooks = vi.spyOn(window, "addEventListener");
  vi.spyOn(parent, "postMessage").mockImplementation(data => { replies.push(data); });
  vi.stubGlobal("Worker", TestWorker);
  vi.spyOn(URL, "createObjectURL").mockImplementation(blob => {
    if (!(blob instanceof Blob)) throw new Error("Expected a worker script Blob");
    const url = "blob:" + crypto.randomUUID(); blobs.set(url, blob); return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(url => { blobs.delete(url); });
  await import("./index");
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  for (const [type, listener] of hooks.mock.calls) window.removeEventListener(type, listener);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); blobs.clear();
});
function send(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { source: parent, data: { __dyn: true, ...data } }));
}
async function probe(): Promise<void> {
  send({ probe: true });
  await vi.waitFor(() => expect(replies.find(reply => reply.ready)).toMatchObject({ status: "supported" }));
}
async function run(id: string, code: string, args: unknown = {}): Promise<Record<string, unknown>> {
  send({ id, code, args });
  await vi.waitFor(() => expect(replies.find(reply => reply.id === id && typeof reply.ok === "boolean")).toBeDefined());
  return replies.find(reply => reply.id === id && typeof reply.ok === "boolean")!;
}
it("reports unsupported and runs nothing when the browser ignored the sandbox declaration", async () => {
  // Older Firefox loads the page as an ordinary extension page with its APIs.
  for (const [type, listener] of hooks.mock.calls) window.removeEventListener(type, listener);
  vi.resetModules(); currentWorker = undefined;
  vi.stubGlobal("browser", { runtime: {} });
  await import("./index");
  send({ probe: true });
  await vi.waitFor(() => expect(replies.find(reply => reply.ready)).toMatchObject({ status: "unsupported" }));
  send({ id: "ignored", code: counter });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(currentWorker).toBeUndefined();
  expect(replies.some(reply => reply.id === "ignored")).toBe(false);
});

const counter ="function dynamicBookmark() { globalThis.count = (globalThis.count || 0) + 1; return { note: String(globalThis.count) }; }";

it("reuses a healthy worker across calls and recreates it after cancellation", async () => {
  await probe();
  expect(await run("first", counter)).toMatchObject({ ok: true, value: { note: "1" } });
  expect(await run("second", counter)).toMatchObject({ ok: true, value: { note: "2" } });
  stallNext = true;
  send({ id: "stalled", code: counter, args: {} });
  await Promise.resolve();
  send({ cancel: "stalled" });
  expect(await run("recovered", counter)).toMatchObject({ ok: true, value: { note: "1" } });
});

it("recovers after a worker crash and releases workers and blob URLs on teardown", async () => {
  await probe();
  expect(await run("first", counter)).toMatchObject({ value: { note: "1" } });
  currentWorker!.onerror?.();
  expect(await run("after-crash", counter)).toMatchObject({ value: { note: "1" } });
  const running = currentWorker!;
  window.dispatchEvent(new Event("pagehide"));
  expect(running.stopped).toBe(true);
  expect(blobs.size).toBe(0);
});

it("uses native URL APIs, isolates inputs, and rejects asynchronous code without losing the worker", async () => {
  await probe();
  const args = { url: "https://example.com/docs", current: { note: "saved" } };
  const result = await run("url", "function dynamicBookmark(args) { args.current.note = 'changed'; return { newUrl: new URL('/next', args.url).href }; }", args);
  expect(result).toMatchObject({ ok: true, value: { newUrl: "https://example.com/next" } });
  expect(args.current.note).toBe("saved");
  expect(await run("async", "async function dynamicBookmark() { return {}; }")).toMatchObject({ ok: false, error: "Error: dynamicBookmark must return synchronously" });
  expect(await run("apis", "function dynamicBookmark() { return { note: [typeof document, typeof chrome, typeof browser].join(',') }; }")).toMatchObject({ ok: true, value: { note: "undefined,undefined,undefined" } });
});
