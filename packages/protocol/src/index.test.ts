import { describe, expect, it } from "vitest";

import {
  EXPORT_SCHEMA_VERSION,
  isExportedSettingsData,
  isServerMessage,
  PROTOCOL_VERSION,
} from "./index";

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

describe("isExportedSettingsData", () => {
  it("validates valid exported settings structure", () => {
    expect(
      isExportedSettingsData({
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: "2026-09-19T00:00:00.000Z",
        menus: [],
      }),
    ).toBe(true);
  });

  it("rejects invalid version", () => {
    expect(
      isExportedSettingsData({
        version: EXPORT_SCHEMA_VERSION + 1,
        exportedAt: "2026-09-19T00:00:00.000Z",
        menus: [],
      }),
    ).toBe(false);
  });

  it("rejects missing or invalid menus", () => {
    expect(
      isExportedSettingsData({
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: "2026-09-19T00:00:00.000Z",
        menus: "not-an-array",
      }),
    ).toBe(false);
  });
});

