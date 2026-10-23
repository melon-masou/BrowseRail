import { expect, it } from "vitest";
import { externalActionSaveError } from "./external-actions";

const rules = new Set(["reader"]);

it("lets events carry any text but requires JSON data for extensions", () => {
  const event = { uid: "a", name: "Run", urlRuleUid: "reader", target: "event", eventName: "go", data: "translate" } as const;
  expect(externalActionSaveError(event, rules)).toBeUndefined();
  expect(externalActionSaveError({ ...event, target: "extension", extensionId: "other" }, rules)).toContain("not valid JSON");
  expect(externalActionSaveError({ ...event, target: "extension", extensionId: "other", data: '{"command":"translate"}' }, rules)).toBeUndefined();
});

it("requires a URL rule, accepting all URLs, and a target before saving", () => {
  const action = { uid: "a", name: "Run", target: "event", eventName: "go" } as const;
  expect(externalActionSaveError(action, rules)).toContain("no URL rule");
  expect(externalActionSaveError({ ...action, urlRuleUid: "removed" }, rules)).toContain("no URL rule");
  expect(externalActionSaveError({ ...action, urlRuleUid: "*" }, rules)).toBeUndefined();
  const { eventName: _, ...unnamed } = action;
  expect(externalActionSaveError({ ...unnamed, urlRuleUid: "*" }, rules)).toContain("event name");
});
