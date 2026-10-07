// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mountBrowserMenu, type MenuCommand } from "./surface";
import type { BrowserMenu, TemporaryConfirmationResult } from "./messages";

let mounted: ReturnType<typeof mountBrowserMenu> | undefined;
beforeEach(() => {
  Object.defineProperty(document, "fonts", { configurable: true, value: { load: async () => [] } });
  Object.defineProperty(window, "prompt", { configurable: true, writable: true, value: vi.fn(() => null) });
});
afterEach(() => {
  mounted?.destroy(); document.body.replaceChildren();
  vi.useRealTimers(); vi.restoreAllMocks();
});

async function hold(result: TemporaryConfirmationResult, answer: string | null) {
  const root = document.createElement("div"); document.body.append(root);
  const menu: BrowserMenu = {
    view: { uid: "menu", orientation: "row", items: [{ kind: "bookmark", uid: "temporary:slot", label: "Later" }] },
    placement: { anchor: "topLeft", offsetX: 0, offsetY: 0, itemWidth: 84, itemHeight: 36 },
    collapsed: false, editingLocked: true,
  };
  const send = vi.fn(async (command: MenuCommand): Promise<TemporaryConfirmationResult | undefined> => command.type === "temporaryConfirm" ? result : undefined);
  const prompt = vi.spyOn(window, "prompt").mockReturnValue(answer);
  mounted = mountBrowserMenu(root, menu, send);
  await vi.waitFor(() => expect(root.querySelector("button")).not.toBeNull());
  const button = root.querySelector("button")!;
  button.setPointerCapture = vi.fn(); button.hasPointerCapture = () => false;
  vi.useFakeTimers();
  button.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 7, bubbles: true }));
  await vi.advanceTimersByTimeAsync(500);
  return { send, prompt };
}

it("uses extension confirmation without asking or saving in the webpage", async () => {
  const { send, prompt } = await hold("opened", "unused");
  expect(send).toHaveBeenCalledWith({ type: "temporaryConfirm", menuUid: "menu", uid: "slot" });
  expect(prompt).not.toHaveBeenCalled();
  expect(send.mock.calls.map(([command]) => command.type)).not.toContain("temporarySave");
});

it.each(["", "  Read later  "])("saves a confirmed prompt fallback with an optional note (%s)", async answer => {
  const { send, prompt } = await hold("prompt", answer);
  expect(prompt).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith({ type: "temporarySave", menuUid: "menu", uid: "slot", note: answer.trim() });
});

it("does not save when prompt fallback is cancelled", async () => {
  const { send, prompt } = await hold("prompt", null);
  expect(prompt).toHaveBeenCalledOnce();
  expect(send.mock.calls.map(([command]) => command.type)).not.toContain("temporarySave");
});

it("shows command failures on the clicked button and clears them only when a later command succeeds", async () => {
  const root = document.createElement("div"); document.body.append(root);
  const menu: BrowserMenu = {
    view: { uid: "menu", orientation: "row", items: [{ kind: "bookmark", uid: "static:link", label: "Owner" }] },
    placement: { anchor: "topLeft", offsetX: 0, offsetY: 0, itemWidth: 84, itemHeight: 36 },
    collapsed: false, editingLocked: true,
  };
  const send = vi.fn().mockRejectedValueOnce(new Error("Missing author")).mockResolvedValue(undefined);
  mounted = mountBrowserMenu(root, menu, send);
  const button = root.querySelector("button")!;
  button.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
  await vi.waitFor(() => expect(button.title).toContain("Missing author"));
  expect(button.querySelector(".menu-action-error")).not.toBeNull();
  button.dispatchEvent(new PointerEvent("pointerdown", { button: 2, bubbles: true }));
  await vi.waitFor(() => expect(button.title).toBe("Owner"));
  expect(button.querySelector(".menu-action-error")).toBeNull();
});
