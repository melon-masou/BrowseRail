// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attachPress, HOLD_MS } from "./press";

let button: HTMLButtonElement;
let lifetime: AbortController;
const primary = vi.fn();
const alternate = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  button = document.createElement("button");
  document.body.append(button);
  lifetime = new AbortController();
  primary.mockClear(); alternate.mockClear();
  attachPress(button, { enabled: () => true, primary, alternate }, lifetime.signal);
});
afterEach(() => { lifetime.abort(); button.remove(); vi.useRealTimers(); });

function pointer(type: string, init: PointerEventInit = {}): void {
  button.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: "touch", ...init }));
}

it("acts on a touch tap only when the finger lifts", () => {
  pointer("pointerdown");
  expect(primary).not.toHaveBeenCalled();
  pointer("pointerup");
  expect(primary).toHaveBeenCalledOnce();
  expect(alternate).not.toHaveBeenCalled();
});

it("treats a touch hold as the right button without also tapping", () => {
  pointer("pointerdown");
  vi.advanceTimersByTime(HOLD_MS);
  expect(alternate).toHaveBeenCalledOnce();
  pointer("pointerup");
  expect(primary).not.toHaveBeenCalled();
});

it("does nothing when the finger moves away, as when scrolling", () => {
  pointer("pointerdown", { clientX: 0, clientY: 0 });
  pointer("pointermove", { clientX: 0, clientY: 30 });
  vi.advanceTimersByTime(HOLD_MS);
  pointer("pointerup", { clientX: 0, clientY: 30 });
  expect(primary).not.toHaveBeenCalled();
  expect(alternate).not.toHaveBeenCalled();
});

it("does nothing when another element takes the finger before it lifts", () => {
  pointer("pointerdown");
  pointer("lostpointercapture");
  vi.advanceTimersByTime(HOLD_MS);
  expect(primary).not.toHaveBeenCalled();
  expect(alternate).not.toHaveBeenCalled();
});

it("treats a pen's barrel button as the right button", () => {
  pointer("pointerdown", { pointerType: "pen", button: 2 });
  expect(alternate).toHaveBeenCalledOnce();
  pointer("pointerup", { pointerType: "pen", button: 2 });
  expect(primary).not.toHaveBeenCalled();
});

it("keeps mouse presses immediate, with the right button as the alternate", () => {
  pointer("pointerdown", { pointerType: "mouse", button: 0 });
  expect(primary).toHaveBeenCalledOnce();
  pointer("pointerdown", { pointerType: "mouse", button: 2 });
  expect(alternate).toHaveBeenCalledOnce();
});
