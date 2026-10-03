// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ sendMessage: vi.fn(async (_message: unknown) => ({ saved: true })) }));
vi.mock("webextension-polyfill", () => ({ default: { runtime: { sendMessage: mock.sendMessage } } }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

it("prefills the static confirmation, cancels without saving, and submits edited fields with retry after failure", async () => {
  vi.stubGlobal("location", { search: `?${new URLSearchParams({ kind: "static", name: "Current page", url: "https://example.com/current" })}` });
  document.body.innerHTML = '<div id="app"></div>';
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  await import("./index");
  const name = document.querySelector<HTMLInputElement>('input[name="name"]')!;
  const url = document.querySelector<HTMLInputElement>('input[name="url"]')!;
  expect(name.value).toBe("Current page");
  expect(url.value).toBe("https://example.com/current");
  expect(mock.sendMessage).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('button[type="button"]')!.click();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(close).toHaveBeenCalledTimes(2);
  expect(mock.sendMessage).not.toHaveBeenCalled();
  close.mockClear();
  name.value = "  Edited name  "; url.value = "https://example.com/edited";
  mock.sendMessage.mockRejectedValueOnce(new Error("Save unavailable"));
  const form = document.querySelector("form")!;
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(document.body.textContent).toContain("Save unavailable"));
  expect(close).not.toHaveBeenCalled();
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mock.sendMessage).toHaveBeenLastCalledWith({ type: "staticSaveConfirmed", name: "Edited name", url: "https://example.com/edited" });
});
