// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { mountTemporaryConfirmation } from "./index";

let confirmation: ReturnType<typeof mountTemporaryConfirmation> | undefined;
afterEach(() => { confirmation?.destroy(); document.body.replaceChildren(); });

function form(save = vi.fn(async (_note: string) => {})) {
  const root = document.createElement("div"); document.body.append(root);
  const close = vi.fn(async () => {});
  confirmation = mountTemporaryConfirmation(root, { save, close });
  return { root, save, close, submit() { root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true })); } };
}

it("never saves on opening, cancel, or Escape", async () => {
  const view = form();
  expect(view.save).not.toHaveBeenCalled();
  view.root.querySelector<HTMLButtonElement>('button[type="button"]')!.click();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(view.close).toHaveBeenCalledTimes(2);
  expect(view.save).not.toHaveBeenCalled();
});

it.each(["", "  Read later  "])("confirms with an optional note (%s) and closes after saving", async note => {
  const view = form();
  view.root.querySelector("input")!.value = note;
  view.submit();
  await vi.waitFor(() => expect(view.close).toHaveBeenCalledOnce());
  expect(view.save).toHaveBeenCalledWith(note.trim());
});

it("keeps confirmation open on a save error and permits retry", async () => {
  const save = vi.fn(async (_note: string) => {}).mockRejectedValueOnce(new Error("Save unavailable"));
  const view = form(save);
  view.submit();
  await vi.waitFor(() => expect(view.root.textContent).toContain("Save unavailable"));
  expect(view.close).not.toHaveBeenCalled();
  view.submit();
  await vi.waitFor(() => expect(view.close).toHaveBeenCalledOnce());
});
