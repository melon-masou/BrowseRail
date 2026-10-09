import { beforeEach, expect, it, vi } from "vitest";
import type { ExternalAction, UrlRule } from "@browserail/protocol";

const mocks = vi.hoisted(() => ({
  tab: { id: 7, url: "https://example.com/read" } as { id?: number; url?: string },
  authorization: { extensionsEnabled: false, extensionIds: [] as string[], userscriptEnabled: true, token: "t".repeat(16) },
  authorized: true,
  runtimeSend: vi.fn<(id: string, message: unknown) => Promise<unknown>>(),
  tabSend: vi.fn<(tabId: number, message: unknown, options: unknown) => Promise<unknown>>(),
}));
vi.mock("webextension-polyfill", () => ({ default: {
  tabs: { query: async () => [mocks.tab], sendMessage: mocks.tabSend },
  runtime: { sendMessage: mocks.runtimeSend },
} }));
vi.mock("../../lib/config/external-authorization-store", () => ({ loadExternalAuthorization: async () => mocks.authorization }));
vi.mock("../../lib/browser/site-permissions", () => ({ hasWebsitePermission: async () => mocks.authorized }));

const { runExternalAction } = await import("./external-action");
const rules: UrlRule[] = [{ uid: "reader", name: "Reader", patterns: ["example.com/read"] }];
const event: ExternalAction = { uid: "a", name: "Translate", urlRuleUid: "reader", target: "event", eventName: "browserail:run:${token}", data: '{"command":"translate"}' };

beforeEach(() => {
  mocks.tab = { id: 7, url: "https://example.com/read" };
  mocks.authorization.userscriptEnabled = true;
  mocks.authorized = true;
  mocks.runtimeSend.mockReset().mockResolvedValue({ ignored: true });
  mocks.tabSend.mockReset().mockResolvedValue(true);
});

it("sends the parsed JSON to an extension on any page for all URLs and ignores the reply", async () => {
  mocks.tab = { id: 7 };
  await runExternalAction({ uid: "b", name: "Ext", urlRuleUid: "*", target: "extension", extensionId: "other", data: '{"type":"go","n":1}' }, rules, "1");
  await runExternalAction({ uid: "c", name: "Empty", urlRuleUid: "*", target: "extension", extensionId: "other" }, rules, "1");
  expect(mocks.runtimeSend.mock.calls).toEqual([["other", { type: "go", n: 1 }], ["other", null]]);
});

it("reports a failed extension send", async () => {
  mocks.runtimeSend.mockRejectedValue(new Error("Could not establish connection"));
  await expect(runExternalAction({ uid: "b", name: "Ext", urlRuleUid: "*", target: "extension", extensionId: "missing" }, rules, "1"))
    .rejects.toThrow("Could not establish connection");
});

it("dispatches the event with the token filled in and the data as text", async () => {
  await runExternalAction(event, rules, "1");
  expect(mocks.tabSend).toHaveBeenCalledWith(7, {
    type: "externalRunAction", eventName: `browserail:run:${"t".repeat(16)}`, detail: '{"command":"translate"}',
  }, { frameId: 0 });
});

it("refuses to run outside the URL rule, without userscript access, on unauthorized sites, or without a receiver", async () => {
  mocks.tab = { id: 7, url: "https://example.com/other" };
  await expect(runExternalAction(event, rules, "1")).rejects.toThrow("does not match");
  mocks.tab = { id: 7, url: "https://example.com/read" };
  mocks.authorization.userscriptEnabled = false;
  await expect(runExternalAction(event, rules, "1")).rejects.toThrow("interaction with userscripts");
  mocks.authorization.userscriptEnabled = true;
  mocks.authorized = false;
  await expect(runExternalAction(event, rules, "1")).rejects.toThrow("not authorized");
  mocks.authorized = true;
  // A page opened before access was granted has no receiver to acknowledge the event.
  mocks.tabSend.mockRejectedValue(new Error("Receiving end does not exist"));
  await expect(runExternalAction(event, rules, "1")).rejects.toThrow("Reload the page");
  expect(mocks.runtimeSend).not.toHaveBeenCalled();
});
