export function createLifetime(root: HTMLElement, waitForFonts: () => Promise<unknown> = () => root.ownerDocument.fonts.ready) {
  const view = root.ownerDocument.defaultView;
  if (!view) throw new Error("The menu container has no window");
  const abort = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const frames = new Map<number, (alive: boolean) => void>();
  const cleanup = new Set<() => void>();
  let alive = true;
  return {
    get alive() { return alive; },
    signal: abort.signal,
    onDestroy(fn: () => void): () => void {
      if (!alive) { fn(); return () => {}; }
      cleanup.add(fn);
      return () => { cleanup.delete(fn); };
    },
    timeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
      const id = setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms);
      timers.add(id);
      return id;
    },
    cancelTimeout(id: ReturnType<typeof setTimeout> | undefined): void {
      if (id === undefined) return;
      clearTimeout(id);
      timers.delete(id);
    },
    frame(): Promise<boolean> {
      if (!alive) return Promise.resolve(false);
      return new Promise(resolve => {
        const id = view.requestAnimationFrame(() => { frames.delete(id); resolve(alive); });
        frames.set(id, resolve);
      });
    },
    async settle(): Promise<boolean> {
      if (!alive) return false;
      let cancel!: () => void;
      const cancelled = new Promise<boolean>(resolve => {
        cancel = () => resolve(false);
        abort.signal.addEventListener("abort", cancel, { once: true });
      });
      let fontsReady: boolean;
      try { fontsReady = await Promise.race([waitForFonts().then(() => true), cancelled]); }
      finally { abort.signal.removeEventListener("abort", cancel); }
      if (!fontsReady) return false;
      if (!alive || !await this.frame()) return false;
      return this.frame();
    },
    destroy(): void {
      if (!alive) return;
      alive = false;
      abort.abort();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      for (const [id, resolve] of frames) { view.cancelAnimationFrame(id); resolve(false); }
      frames.clear();
      for (const fn of cleanup) fn();
      cleanup.clear();
    },
  };
}
export type Lifetime = ReturnType<typeof createLifetime>;

export function showMenuError(root: HTMLElement, error: unknown): void {
  root.dataset.error = "";
  root.title = String(error);
}
