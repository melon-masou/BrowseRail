import type { RewriteResult } from "./rewrite";

export function createRewriteHost(workerUrl: string) {
  let worker: Worker | undefined;
  let readiness: Promise<boolean> | undefined;
  let readyResolve: ((ready: boolean) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: ((result: RewriteResult) => void) | undefined;
  let queue = Promise.resolve();
  function destroy(error = "Rewrite worker closed"): void {
    clearTimeout(timer);
    worker?.terminate();
    worker = undefined;
    readiness = undefined;
    readyResolve?.(false);
    readyResolve = undefined;
    pending?.({ ok: false, error });
    pending = undefined;
  }
  function ready(): Promise<boolean> {
    if (readiness) return readiness;
    const promise = new Promise<boolean>(resolve => { readyResolve = resolve; });
    readiness = promise;
    timer = setTimeout(() => destroy("Rewrite worker startup timeout"), 2_000);
    try {
      const active = new Worker(workerUrl);
      worker = active;
      active.onerror = () => { if (worker === active) destroy("Rewrite worker failed"); };
      active.onmessage = (event: MessageEvent) => {
        if (worker !== active) return;
        const data = event.data;
        if (data?.ready === true) {
          clearTimeout(timer);
          readyResolve?.(true);
          readyResolve = undefined;
        } else if (data?.started === true && pending) {
          clearTimeout(timer);
          timer = setTimeout(() => destroy("Rewrite execution timeout"), 200);
        } else if (typeof data?.ok === "boolean" && pending) {
          clearTimeout(timer);
          const resolve = pending;
          pending = undefined;
          resolve(data as RewriteResult);
        }
      };
    } catch { destroy("Rewrite worker unavailable"); }
    return promise;
  }
  async function execute(source: string, url: string): Promise<RewriteResult> {
    if (!await ready() || !worker) return { ok: false, error: "Rewrite worker unavailable" };
    return new Promise(resolve => {
      pending = resolve;
      timer = setTimeout(() => destroy("Rewrite worker startup timeout"), 2_000);
      try { worker!.postMessage({ source, url }); }
      catch { destroy("Rewrite worker failed"); }
    });
  }
  return {
    destroy,
    run(source: string, url: string): Promise<RewriteResult> {
      const result = queue.then(() => execute(source, url));
      queue = result.then(() => {});
      return result;
    },
  };
}
