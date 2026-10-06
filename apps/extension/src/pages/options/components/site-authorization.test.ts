// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const permission = vi.hoisted(() => ({
  origins: [] as string[],
  gesture: false,
  getAll: vi.fn<() => Promise<{ origins: string[] }>>(),
  request: vi.fn<(value: { origins: string[] }) => Promise<boolean>>(),
}));
vi.mock("webextension-polyfill", () => ({
  default: {
    permissions: {
      getAll: permission.getAll,
      contains: async ({ origins }: { origins: string[] }) =>
        origins.every((origin) => permission.origins.includes(origin)),
      remove: async () => {
        permission.origins = [];
        return true;
      },
      request: permission.request,
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  },
}));
import { createSiteAuthorization } from "./site-authorization";

beforeEach(() => {
  vi.stubGlobal("__BROWSERAIL_TARGET__", "firefox");
  permission.getAll.mockImplementation(async () => ({ origins: permission.origins }));
});
afterEach(() => {
  document.body.replaceChildren();
  permission.request.mockReset();
  permission.getAll.mockReset();
  vi.unstubAllGlobals();
});
function click(button: HTMLButtonElement): void {
  permission.gesture = true;
  button.click();
  permission.gesture = false;
}
function button(parent: ParentNode, title: string): HTMLButtonElement {
  return [...parent.querySelectorAll("button")].find((button) => button.textContent === title)!;
}

it("allows website grants for userscript access in native mode and reports when grants are unnecessary", async () => {
  permission.origins = [];
  permission.request.mockImplementation(async ({ origins }) => {
    permission.origins = origins;
    return true;
  });
  const root = document.createElement("div");
  document.body.append(root);
  let enabled = true;
  const rules = [{ uid: "rule", name: "Rule", patterns: ["example.com"] }];
  const controller = createSiteAuthorization({
    root, warning: document.createElement("span"), getMode: () => "native",
    getUserscriptEnabled: () => enabled, getRules: () => rules, hasUnsavedRules: () => false,
  });
  controller.refresh(rules);
  expect(button(root, "Grant permission").hidden).toBe(false);
  click(button(root, "Grant permission"));
  const dialog = document.querySelector("dialog")!;
  await vi.waitFor(() => expect(dialog.open).toBe(true));
  click(button(dialog, "Confirm"));
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  expect(permission.origins).toEqual(["http://*.example.com/*", "https://*.example.com/*"]);
  enabled = false;
  controller.render();
  expect(button(root, "Grant permission").disabled).toBe(true);
  expect(button(root, "Grant permission").hidden).toBe(false);
  expect(button(root, "Revoke permission").hidden).toBe(false);
  expect(root.textContent).toContain("Browser permission: not required");
  await vi.waitFor(() => expect(button(root, "Revoke permission").disabled).toBe(false));
  click(button(root, "Revoke permission"));
  await vi.waitFor(() => expect(permission.origins).toEqual([]));
  await vi.waitFor(() => expect(button(root, "Revoke permission").disabled).toBe(true));
  expect(root.textContent).toContain("Browser permission: not required");
  controller.destroy();
});

it("replaces old website access only after confirmation and requests the new scope from a fresh click", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  permission.origins = ["https://old.example/*"];
  permission.request.mockImplementation(async ({ origins }) => {
    if (!permission.gesture) throw new Error("Requires a user gesture");
    permission.origins = origins;
    return true;
  });
  const rules = [
    { uid: "new", name: "New", patterns: ["example.com"] },
    { uid: "regex", name: "Regex", patterns: ["/regex/"] },
  ];
  const controller = createSiteAuthorization({
    root,
    warning: document.createElement("span"),
    getMode: () => "browser",
    hasUnsavedRules: () => false,
    getRules: () => rules,
  });
  controller.refresh(rules);
  click(button(root, "Grant permission"));
  const dialog = document.querySelector("dialog")!;
  await vi.waitFor(() => expect(dialog.open).toBe(true));
  expect(dialog.textContent).toContain("https://old.example/*");
  expect(dialog.textContent).toContain("/regex/");
  click(button(dialog, "Cancel"));
  expect(permission.origins).toEqual(["https://old.example/*"]);
  click(button(root, "Grant permission"));
  await vi.waitFor(() => expect(dialog.open).toBe(true));
  click(button(dialog, "Confirm"));
  await vi.waitFor(() => expect(button(dialog, "Grant permission")?.disabled).toBe(false));
  expect(permission.origins).toEqual([]);
  expect(permission.request).not.toHaveBeenCalled();
  click(button(dialog, "Grant permission"));
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  expect(permission.origins).toEqual(["http://*.example.com/*", "https://*.example.com/*"]);
});

