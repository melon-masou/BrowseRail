import { beforeEach, expect, it, vi } from "vitest";

const permissions = vi.hoisted(() => ({
  origins: [] as string[], contains: vi.fn<(permissions: { origins: string[] }) => Promise<boolean>>(),
}));
vi.mock("webextension-polyfill", () => ({ default: { permissions: {
  getAll: async () => ({ origins: permissions.origins }),
  contains: permissions.contains,
  remove: async ({ origins }: { origins: string[] }) => {
    permissions.origins = permissions.origins.filter(origin => !origins.includes(origin)); return true;
  },
} } }));

import { hasWebsitePermission, incompleteRuleUids, loadWebsiteOrigins, revokeWebsitePermissions, ruleSites } from "./site-permissions";

beforeEach(() => { permissions.origins = []; permissions.contains.mockReset(); });

it("requests the domain and subdomains of bare domain rules, preserving an explicit URL scheme", () => {
  expect(ruleSites({ uid: "web", name: "Web", patterns: ["github.com", "github.com/docs", "https://example.com/docs", "*.google.com", "*://localhost:*/*"] })).toMatchObject({
    origins: ["http://*.github.com/*", "https://*.github.com/*", "https://example.com/*", "http://*.google.com/*", "https://*.google.com/*", "http://localhost/*", "https://localhost/*"], unsupported: [],
  });
});

it("does not silently turn regex, ambiguous prefixes or unsupported URLs into a broader grant", () => {
  const result = ruleSites({ uid: "web", name: "Web", patterns: ["/^https:\\/\\/example/", "https://example.com", "https://foo*.com/*", "chrome://newtab/", "example.com/docs"] });
  expect(result.origins).toEqual(["http://*.example.com/*", "https://*.example.com/*"]);
  expect(result.unsupported.map(item => item.pattern)).toEqual(["/^https:\\/\\/example/", "https://example.com", "https://foo*.com/*", "chrome://newtab/"]);
});

it("flags incomplete convertible rules while excluding unsupported and empty rules", async () => {
  permissions.contains.mockImplementation(async ({ origins }) => origins.every(origin => ["http://*.github.com/*", "https://*.github.com/*"].includes(origin)));
  const rules = [
    { uid: "complete", name: "Complete", patterns: ["github.com"] },
    { uid: "partial", name: "Partial", patterns: ["github.com", "example.com", "/regex/"] },
    { uid: "regex", name: "Regex", patterns: ["/regex/"] },
    { uid: "empty", name: "Empty", patterns: [] },
  ].map(ruleSites);
  expect(await incompleteRuleUids(rules)).toEqual(new Set(["partial"]));
});

it("recognizes full HTTP and HTTPS authorization for wildcard-scheme rules", async () => {
  // Reproduce Chrome's result: full grants cover explicit schemes, but not
  // a wildcard-scheme permissions.contains query.
  permissions.contains.mockImplementation(async ({ origins }) => origins.every(origin => /^https?:\/\//.test(origin)));
  const rules = [{ uid: "domain", name: "Domain", patterns: ["github.com", "*.google.com"] }].map(ruleSites);
  expect(await incompleteRuleUids(rules)).toEqual(new Set());
  permissions.contains.mockImplementation(async ({ origins }) => origins.every(origin => origin.startsWith("https://")));
  expect(await incompleteRuleUids(rules)).toEqual(new Set(["domain"]));
});

it("checks website access and rejects browser UI without asking for any permissions", async () => {
  permissions.contains.mockResolvedValue(true);
  expect(await hasWebsitePermission("https://example.com:8080/docs")).toBe(true);
  expect(await hasWebsitePermission("chrome://extensions/")).toBe(false);
  expect(await hasWebsitePermission(undefined)).toBe(false);
  permissions.contains.mockResolvedValue(false);
  expect(await hasWebsitePermission("https://example.com/")).toBe(false);
});

it("revokes website access without removing other granted APIs or file access", async () => {
  permissions.origins = ["https://example.com/*", "file:///*"];
  expect(await loadWebsiteOrigins()).toEqual(["https://example.com/*"]);
  await revokeWebsitePermissions();
  expect(permissions.origins).toEqual(["file:///*"]);
});


it("does not request or report comments and excluded sites as authorization targets", () => {
  expect(ruleSites({ uid: "web", name: "Web", patterns: [" # private context", "example.com", "!other.com", "!/^https:/", "# comment"] })).toMatchObject({
    origins: ["http://*.example.com/*", "https://*.example.com/*"], unsupported: [],
  });
});
