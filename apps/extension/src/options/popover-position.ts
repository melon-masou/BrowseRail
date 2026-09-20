export interface PopoverPosition {
  top: number;
  left: number;
}

export function getPopoverPosition(
  anchor: DOMRect,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  align: "center" | "right" = "center",
): PopoverPosition {
  const margin = 10;
  const gap = 6;
  const belowTop = anchor.bottom + gap;
  const aboveTop = anchor.top - gap - height;
  const top =
    belowTop + height > viewportHeight - margin && aboveTop >= margin
      ? aboveTop
      : belowTop;
  let left =
    align === "right"
      ? anchor.right - width
      : anchor.left + anchor.width / 2 - width / 2;

  if (left < margin) left = margin;
  if (left + width > viewportWidth - margin) {
    left = viewportWidth - width - margin;
  }

  return { top, left };
}

export function positionPopover(
  popover: HTMLElement,
  anchor: DOMRect,
  width: number,
  align: "center" | "right" = "center",
): void {
  popover.style.display = "flex";
  const height = popover.offsetHeight;
  const { top, left } = getPopoverPosition(
    anchor,
    width,
    height,
    window.innerWidth,
    window.innerHeight,
    align,
  );

  popover.style.position = "fixed";
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}
