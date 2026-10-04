export type SandboxStatus = "supported" | "unsupported" | "failed";
export interface DynamicRunResult { ok: boolean; value?: unknown; error?: string }
export interface SandboxHost {
  probe(): Promise<SandboxStatus>;
  run(code: string, args: unknown, timeoutMs: number): Promise<DynamicRunResult>;
  destroy(): void;
}

const STARTUP_TIMEOUT_MS = 2_000;
export function createSandboxHost(url: string): SandboxHost {
  let iframe: HTMLIFrameElement | undefined;
  let readiness: Promise<SandboxStatus> | undefined;
  let readyResolve: ((value: SandboxStatus) => void) | undefined;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  let execution = Promise.resolve();
  let generation = 0;
  const pending = new Map<string, {
    resolve: (value: DynamicRunResult) => void;
    timer: ReturnType<typeof setTimeout>;
    timeoutMs: number;
    started: boolean;
  }>();
  function destroy(): void {
    generation++;
    clearTimeout(loadTimer);
    readyResolve?.("failed");
    readyResolve = undefined;
    iframe?.remove();
    iframe = undefined;
    readiness = undefined;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.resolve({ ok: false, error: "sandbox closed" });
    }
    pending.clear();
    window.removeEventListener("message", receive);
  }
  function timeout(id: string, error: string): void {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    iframe?.contentWindow?.postMessage({ __dyn: true, cancel: id }, "*");
    request.resolve({ ok: false, error });
  }
  function receive(event: MessageEvent): void {
    if (!iframe || event.source !== iframe.contentWindow || event.origin !== "null") return;
    const data = event.data;
    if (!data || data.__dyn !== true) return;
    if (data.ready === true) {
      if (!["supported", "unsupported", "failed"].includes(data.status)) return;
      clearTimeout(loadTimer);
      readyResolve?.(data.status);
      readyResolve = undefined;
      return;
    }
    if (typeof data.id !== "string") return;
    const request = pending.get(data.id);
    if (!request) return;
    if (data.started === true) {
      if (request.started) return;
      request.started = true;
      clearTimeout(request.timer);
      request.timer = setTimeout(() => timeout(data.id, "timeout"), request.timeoutMs);
      return;
    }
    if (typeof data.ok !== "boolean") return;
    clearTimeout(request.timer);
    pending.delete(data.id);
    request.resolve({ ok: data.ok, value: data.value, ...(typeof data.error === "string" ? { error: data.error } : {}) });
  }
  function probe(): Promise<SandboxStatus> {
    if (readiness) return readiness;
    const result = new Promise<SandboxStatus>(resolve => { readyResolve = resolve; });
    readiness = result.then(status => {
      if (status !== "supported") destroy();
      return status;
    });
    window.addEventListener("message", receive);
    iframe = document.createElement("iframe");
    iframe.hidden = true;
    iframe.src = url;
    iframe.addEventListener("load", () => {
      iframe?.contentWindow?.postMessage({ __dyn: true, probe: true }, "*");
    }, { once: true });
    loadTimer = setTimeout(() => { readyResolve?.("failed"); readyResolve = undefined; }, STARTUP_TIMEOUT_MS);
    document.body.append(iframe);
    return readiness;
  }
  function execute(code: string, args: unknown, timeoutMs: number): Promise<DynamicRunResult> {
    const id = crypto.randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => timeout(id, "sandbox worker startup timeout"), STARTUP_TIMEOUT_MS);
      pending.set(id, { resolve, timer, timeoutMs, started: false });
      try {
        iframe!.contentWindow!.postMessage({ __dyn: true, id, code, args }, "*");
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        resolve({ ok: false, error: String(error) });
      }
    });
  }
  return {
    probe, destroy,
    async run(code, args, timeoutMs) {
      const currentGeneration = generation;
      const status = await probe();
      if (status !== "supported") return { ok: false, error: status === "unsupported" ? "sandbox unsupported" : "sandbox initialization failed" };
      // One call at a time: waiting for another script does not consume its execution budget.
      const result = execution.then(() => currentGeneration !== generation || !iframe
        ? { ok: false, error: "sandbox closed" }
        : execute(code, args, timeoutMs));
      execution = result.then(() => {});
      return result;
    },
  };
}