it("reports when browser permissions are needed and requests first-time access without an extra step", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  let mode: "native" | "browser" = "browser";
  permission.origins = [];
  permission.request.mockImplementation(async ({ origins }) => {
    if (!permission.gesture) throw new Error("Requires a user gesture");
    permission.origins = origins;
    return true;
  });
  const rules = [{ uid: "rule", name: "Rule", patterns: ["example.com"] }];
  const controller = createSiteAuthorization({
    root,
    warning: document.createElement("span"),
    getMode: () => mode,
    hasUnsavedRules: () => false,
    getRules: () => rules,
  });
  controller.refresh(rules);
  await vi.waitFor(() => expect(root.textContent).toContain("Browser permission: not granted"));
  mode = "native";
  controller.refresh(rules);
  expect(button(root, "Grant permission").disabled).toBe(true);
  expect(button(root, "Grant permission").hidden).toBe(false);
  expect(button(root, "Revoke permission").hidden).toBe(false);
  expect(root.textContent).toContain("Browser permission: not required");
  mode = "browser";
  controller.refresh(rules);
  click(button(root, "Grant permission"));
  const dialog = document.querySelector("dialog")!;
  await vi.waitFor(() => expect(dialog.open).toBe(true));
  click(button(dialog, "Confirm"));
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  expect(permission.origins).toEqual(["http://*.example.com/*", "https://*.example.com/*"]);
  await vi.waitFor(() => expect(root.textContent).toContain("Browser permission: granted"));
  click(button(root, "Revoke permission"));
  await vi.waitFor(() => expect(permission.origins).toEqual([]));
  await vi.waitFor(() => expect(root.textContent).toContain("Browser permission: not granted"));
});

it.each(["chrome", "edge", undefined])(
  "uses one confirmation after revoking old permissions for target %s",
  async (target) => {
    vi.stubGlobal("__BROWSERAIL_TARGET__", target);
    const root = document.createElement("div");
    document.body.append(root);
    permission.origins = ["https://old.example/*"];
    permission.request.mockImplementation(async ({ origins }) => {
      if (permission.origins.length) throw new Error("Old permissions must be revoked first");
      permission.origins = origins;
      return true;
    });
    const rules = [{ uid: "new", name: "New", patterns: ["example.com"] }];
    createSiteAuthorization({
      root,
      warning: document.createElement("span"),
      getMode: () => "browser",
      hasUnsavedRules: () => false,
      getRules: () => rules,
    }).refresh(rules);
    click(button(root, "Grant permission"));
    const dialog = document.querySelector("dialog")!;
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    click(button(dialog, "Confirm"));
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    expect(permission.origins).toEqual(["http://*.example.com/*", "https://*.example.com/*"]);
  },
);

it("keeps saved authorization warnings during editing and while the next saved check is pending", async () => {
  permission.origins = ["https://other.example/*"];
  const root = document.createElement("div");
  const warning = document.createElement("span");
  document.body.append(root);
  const rules = [{ uid: "rule", name: "Rule", patterns: ["example.com"] }];
  const controller = createSiteAuthorization({
    root,
    warning,
    getMode: () => "browser",
    hasUnsavedRules: () => true,
    getRules: () => rules,
  });
  controller.refresh(rules);
  await vi.waitFor(() => expect(warning.textContent).toBe("Browser permission: not fully granted"));
  const calls = permission.getAll.mock.calls.length;
  rules[0]!.patterns = ["/regex/"];
  controller.render();
  expect(warning.textContent).toBe("Browser permission: not fully granted");
  expect(permission.getAll.mock.calls.length).toBe(calls);
  let finish!: (value: { origins: string[] }) => void;
  permission.getAll.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  controller.refresh(rules);
  expect(warning.textContent).toBe("Browser permission: not fully granted");
  finish({ origins: permission.origins });
  await vi.waitFor(() => expect(warning.textContent).toBe("Browser permission: granted"));
});
