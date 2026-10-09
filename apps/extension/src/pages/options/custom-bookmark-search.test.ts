import { describe, expect, it } from "vitest";
import {
  filterCustomBookmarks,
  matchesSearchQuery,
} from "./custom-bookmark-search";
import type { StaticBookmark, TemporaryBookmark, DynamicBookmark, ExternalAction, UrlRule } from "../../lib/config";
import type { CustomBookmarkSource } from "./custom-bookmark-source";

describe("custom-bookmark-search", () => {
  it("matches search query case-insensitively and supports multiple terms", () => {
    expect(matchesSearchQuery("GitHub Personal Project", "")).toBe(true);
    expect(matchesSearchQuery("GitHub Personal Project", "  ")).toBe(true);
    expect(matchesSearchQuery("GitHub Personal Project", "github")).toBe(true);
    expect(matchesSearchQuery("GitHub Personal Project", "GITHUB")).toBe(true);
    expect(matchesSearchQuery("GitHub Personal Project", "git project")).toBe(true);
    expect(matchesSearchQuery("GitHub Personal Project", "git missing")).toBe(false);
  });

  it("extracts searchable text and filters static bookmarks by name, url, or tags", () => {
    const bookmarks: StaticBookmark[] = [
      { uid: "1", name: "GitHub", url: "https://github.com", tags: ["dev", "work"] },
      { uid: "2", name: "GitLab", url: "https://gitlab.com", tags: ["dev"] },
      { uid: "3", name: "News", url: "https://news.ycombinator.com", tags: ["reading"] },
    ];

    expect(filterCustomBookmarks("static", bookmarks, "git")).toHaveLength(2);
    expect(filterCustomBookmarks("static", bookmarks, "work")).toHaveLength(1);
    expect(filterCustomBookmarks("static", bookmarks, "work")[0]?.name).toBe("GitHub");
    expect(filterCustomBookmarks("static", bookmarks, "ycombinator")).toHaveLength(1);
    expect(filterCustomBookmarks("static", bookmarks, "nonexistent")).toHaveLength(0);
  });

  it("searches #terms only in tags and combines them with ordinary keywords", () => {
    const bookmarks: StaticBookmark[] = [
      { uid: "tagged", name: "Raids", url: "https://example.com/list", tags: ["gbf_list"] },
      { uid: "name", name: "#gbf_list", url: "https://example.com/other" },
      { uid: "url", name: "Another", url: "https://example.com/#gbf_list", tags: ["other"] },
    ];
    expect(filterCustomBookmarks("static", bookmarks, "#gbf_list").map(item => item.uid)).toEqual(["tagged"]);
    expect(filterCustomBookmarks("static", bookmarks, "#GBF raids").map(item => item.uid)).toEqual(["tagged"]);
    expect(filterCustomBookmarks("static", bookmarks, "#gbf missing")).toEqual([]);
  });

  it("extracts searchable text and filters temporary bookmarks including live values and notes", () => {
    const bookmarks: TemporaryBookmark[] = [
      { uid: "t1", name: "Temp One" },
      { uid: "t2", name: "Temp Two" },
    ];
    const mockSource = {
      temporaryValues: { t1: "https://example.com/live-url" },
      temporaryNotes: { t2: "Remember to read this later" },
    } as unknown as CustomBookmarkSource;

    expect(filterCustomBookmarks("temporary", bookmarks, "Temp")).toHaveLength(2);
    expect(filterCustomBookmarks("temporary", bookmarks, "live-url", { source: mockSource })).toHaveLength(1);
    expect(filterCustomBookmarks("temporary", bookmarks, "read this", { source: mockSource })).toHaveLength(1);
  });

  it("extracts searchable text and filters dynamic bookmarks including live values, rules, and rewrites", () => {
    const rules: UrlRule[] = [{ uid: "r1", name: "GitHub Rule", patterns: ["*://github.com/*"] }];
    const bookmarks: DynamicBookmark[] = [
      { uid: "d1", name: "Dynamic Docs", type: "rule", urlRuleUid: "r1" },
      { uid: "d2", name: "Rewrite Title", type: "rewrite", rewrite: "url.replace(/foo/, 'bar')" },
    ];
    const mockSource = {
      dynamicValues: { d1: { url: "https://github.com/docs", title: "API Documentation" } },
    } as unknown as CustomBookmarkSource;

    expect(filterCustomBookmarks("dynamic", bookmarks, "GitHub Rule", { source: mockSource, urlRules: rules })).toHaveLength(1);
    expect(filterCustomBookmarks("dynamic", bookmarks, "Documentation", { source: mockSource, urlRules: rules })).toHaveLength(1);
    expect(filterCustomBookmarks("dynamic", bookmarks, "replace", { source: mockSource, urlRules: rules })).toHaveLength(1);
  });

  it("extracts searchable text and filters external actions by name, target details, payload, or rule", () => {
    const rules: UrlRule[] = [{ uid: "r1", name: "Match All", patterns: ["*://*/*"] }];
    const actions: ExternalAction[] = [
      { uid: "e1", name: "Send Action", target: "extension", extensionId: "ext-123", data: '{"type":"SYNC"}', urlRuleUid: "r1" },
      { uid: "e2", name: "Dispatch Event", target: "event", eventName: "custom:event" },
    ];

    expect(filterCustomBookmarks("externalAction", actions, "ext-123", { urlRules: rules })).toHaveLength(1);
    expect(filterCustomBookmarks("externalAction", actions, "custom:event", { urlRules: rules })).toHaveLength(1);
    expect(filterCustomBookmarks("externalAction", actions, "SYNC", { urlRules: rules })).toHaveLength(1);
    expect(filterCustomBookmarks("externalAction", actions, "Match All", { urlRules: rules })).toHaveLength(1);
  });
});
