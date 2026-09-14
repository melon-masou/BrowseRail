import { describe, expect, it } from "vitest";

import { isServerMessage, PROTOCOL_VERSION } from "./index";

describe("isServerMessage", () => {
  it("accepts an invocation with an explicit target window", () => {
    expect(
      isServerMessage({
        type: "invoke",
        requestUid: "request-1",
        actionUid: "bookmark-1",
        windowUid: "window-1",
      }),
    ).toBe(true);
  });

  it("rejects an invocation without a target window", () => {
    expect(
      isServerMessage({
        type: "invoke",
        requestUid: "request-1",
        actionUid: "bookmark-1",
      }),
    ).toBe(false);
  });

  it("rejects incompatible protocol versions", () => {
    expect(
      isServerMessage({ type: "ready", protocolVersion: PROTOCOL_VERSION + 1 }),
    ).toBe(false);
  });
});
