import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRewriteHost } from "./rewrite";

const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  stopped = false;
  requests: { source: string; url: string }[] = [];
  constructor() { workers.push(this); }
  send(data: unknown): void { if (!this.stopped) this.onmessage?.({ data }); }
  postMessage(data: { source: string; url: string }): void {
    this.requests.push({ ...data });
    this.send({ started: true });
    if (data.source !== "blocked") this.send({ ok: true, url: data.url.replace("/old", "/new") });
  }
  terminate(): void { this.stopped = true; }
}
beforeEach(() => { vi.useFakeTimers(); workers.length = 0; vi.stubGlobal("Worker", FakeWorker); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("allows slow worker startup and queued calls without consuming their execution budget", async () => {
  const host = createRewriteHost("extension://rewrite-worker.js");
  const first = host.run('replace "/old" "/new"', "https://example.com/old");
  const second = host.run('filter "/new"', "https://example.com/new");
  await vi.advanceTimersByTimeAsync(1_500);
  workers[0]!.send({ ready: true });
  expect(await first).toEqual({ ok: true, url: "https://example.com/new" });
  expect(await second).toEqual({ ok: true, url: "https://example.com/new" });
  expect(workers).toHaveLength(1);
  expect(workers[0]!.requests).toEqual([
    { source: 'replace "/old" "/new"', url: "https://example.com/old" },
    { source: 'filter "/new"', url: "https://example.com/new" },
  ]);
  host.destroy();
});

it("terminates a blocked expression and recovers for the next test or bookmark update", async () => {
  const host = createRewriteHost("extension://rewrite-worker.js");
  const blocked = host.run("blocked", "https://example.com/");
  const next = host.run('replace "/old" "/new"', "https://example.com/old");
  await vi.advanceTimersByTimeAsync(0);
  workers[0]!.send({ ready: true });
  await vi.advanceTimersByTimeAsync(201);
  expect(await blocked).toEqual({ ok: false, error: "Rewrite execution timeout" });
  expect(workers[0]!.stopped).toBe(true);
  workers[1]!.send({ ready: true });
  expect(await next).toEqual({ ok: true, url: "https://example.com/new" });
  host.destroy();
});
