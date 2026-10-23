import { beforeEach, expect, it, vi } from "vitest";

const resourceJson = vi.hoisted(() => vi.fn<(path: string) => Promise<unknown>>());
vi.mock("@browserail/runtime-adapter", () => ({ getRuntimeAdapter: () => ({ resourceJson }) }));
beforeEach(() => { vi.resetModules(); resourceJson.mockReset(); });

it("resolves Lucide aliases to their canonical geometry", async () => {
  const { loadLucideCatalog } = await import("@browserail/browserail/lib/icons/lucide");
  resourceJson.mockResolvedValue({
    icons: {
      bookmark: [["path", { d: "M6 3h12v18l-6-4-6 4z" }]],
      house: [["path", { d: "M3 10l9-7 9 7" }]],
    },
    aliases: { home: "house" },
  });
  const catalog = await loadLucideCatalog();
  expect(catalog.names).toEqual(["bookmark", "home", "house"]);
  const home = catalog.iconUrl("home");
  expect(home).toBe(catalog.iconUrl("house"));
  expect(decodeURIComponent(home)).toContain('d="M3 10l9-7 9 7"');
  expect(() => catalog.iconUrl("unknown-icon")).toThrow("Unknown Lucide icon");
});
