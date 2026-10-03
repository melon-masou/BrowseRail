export function createScope() {
  const abort = new AbortController();
  const disposers = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    signal: abort.signal,
    add(dispose: () => void): void {
      if (abort.signal.aborted) dispose();
      else disposers.add(dispose);
    },
    timeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> | undefined {
      if (abort.signal.aborted) return undefined;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!abort.signal.aborted) callback();
      }, delay);
      timers.add(timer);
      return timer;
    },
    destroy(): void {
      if (abort.signal.aborted) return;
      abort.abort();
      for (const dispose of disposers) dispose();
      disposers.clear();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
export type Scope = ReturnType<typeof createScope>;
