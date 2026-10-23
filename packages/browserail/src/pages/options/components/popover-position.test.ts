import { describe, expect, it } from "vitest";
import { getPopoverPosition } from "./popover-position";

describe("getPopoverPosition", () => {
  it("places a popover below the anchor when it fits", () => {
    const rect = { left: 100, top: 100, right: 140, bottom: 130, width: 40 } as DOMRect;
    expect(getPopoverPosition(rect, 220, 180, 1280, 800)).toEqual({
      top: 136,
      left: 10,
    });
  });

  it("places a popover above the anchor when it would overflow the bottom", () => {
    const rect = { left: 100, top: 700, right: 140, bottom: 730, width: 40 } as DOMRect;
    expect(getPopoverPosition(rect, 220, 180, 1280, 800)).toEqual({
      top: 514,
      left: 10,
    });
  });

  it("keeps a popover below when there is not enough room above", () => {
    const rect = { left: 100, top: 20, right: 140, bottom: 50, width: 40 } as DOMRect;
    expect(getPopoverPosition(rect, 220, 180, 1280, 800)).toEqual({
      top: 56,
      left: 10,
    });
  });

  it("right-aligns dropdowns and clamps them to the viewport", () => {
    const rect = { left: 1180, top: 100, right: 1260, bottom: 130, width: 80 } as DOMRect;
    expect(getPopoverPosition(rect, 170, 80, 1280, 800, "right")).toEqual({
      top: 136,
      left: 1090,
    });
  });
});
