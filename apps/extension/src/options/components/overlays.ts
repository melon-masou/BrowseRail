export type OverlayName =
  "color" | "menuSettings" | "itemSettings" | "addItem" | "shortcutSettings" | "shortcutPick";
export function createOverlays() {
  const closers = new Map<OverlayName, () => void>();
  return {
    register(name: OverlayName, close: () => void): () => void {
      if (closers.has(name)) throw new Error(`Overlay already registered: ${name}`);
      closers.set(name, close);
      return () => {
        closers.delete(name);
      };
    },
    close(...names: OverlayName[]): void {
      for (const name of names) closers.get(name)?.();
    },
    closeExcept(...names: OverlayName[]): void {
      for (const [name, close] of closers) if (!names.includes(name)) close();
    },
  };
}
export type Overlays = ReturnType<typeof createOverlays>;
