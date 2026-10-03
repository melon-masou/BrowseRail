// Hosts a single sandboxed iframe and runs user code inside it with a per-call
// timeout. On timeout the iframe is assumed hung (a synchronous infinite loop
// cannot be interrupted from outside), so it is destroyed and rebuilt.
//
// Requires a DOM, so it runs in the Chrome offscreen document or the Firefox
// background event page — never directly in a Chrome service worker.

export interface DynamicRunResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface Pending {
  resolve: (result: DynamicRunResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SandboxHost {
  run(code: string, args: unknown, timeoutMs: number): Promise<DynamicRunResult>;
}

export function createSandboxHost(sandboxUrl: string): SandboxHost {
  let iframe: HTMLIFrameElement | null = null;
  let ready: Promise<void> | null = null;
  const pending = new Map<string, Pending>();

  function destroy(reason: string): void {
    if (iframe) {
      iframe.remove();
      iframe = null;
    }
    ready = null;
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: reason });
    }
    pending.clear();
  }

  function build(): void {
    destroy("sandbox rebuilt");
    const el = document.createElement("iframe");
    el.setAttribute("aria-hidden", "true");
    el.style.display = "none";
    el.src = sandboxUrl;
    ready = new Promise<void>((resolve) => {
      el.addEventListener("load", () => resolve(), { once: true });
    });
    document.body.appendChild(el);
    iframe = el;
  }

  window.addEventListener("message", (event) => {
    const data = event.data as
      | { __dyn?: unknown; id?: unknown; ok?: unknown; value?: unknown; error?: unknown }
      | undefined;
    if (!data || data.__dyn !== true || typeof data.id !== "string" || !("ok" in data)) {
      return;
    }
    const p = pending.get(data.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(data.id);
    const result: DynamicRunResult = { ok: Boolean(data.ok), value: data.value };
    if (typeof data.error === "string") result.error = data.error;
    p.resolve(result);
  });

  return {
    async run(code, args, timeoutMs) {
      if (!iframe) build();
      try {
        await ready;
      } catch {
        // ignore; contentWindow check below handles failure
      }
      const win = iframe?.contentWindow;
      if (!win) {
        return { ok: false, error: "sandbox unavailable" };
      }
      const id = crypto.randomUUID();
      return new Promise<DynamicRunResult>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          // The iframe is presumed hung (sync infinite loop); rebuild it.
          build();
          resolve({ ok: false, error: "timeout" });
        }, timeoutMs);
        pending.set(id, { resolve, timer });
        win.postMessage({ __dyn: true, id, code, args }, "*");
      });
    },
  };
}
