export function renderPreservingFocus(root: HTMLElement, render: () => void): void {
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && root.contains(active) ? active : null;
  const record = focused?.closest<HTMLElement>("[data-record-id]");
  const base = record ?? root;
  const path: number[] = [];
  let node: HTMLElement | null = focused;
  while (node && node !== base) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    path.unshift(Array.prototype.indexOf.call(parent.children, node));
    node = parent;
  }
  const selection =
    focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
      ? {
          start: focused.selectionStart,
          end: focused.selectionEnd,
          direction: focused.selectionDirection,
        }
      : null;
  const scrollTop = root.scrollTop;
  render();
  if (!focused) return;
  let replacement: Element | null = record
    ? (Array.from(root.querySelectorAll<HTMLElement>("[data-record-id]")).find(
        (value) => value.dataset.recordId === record.dataset.recordId,
      ) ?? null)
    : root;
  for (const index of path) replacement = replacement?.children[index] ?? null;
  if (replacement instanceof HTMLElement) {
    replacement.focus({ preventScroll: true });
    if (
      selection &&
      selection.start !== null &&
      (replacement instanceof HTMLInputElement || replacement instanceof HTMLTextAreaElement)
    )
      replacement.setSelectionRange(
        selection.start,
        selection.end,
        selection.direction ?? undefined,
      );
  }
  root.scrollTop = scrollTop;
}
