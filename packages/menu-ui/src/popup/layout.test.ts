import { expect, it } from "vitest";
import { planFolderPopup } from "./layout";
import type { PopupRequest, Rect } from "../types";

function request(direction: PopupRequest["direction"]): PopupRequest {
  return {
    folder: { kind: "folder", uid: "root", label: "Root", children: [
      { kind: "folder", uid: "child", label: "Child", children: Array.from({ length: 30 }, (_, i) => ({ kind: "bookmark", uid: String(i), label: `Bookmark ${i}` })) },
    ] },
    anchor: { left: 900, right: 984, top: 500, bottom: 536 },
    theme: { fontFamily: "sans-serif", fontSize: 13, itemHeight: 36 }, direction, editingLocked: true,
  };
}
const measure = (text: string) => text.length * 7;
const viewport: Rect = { left: 0, top: 0, right: 1000, bottom: 600 };
function translate(rect: Rect, x: number, y: number): Rect {
  return { left: rect.left + x, right: rect.right + x, top: rect.top + y, bottom: rect.bottom + y };
}

it.each(["down", "up", "left", "right"] as const)("keeps %s menus within the available area when the anchor is near an edge", direction => {
  const { surface, state } = planFolderPopup(measure, request(direction), viewport);
  expect(surface.left).toBeGreaterThanOrEqual(viewport.left);
  expect(surface.right).toBeLessThanOrEqual(viewport.right);
  expect(surface.top).toBeGreaterThanOrEqual(viewport.top);
  expect(surface.bottom).toBeLessThanOrEqual(viewport.bottom);
  expect(surface.right).toBeGreaterThan(surface.left);
  expect(surface.bottom).toBeGreaterThan(surface.top);
  expect(state.rootOffsetX).toBeGreaterThanOrEqual(0);
  expect(state.rootOffsetX).toBeLessThan(state.bounds.right);
  expect(state.rootOffsetY).toBeGreaterThanOrEqual(0);
  expect(state.rootOffsetY).toBeLessThanOrEqual(state.bounds.bottom);
});

it.each(["down", "up", "left", "right"] as const)("preserves %s popup placement when the host maps the work area to another coordinate origin", direction => {
  const input = request(direction);
  const original = planFolderPopup(measure, input, viewport);
  const translated = planFolderPopup(measure, { ...input, anchor: translate(input.anchor, -1900, -700) }, translate(viewport, -1900, -700));
  expect(translated.state).toEqual(original.state);
  expect(translated.surface).toEqual(translate(original.surface, -1900, -700));
});

it("opens upwards when there is little room below and reserves space for child menus on either side of the root", () => {
  const input = request("down");
  const { surface, state } = planFolderPopup(measure, input, viewport);
  expect(state.direction).toBe("up");
  expect(surface.top + state.rootOffsetY).toBe(input.anchor.top);
  expect(surface.bottom).toBeGreaterThan(input.anchor.top);
  expect(surface.left + state.rootOffsetX).toBeLessThanOrEqual(input.anchor.left);
});

it.each(["left", "right"] as const)("moves the first %s column up when a bar folder has little space below", direction => {
  const input = request(direction);
  input.folder.children = Array.from({ length: 5 }, (_, i) => ({ kind: "bookmark", uid: String(i), label: `Bookmark ${i}` }));
  input.anchor = { left: 400, right: 484, top: 550, bottom: 586 };
  const { surface, state } = planFolderPopup(measure, input, viewport);
  const firstTop = surface.top + state.rootOffsetY;
  expect(firstTop).toBeLessThan(input.anchor.top);
  expect(firstTop).toBeGreaterThanOrEqual(viewport.top);
  expect(state.maxColumnHeight).toBeGreaterThan(5 * input.theme.itemHeight);
  expect(surface.bottom).toBeLessThanOrEqual(viewport.bottom);
});

it.each(["left", "right"] as const)("centers the first %s column on the bar folder when there is enough space", direction => {
  const input = request(direction);
  input.expandAlignment = "center";
  input.folder.children = Array.from({ length: 5 }, (_, i) => ({ kind: "bookmark", uid: String(i), label: `Bookmark ${i}` }));
  input.anchor = { left: 400, right: 484, top: 280, bottom: 316 };
  const { surface } = planFolderPopup(measure, input, viewport);
  expect((surface.top + surface.bottom) / 2).toBe((input.anchor.top + input.anchor.bottom) / 2);
});

it.each(["edge", "center"] as const)("keeps lateral columns inside the top boundary (alignment=%s)", expandAlignment => {
  const input = request("right");
  input.expandAlignment = expandAlignment;
  input.anchor = { left: 400, right: 484, top: 4, bottom: 40 };
  input.folder.children = Array.from({ length: 30 }, (_, i) => ({ kind: "bookmark", uid: String(i), label: `Bookmark ${i}` }));
  const { surface } = planFolderPopup(measure, input, viewport);
  expect(surface.top).toBeGreaterThanOrEqual(viewport.top);
  expect(surface.bottom).toBeLessThanOrEqual(viewport.bottom);
});

it.each([
  ["down", "edge"], ["down", "center"], ["up", "edge"], ["up", "center"],
] as const)("keeps the first %s column outside the bar button (alignment=%s)", (direction, expandAlignment) => {
  const input = request(direction);
  input.expandAlignment = expandAlignment;
  input.folder.children = Array.from({ length: 30 }, (_, i) => ({ kind: "bookmark", uid: String(i), label: `Bookmark ${i}` }));
  input.anchor = direction === "down" ? { left: 400, right: 484, top: 350, bottom: 386 } : { left: 400, right: 484, top: 200, bottom: 236 };
  const { surface, state } = planFolderPopup(measure, input, viewport);
  expect(state.direction).toBe(direction);
  expect(surface.top + state.rootOffsetY).toBe(direction === "up" ? input.anchor.top : input.anchor.bottom);
  expect(direction === "up" ? surface.bottom <= input.anchor.top : surface.top >= input.anchor.bottom).toBe(true);
});
