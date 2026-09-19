import { describe, expect, it } from "vitest";

import {
  EXPORT_SCHEMA_VERSION,
  formatActionUid,
  invertBookmarkActionUid,
  isExportedSettingsData,
  isServerMessage,
  isSpecialRootPlaceholder,
  parseBookmarkAction,
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

describe("actionUid wire protocol", () => {
  it("formats standard bookmark and folder action uids", () => {
    expect(formatActionUid("bookmark", "123")).toBe("bookmark:123");
    expect(formatActionUid("folder", "456")).toBe("folder:456");
  });

  it("formats bookmark with newTab tabMode", () => {
    expect(formatActionUid("bookmark", "123", "newTab")).toBe("bookmark:123?tab=newTab");
    expect(formatActionUid("bookmark", "123", "replace")).toBe("bookmark:123");
  });

  it("parses bookmark action uids", () => {
    expect(parseBookmarkAction("bookmark:123")).toEqual({
      bookmarkId: "123",
      tabMode: "replace",
    });
    expect(parseBookmarkAction("bookmark:123?tab=newTab")).toEqual({
      bookmarkId: "123",
      tabMode: "newTab",
    });
  });

  it("throws on non-bookmark action uids", () => {
    expect(() => parseBookmarkAction("folder:456")).toThrow(
      "The action is not a bookmark navigation",
    );
  });

  it("inverts bookmark open mode for one-off right-click invocation", () => {
    expect(invertBookmarkActionUid("bookmark:123")).toBe("bookmark:123?tab=newTab");
    expect(invertBookmarkActionUid("bookmark:123?tab=newTab")).toBe("bookmark:123");
  });
});

describe("special root placeholders", () => {
  it("identifies special root placeholders", () => {
    expect(isSpecialRootPlaceholder("${bookmarks-bar}")).toBe(true);
    expect(isSpecialRootPlaceholder("${other}")).toBe(true);
    expect(isSpecialRootPlaceholder("${mobile}")).toBe(true);
    expect(isSpecialRootPlaceholder("${managed}")).toBe(true);
    expect(isSpecialRootPlaceholder("normal-folder")).toBe(false);
  });
});

describe("URL pattern matching", () => {
  it("matches domain patterns including subdomains", async () => {
    const { matchUrlPattern, isUrlMatchingSet } = await import("./index");
    expect(matchUrlPattern("github.com", "https://github.com/microsoft/vscode")).toBe(true);
    expect(matchUrlPattern("github.com", "https://gist.github.com/test")).toBe(true);
    expect(matchUrlPattern("github.com", "https://fakegithub.com/test")).toBe(false);
    expect(matchUrlPattern("github.com", "https://gitlab.com/test")).toBe(false);

    expect(isUrlMatchingSet("https://github.com/test", ["github.com", "google.com"])).toBe(true);
    expect(isUrlMatchingSet("https://bing.com/test", ["github.com", "google.com"])).toBe(false);
  });

  it("matches domain with path prefix", async () => {
    const { matchUrlPattern } = await import("./index");
    expect(matchUrlPattern("bilibili.com/video", "https://www.bilibili.com/video/BV123")).toBe(true);
    expect(matchUrlPattern("bilibili.com/video", "https://www.bilibili.com/anime/123")).toBe(false);
  });

  it("matches wildcard patterns", async () => {
    const { matchUrlPattern } = await import("./index");
    expect(matchUrlPattern("*.google.com", "https://mail.google.com/mail")).toBe(true);
    expect(matchUrlPattern("https://*.google.com/*", "https://www.google.com/search?q=hi")).toBe(true);
    expect(matchUrlPattern("*://localhost:*/*", "http://localhost:3000/app")).toBe(true);
    expect(matchUrlPattern("*://localhost:*/*", "https://remote.com/app")).toBe(false);
  });

  it("matches regex patterns", async () => {
    const { matchUrlPattern } = await import("./index");
    expect(matchUrlPattern("/^https:\\/\\/.*\\.dev\\//", "https://app.dev/home")).toBe(true);
    expect(matchUrlPattern("/^https:\\/\\/.*\\.dev\\//", "https://app.com/home")).toBe(false);
  });

  it("handles empty or invalid patterns gracefully", async () => {
    const { matchUrlPattern, isUrlMatchingSet } = await import("./index");
    expect(matchUrlPattern("", "https://github.com")).toBe(false);
    expect(matchUrlPattern("   ", "https://github.com")).toBe(false);
    expect(matchUrlPattern("github.com", "")).toBe(false);
    expect(isUrlMatchingSet("", ["github.com"])).toBe(false);
    expect(isUrlMatchingSet("https://github.com", [])).toBe(false);
  });
});
