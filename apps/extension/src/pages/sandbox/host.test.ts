// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSandboxHost, type SandboxHost } from "./host";
let host: SandboxHost;
beforeEach(() => { vi.useFakeTimers(); host = createSandboxHost("about:blank"); });
afterEach(() => { host.destroy(); vi.useRealTimers(); });
function receive(source: Window, origin: string, data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { source, origin, data }));
}
async function ready() {
  const supported = host.probe();
  const frame = document.querySelector("iframe")!.contentWindow!;
  receive(frame, "null", { __dyn: true, ready: true, status: "supported" });
  expect(await supported).toBe("supported");
  return frame;
}

it("accepts results only from its own opaque sandbox frame", async () => {
  const frame = await ready();
  const messages = vi.spyOn(frame, "postMessage");
  const result = host.run("function dynamicBookmark() {}", {}, 200);
  await vi.advanceTimersByTimeAsync(0);
  const request = messages.mock.calls.findLast(([data]) => typeof data?.id === "string")![0] as { id: string };
  let settled = false;
  void result.then(() => { settled = true; });
  receive(window, "null", { __dyn: true, id: request.id, ok: true, value: { note: "spoof" } });
  receive(frame, "https://example.com", { __dyn: true, id: request.id, ok: true, value: { note: "spoof" } });
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(false);
  receive(frame, "null", { __dyn: true, id: request.id, ok: true, value: { note: "saved" } });
  expect(await result).toEqual({ ok: true, value: { note: "saved" } });
});

it("reports a probe timeout as initialization failure and releases the frame", async () => {
  const supported = host.probe();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await supported).toBe("failed");
  expect(document.querySelector("iframe")).toBeNull();
});

it("returns a timeout and allows a later execution to complete", async () => {
  const frame = await ready();
  const messages = vi.spyOn(frame, "postMessage");
  const timeout = host.run("function dynamicBookmark() {}", {}, 200);
  await vi.advanceTimersByTimeAsync(0);
  const timedRequest = messages.mock.calls.findLast(([data]) => typeof data?.id === "string")![0] as { id: string };
  receive(frame, "null", { __dyn: true, id: timedRequest.id, started: true });
  await vi.advanceTimersByTimeAsync(200);
  expect(await timeout).toMatchObject({ ok: false, error: "timeout" });
  const result = host.run("function dynamicBookmark() {}", {}, 200);
  await vi.advanceTimersByTimeAsync(0);
  const request = messages.mock.calls.findLast(([data]) => typeof data?.id === "string")![0] as { id: string };
  receive(frame, "null", { __dyn: true, id: request.id, ok: true, value: { note: "recovered" } });
  expect(await result).toEqual({ ok: true, value: { note: "recovered" } });
});


it("gives code its full execution budget after a slow worker startup", async () => {
  const frame = await ready();
  const messages = vi.spyOn(frame, "postMessage");
  const result = host.run("function dynamicBookmark() {}", {}, 200);
  await vi.advanceTimersByTimeAsync(500);
  const request = messages.mock.calls.findLast(([data]) => typeof data?.id === "string")![0] as { id: string };
  receive(frame, "null", { __dyn: true, id: request.id, started: true });
  await vi.advanceTimersByTimeAsync(190);
  receive(frame, "null", { __dyn: true, id: request.id, ok: true, value: { note: "completed" } });
  expect(await result).toEqual({ ok: true, value: { note: "completed" } });
});

it("bounds a worker that never starts separately from code execution", async () => {
  await ready();
  const result = host.run("function dynamicBookmark() {}", {}, 200);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await result).toMatchObject({ ok: false, error: "sandbox worker startup timeout" });
});

it("does not charge a queued script for another script's execution time", async () => {
  const frame = await ready();
  const messages = vi.spyOn(frame, "postMessage");
  const first = host.run("function dynamicBookmark() {}", {}, 500);
  const second = host.run("function dynamicBookmark() {}", {}, 200);
  await vi.advanceTimersByTimeAsync(0);
  const firstRequest = messages.mock.calls.findLast(([data]) => typeof data?.id === "string")![0] as { id: string };
  receive(frame, "null", { __dyn: true, id: firstRequest.id, started: true });
  await vi.advanceTimersByTimeAsync(300);
  receive(frame, "null", { __dyn: true, id: firstRequest.id, ok: true, value: { note: "first" } });
  expect(await first).toMatchObject({ ok: true });
  await vi.advanceTimersByTimeAsync(0);
  const secondRequest = messages.mock.calls.findLast(([data]) => typeof data?.id === "string")![0] as { id: string };
  receive(frame, "null", { __dyn: true, id: secondRequest.id, started: true });
  await vi.advanceTimersByTimeAsync(190);
  receive(frame, "null", { __dyn: true, id: secondRequest.id, ok: true, value: { note: "second" } });
  expect(await second).toEqual({ ok: true, value: { note: "second" } });
});
