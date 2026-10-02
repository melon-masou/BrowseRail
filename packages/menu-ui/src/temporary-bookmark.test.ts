import { afterEach, expect, it, vi } from "vitest";

import { attachTemporaryBookmarkButton } from "./temporary-bookmark";



afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("opens the save form after a hold without navigating, even if the pointer leaves the button", async () => {
  vi.useFakeTimers();
  const button = Object.assign(new EventTarget(), {
    style: { touchAction: "" },
    title: "",
    setPointerCapture: vi.fn(),
  }) as unknown as HTMLButtonElement;
  const dispatchAction = vi.fn(async () => {});
  const requestTemporarySave = vi.fn(async () => {});
  const onShortPress = vi.fn();
  attachTemporaryBookmarkButton(
    button,
    { kind: "bookmark", uid: "temporary:slot", label: "Later" },
    { invokeAction: dispatchAction, requestTemporarySave },
    { onShortPress, canAlternate: () => true },
  );

  const pointerDown = Object.assign(new Event("pointerdown", { cancelable: true }), {
    button: 0,
    pointerId: 7,
    clientX: 12,
    clientY: 12,
  });
  button.dispatchEvent(pointerDown);
  button.dispatchEvent(new Event("pointerleave"));

  vi.advanceTimersByTime(499);
  expect(dispatchAction).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  const pointerUp = Object.assign(new Event("pointerup"), { pointerId: 7, clientX: 12, clientY: 12 });
  button.dispatchEvent(pointerUp);
  expect(requestTemporarySave).toHaveBeenCalledWith({ uid: "slot", label: "Later" });
  expect(dispatchAction).not.toHaveBeenCalled();
  expect(onShortPress).not.toHaveBeenCalled();
});

it("does not open the save form when the pointer is cancelled before the hold", async () => {
  vi.useFakeTimers();
  const button = Object.assign(new EventTarget(), {
    style: { touchAction: "" },
    title: "",
    setPointerCapture: vi.fn(),
  }) as unknown as HTMLButtonElement;
  const dispatchAction = vi.fn(async () => {});
  const requestTemporarySave = vi.fn(async () => {});
  attachTemporaryBookmarkButton(
    button,
    { kind: "bookmark", uid: "temporary:slot", label: "Later" },
    { invokeAction: dispatchAction, requestTemporarySave },
    { onShortPress: () => { void dispatchAction(); }, canAlternate: () => true },
  );

  button.dispatchEvent(Object.assign(new Event("pointerdown", { cancelable: true }), {
    button: 0,
    pointerId: 7,
    clientX: 12,
    clientY: 12,
  }));
  button.dispatchEvent(new Event("pointercancel"));
  await vi.advanceTimersByTimeAsync(500);

  expect(requestTemporarySave).not.toHaveBeenCalled();
  expect(dispatchAction).not.toHaveBeenCalled();
});
