import { describe, expect, it, vi } from "vitest";
import type { StoredMenu } from "@browserail/protocol";

import { runTabAction, toggleTargetMenus } from "./menu-actions";

function menu(uid: string, enabled?: boolean): StoredMenu {
  return { uid, items: [], ...(enabled === undefined ? {} : { enabled }) };
}

describe("menu visibility action", () => {
  it("hides an enabled group without changing its source or unselected menus", () => {
    const result = toggleTargetMenus(
      [menu("source"), menu("a", true), menu("b"), menu("other", true)],
      "source",
      ["source", "a", "b"],
    );
    expect(result?.filter((entry) => entry.enabled === false).map((entry) => entry.uid)).toEqual(["a", "b"]);
    expect(result?.find((entry) => entry.uid === "source")?.enabled).not.toBe(false);
    expect(result?.find((entry) => entry.uid === "other")?.enabled).toBe(true);
  });

  it("shows every selected menu when a group has mixed visibility", () => {
    const result = toggleTargetMenus([menu("a", false), menu("b", true)], "source", ["a", "b"]);
    expect(result?.every((entry) => entry.enabled === true)).toBe(true);
  });

  it("does nothing when all targets have been deleted or only refer to itself", () => {
    expect(toggleTargetMenus([menu("source")], "source", ["source", "deleted"])).toBeUndefined();
  });
});

describe("browser action", () => {
  it.each(["back", "forward", "reload"] as const)("runs %s on the active tab of the target window", async (kind) => {
    const actedOn: Array<{ kind: string; tabId: number }> = [];
    const tabs = {
      query: vi.fn(async ({ windowId }: { windowId: number }) => [{ id: windowId === 42 ? 17 : 99 }]),
      goBack: async (tabId: number) => { actedOn.push({ kind: "back", tabId }); },
      goForward: async (tabId: number) => { actedOn.push({ kind: "forward", tabId }); },
      reload: async (tabId: number) => { actedOn.push({ kind: "reload", tabId }); },
    };
    await runTabAction(tabs, "42", kind);
    expect(actedOn).toEqual([{ kind, tabId: 17 }]);
  });

  it("does not navigate another window when the target has no active tab", async () => {
    const tabs = {
      query: vi.fn(async () => []),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
    };
    await runTabAction(tabs, "42", "back");
    expect(tabs.goBack).not.toHaveBeenCalled();
    expect(tabs.goForward).not.toHaveBeenCalled();
    expect(tabs.reload).not.toHaveBeenCalled();
  });
});
