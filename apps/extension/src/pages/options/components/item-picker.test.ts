// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { createCustomBookmarkPicker } from "./custom-bookmark-picker";
import { createItemPicker } from "./item-picker";

it("keeps multiple selected menu targets while searching and applies the complete selection", async () => {
  const control = createItemPicker();
  try {
    const pending = control.pickMany("Menus", [{ id: "one", label: "One" }, { id: "two", label: "Two" }]);
    const choose = (label: string) => [...dialog().querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!.click();
    choose("One");
    search("Two");
    choose("Two");
    dialog().querySelector<HTMLButtonElement>(".space-bookmark-dialog-actions button")!.click();
    await expect(pending).resolves.toEqual(["one", "two"]);
  } finally { control.destroy(); }
});

const pickers: ReturnType<typeof createCustomBookmarkPicker>[] = [];
function picker() {
  const result = createCustomBookmarkPicker();
  pickers.push(result);
  return result;
}
afterEach(() => {
  for (const item of pickers.splice(0)) item.destroy();
});

function dialog(): HTMLDialogElement {
  return document.querySelector<HTMLDialogElement>("dialog[open]")!;
}
function search(value: string): void {
  const input = dialog().querySelector<HTMLInputElement>('input[type="search"]')!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("searches bookmark names and displayed URLs and selects the original bookmark", async () => {
  const pending = picker().pick("static", [
    { uid: "owner", name: "Owner", url: "https://github.com/alice" },
    { uid: "docs", name: "Documentation", url: "https://example.com/docs" },
  ]);
  search("GITHUB");
  expect(dialog().textContent).toContain("Owner");
  expect(dialog().textContent).not.toContain("Documentation");
  search("documentation");
  const choice = [...dialog().querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Documentation"))!;
  choice.click();
  await expect(pending).resolves.toBe("docs");
  expect(document.querySelector("dialog[open]")).toBeNull();
});

it("cancels the old selection when reopened, resets search, and cancels on destruction", async () => {
  const control = picker();
  const bookmarks = [{ uid: "dynamic", name: "GitHub owner", url: "https://github.com/alice" }];
  const previous = control.pick("dynamic", bookmarks);
  expect(dialog().textContent).not.toContain("https://github.com/alice");
  search("missing");
  const next = control.pick("dynamic", bookmarks);
  await expect(previous).resolves.toBeNull();
  expect(dialog().textContent).toContain("GitHub owner");
  expect(dialog().querySelector<HTMLInputElement>("input")!.value).toBe("");
  control.destroy();
  await expect(next).resolves.toBeNull();
  expect(document.querySelector("dialog[open]")).toBeNull();
  await expect(control.pick("static", bookmarks)).resolves.toBeNull();
});
