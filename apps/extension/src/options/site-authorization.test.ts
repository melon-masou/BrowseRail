// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const permission = vi.hoisted(() => ({
  origins: [] as string[], gesture: false,
  getAll: vi.fn<() => Promise<{ origins: string[] }>>(),
  request: vi.fn<(value: { origins: string[] }) => Promise<boolean>>(),
}));
vi.mock("webextension-polyfill", () => ({ default: { permissions: {
  getAll: permission.getAll,
  contains: async ({ origins }: { origins: string[] }) => origins.every(origin => permission.origins.includes(origin)),
  remove: async () => { permission.origins = []; return true; },
  request: permission.request,
  onAdded: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() },
} } }));
import { createSiteAuthorization } from "./site-authorization";

beforeEach(() => {
  vi.stubGlobal("__BROWSERAIL_TARGET__", "firefox");
  permission.getAll.mockImplementation(async () => ({ origins: permission.origins }));
});
afterEach(() => { document.body.replaceChildren(); permission.request.mockReset(); permission.getAll.mockReset(); vi.unstubAllGlobals(); });
function click(button: HTMLButtonElement): void {
  permission.gesture = true; button.click(); permission.gesture = false;
}
function button(parent: ParentNode, title: string): HTMLButtonElement {
  return [...parent.querySelectorAll("button")].find(button => button.textContent === title)!;
}

it("replaces old website access only after confirmation and requests the new scope from a fresh click", async () => {
  const root = document.createElement("div"); document.body.append(root);
  permission.origins = ["https://old.example/*"];
  permission.request.mockImplementation(async ({ origins }) => {
    if (!permission.gesture) throw new Error("Requires a user gesture");
    permission.origins = origins; return true;
  });
  const rules = [
    { uid: "new", name: "New", patterns: ["example.com"] },
    { uid: "regex", name: "Regex", patterns: ["/regex/"] },
  ];
  const controller = createSiteAuthorization({ root, warning: document.createElement("span"), getMode: () => "browser", hasUnsavedRules: () => false,
    getRules: () => rules,
  });
  controller.refresh(rules);
  click(button(root, "Website authorization"));
  const dialog = document.querySelector("dialog")!;
  await vi.waitFor(() => expect(dialog.open).toBe(true));
  expect(dialog.textContent).toContain("https://old.example/*");
  expect(dialog.textContent).toContain("/regex/");
  click(button(dialog, "Cancel"));
  expect(permission.origins).toEqual(["https://old.example/*"]);
  click(button(root, "Website authorization")); await vi.waitFor(() => expect(dialog.open).toBe(true));
  click(button(dialog, "Confirm"));
  await vi.waitFor(() => expect(button(dialog, "Authorize")?.disabled).toBe(false));
  expect(permission.origins).toEqual([]); expect(permission.request).not.toHaveBeenCalled();
  click(button(dialog, "Authorize"));
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  expect(permission.origins).toEqual(["http://*.example.com/*", "https://*.example.com/*"]);
});

it("hides authorization controls and rule warnings in native and requests first-time access without an extra step", async () => {
  const root = document.createElement("div"); document.body.append(root);
  const ruleWarning = document.createElement("span"); ruleWarning.dataset.rulePermission = "rule"; document.body.append(ruleWarning);
  let mode: "native" | "browser" = "browser";
  permission.origins = [];
  permission.request.mockImplementation(async ({ origins }) => {
    if (!permission.gesture) throw new Error("Requires a user gesture");
    permission.origins = origins; return true;
  });
  const rules = [{ uid: "rule", name: "Rule", patterns: ["example.com"] }];
  const controller = createSiteAuthorization({ root, warning: document.createElement("span"), getMode: () => mode, hasUnsavedRules: () => false,
    getRules: () => rules,
  });
  controller.refresh(rules); await vi.waitFor(() => expect(ruleWarning.hidden).toBe(false));
  mode = "native"; controller.refresh(rules);
  expect(root.hidden).toBe(true); expect(ruleWarning.hidden).toBe(true);
  mode = "browser"; controller.refresh(rules);
  click(button(root, "Website authorization"));
  const dialog = document.querySelector("dialog")!; await vi.waitFor(() => expect(dialog.open).toBe(true));
  click(button(dialog, "Confirm"));
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  expect(permission.origins).toEqual(["http://*.example.com/*", "https://*.example.com/*"]);
  await vi.waitFor(() => expect(ruleWarning.hidden).toBe(true));
  click(button(root, "Revoke authorization"));
  await vi.waitFor(() => expect(permission.origins).toEqual([]));
  await vi.waitFor(() => expect(ruleWarning.hidden).toBe(false));
});

it.each(["chrome", "edge", undefined])("uses one confirmation after revoking old permissions for target %s", async target => {
  vi.stubGlobal("__BROWSERAIL_TARGET__", target);
  const root = document.createElement("div"); document.body.append(root);
  permission.origins = ["https://old.example/*"];
  permission.request.mockImplementation(async ({ origins }) => {
    if (permission.origins.length) throw new Error("Old permissions must be revoked first");
    permission.origins = origins; return true;
  });
  const rules = [{ uid: "new", name: "New", patterns: ["example.com"] }];
  createSiteAuthorization({ root, warning: document.createElement("span"), getMode: () => "browser", hasUnsavedRules: () => false,
    getRules: () => rules,
  }).refresh(rules);
  click(button(root, "Website authorization"));
  const dialog = document.querySelector("dialog")!; await vi.waitFor(() => expect(dialog.open).toBe(true));
  click(button(dialog, "Confirm"));
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  expect(permission.origins).toEqual(["http://*.example.com/*", "https://*.example.com/*"]);
});

it("keeps saved authorization warnings during editing and while the next saved check is pending", async () => {
  permission.origins = [];
  const root = document.createElement("div");
  const warning = document.createElement("span"); warning.dataset.rulePermission = "rule"; warning.hidden = true;
  document.body.append(root, warning);
  const rules = [{ uid: "rule", name: "Rule", patterns: ["example.com"] }];
  const controller = createSiteAuthorization({ root, warning: document.createElement("span"), getMode: () => "browser", hasUnsavedRules: () => true,
    getRules: () => rules,
  });
  controller.refresh(rules); await vi.waitFor(() => expect(warning.hidden).toBe(false));
  const calls = permission.getAll.mock.calls.length;
  rules[0]!.patterns = ["/regex/"];
  controller.render();
  expect(warning.hidden).toBe(false);
  expect(permission.getAll.mock.calls.length).toBe(calls);
  let finish!: (value: { origins: string[] }) => void;
  permission.getAll.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  controller.refresh(rules);
  expect(warning.hidden).toBe(false);
  finish({ origins: [] });
  await vi.waitFor(() => expect(warning.hidden).toBe(true));
});
