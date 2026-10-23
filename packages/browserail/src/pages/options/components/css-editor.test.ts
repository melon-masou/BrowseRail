// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { createCssEditor } from "./css-editor";

it("edits the reopened global CSS collection without updating the closed collection", async () => {
  const closed = vi.fn();
  const editor = createCssEditor(closed);
  const globalChanged = vi.fn();
  const reopenedChanged = vi.fn();
  const actions = (css: string, update: (key: string, css: string) => void) => ({
    read: () => ({ theme: css }), add: () => undefined, update, remove: () => {},
  });
  try {
    editor.openGlobal(actions("& { color: red; }", globalChanged));
    const dialog = document.querySelector(".css-editor-dialog")!;
    const input = dialog.querySelector("textarea")!;
    expect(input.value).toBe("& { color: red; }");
    input.value = "& { color: blue; }";
    input.dispatchEvent(new Event("input"));
    expect(globalChanged).toHaveBeenLastCalledWith("theme", input.value);
    dialog.querySelector<HTMLButtonElement>(".color-popover-close")!.click();
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
    editor.openGlobal(actions(".menu-button { color: blue; }", reopenedChanged));
    expect(input.value).toBe(".menu-button { color: blue; }");
    globalChanged.mockClear();
    input.value = ""; input.dispatchEvent(new Event("input"));
    expect(reopenedChanged).toHaveBeenLastCalledWith("theme", "");
    expect(globalChanged).not.toHaveBeenCalled();
  } finally { editor.destroy(); }
});

it("switches named styles, removes the selected style and asks for a name before adding", () => {
  const styles: Record<string, string> = { icons: "& { --icon: none; }", theme: "& { color: red; }" };
  const editor = createCssEditor(() => {});
  try {
    editor.openGlobal({
      read: () => styles,
      add: name => {
        const key = name.trim();
        if (!key || Object.hasOwn(styles, key)) return undefined;
        styles[key] = ""; return key;
      },
      update: (key, css) => { styles[key] = css; },
      remove: key => { delete styles[key]; },
    });
    const dialog = document.querySelector(".css-editor-dialog")!;
    const select = dialog.querySelector("select")!;
    const css = dialog.querySelector("textarea")!;
    select.value = "theme"; select.dispatchEvent(new Event("change"));
    expect(css.value).toBe("& { color: red; }");
    css.value = "& { color: blue; }"; css.dispatchEvent(new Event("input"));
    expect(styles).toEqual({ icons: "& { --icon: none; }", theme: "& { color: blue; }" });
    dialog.querySelector<HTMLButtonElement>(".remove-item-btn")!.click();
    expect(styles).toEqual({ icons: "& { --icon: none; }" });
    expect(css.value).toBe(styles.icons);
    dialog.querySelector<HTMLButtonElement>(".css-editor-add")!.click();
    const naming = document.querySelector(".space-bookmark-dialog")!;
    expect(styles).toEqual({ icons: "& { --icon: none; }" });
    naming.querySelector<HTMLButtonElement>(".action-btn")!.click();
    expect(styles).toEqual({ icons: "& { --icon: none; }" });
    dialog.querySelector<HTMLButtonElement>(".css-editor-add")!.click();
    naming.querySelector("input")!.value = "new";
    naming.querySelector("form")!.requestSubmit();
    expect(select.value).toBe("new");
    css.value = ".menu-button { opacity: .8; }"; css.dispatchEvent(new Event("input"));
    expect(styles).toEqual({ icons: "& { --icon: none; }", new: css.value });
  } finally { editor.destroy(); }
});
