import { t } from "@browserail/i18n";

export function createDragSort(move: (sourceUid: string, targetUid: string, position: "before" | "after") => void) {
  let source: HTMLElement | undefined;
  let target: HTMLElement | undefined;

  function clearTarget(): void {
    target?.classList.remove("drag-over-top", "drag-over-bottom");
    target = undefined;
  }

  function clear(): void {
    source?.classList.remove("is-dragging");
    source = undefined;
    clearTarget();
  }

  function position(row: HTMLElement, event: DragEvent): "before" | "after" {
    const rect = row.getBoundingClientRect();
    return event.clientY <= rect.top + rect.height / 2 ? "before" : "after";
  }

  return {
    clear,
    handle(row: HTMLElement): HTMLButtonElement {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "drag-handle-btn";
      handle.title = handle.ariaLabel = t("item.dragHandleTitle");
      handle.draggable = true;
      handle.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>';
      handle.addEventListener("dragstart", event => {
        clear();
        source = row;
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-browserail-sort", row.dataset.recordId!);
          const rect = row.getBoundingClientRect();
          event.dataTransfer.setDragImage(row, event.clientX - rect.left, event.clientY - rect.top);
        }
        requestAnimationFrame(() => {
          if (source === row) row.classList.add("is-dragging");
        });
      });
      handle.addEventListener("dragend", clear);
      row.addEventListener("dragover", event => {
        if (!source || source === row) {
          clearTarget();
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        clearTarget();
        target = row;
        row.classList.add(position(row, event) === "before" ? "drag-over-top" : "drag-over-bottom");
      });
      row.addEventListener("dragleave", event => {
        if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
        if (target === row) clearTarget();
      });
      row.addEventListener("drop", event => {
        if (!source) return;
        event.preventDefault();
        const sourceUid = source.dataset.recordId!;
        const targetUid = row.dataset.recordId!;
        const placement = position(row, event);
        clear();
        if (sourceUid !== targetUid) move(sourceUid, targetUid, placement);
      });
      return handle;
    },
  };
}
