// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ sendMessage: vi.fn(async (_message: unknown) => ({ saved: true })) }));
vi.mock("webextension-polyfill", () => ({ default: { runtime: { sendMessage: mock.sendMessage } } }));
vi.mock("../../config", () => ({ loadConfig: async () => ({ staticBookmarks: [{ tags: ["work", "gbf"] }, { tags: ["gbf"] }] }) }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

it("prefills the static confirmation, selects existing and new tags, and submits edited fields with retry after failure", async () => {
  vi.stubGlobal("location", { search: `?${new URLSearchParams({ kind: "static", name: "Current page", url: "https://example.com/current" })}` });
  document.body.innerHTML = '<div id="app"></div>';
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  await import("./index");
  await vi.waitFor(() => expect(document.querySelector('input[name="name"]')).not.toBeNull());
  const name = document.querySelector<HTMLInputElement>('input[name="name"]')!;
  const url = document.querySelector<HTMLInputElement>('input[name="url"]')!;
  const tags = document.querySelector<HTMLInputElement>('input[name="tags"]')!;
  expect(name.value).toBe("Current page");
  expect(url.value).toBe("https://example.com/current");
  expect(mock.sendMessage).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('button[type="button"]')!.click();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(close).toHaveBeenCalledTimes(2);
  expect(mock.sendMessage).not.toHaveBeenCalled();
  close.mockClear();
  name.value = "  Edited name  "; url.value = "https://example.com/edited";
  expect([...document.querySelectorAll("datalist option")].map(option => option.getAttribute("value"))).toEqual(["gbf", "work"]);
  tags.value = "gbf, ";
  tags.dispatchEvent(new Event("input", { bubbles: true }));
  const options = [...document.querySelectorAll<HTMLOptionElement>("datalist option")];
  expect(options.map(option => option.value)).toEqual(["gbf,work"]);
  tags.value = options[0]!.value + ", new-tag， gbf, ";
  mock.sendMessage.mockRejectedValueOnce(new Error("Save unavailable"));
  const form = document.querySelector("form")!;
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(document.body.textContent).toContain("Save unavailable"));
  expect(close).not.toHaveBeenCalled();
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mock.sendMessage).toHaveBeenLastCalledWith({ type: "staticSaveConfirmed", name: "Edited name", url: "https://example.com/edited", tags: ["gbf", "work", "new-tag"] });
});
