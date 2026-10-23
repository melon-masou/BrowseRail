import { beforeEach, expect, it, vi } from "vitest";

const resourceJson = vi.hoisted(() => vi.fn<(path: string) => Promise<unknown>>());
vi.mock("@browserail/runtime-adapter", () => ({ getRuntimeAdapter: () => ({ resourceJson }) }));
beforeEach(() => { vi.resetModules(); resourceJson.mockReset(); });

const lucideData = { icons: { bookmark: [["path", { d: "M6 3h12v18l-6-4-6 4z" }]] }, aliases: {} };
const phosphorData = { icons: { house: '<path d="M224 120v96H32z"/>' } };

function stubIconResources() {
  resourceJson.mockImplementation(async path => path.includes("/phosphor/") ? phosphorData : lucideData);
}

it("gives Lucide and Phosphor icons a shared, cached SVG mask while preserving text icons", async () => {
  const { resolveItemIcons } = await import("@browserail/browserail/lib/icons/item-icons");
  stubIconResources();
  const items = [
    { kind: "bookmark", uid: "a", label: "A", icon: { type: "lucide", name: "bookmark" } },
    { kind: "bookmark", uid: "b", label: "B", icon: { type: "phosphor", name: "house" } },
    { kind: "bookmark", uid: "c", label: "C", icon: { type: "text", text: "中" } },
  ] as const;
  const [first, other] = await Promise.all([resolveItemIcons([...items]), resolveItemIcons([...items])]);
  expect(decodeURIComponent(first[0]!.iconMask!)).toContain('d="M6 3h12v18l-6-4-6 4z"');
  // Phosphor fill icons are solid shapes, so the mask must paint their fill.
  expect(decodeURIComponent(first[1]!.iconMask!)).toMatch(/fill="currentColor".*d="M224 120v96H32z"/);
  expect(other.map(item => item.iconMask)).toEqual(first.map(item => item.iconMask));
  expect(first[2]).toEqual(items[2]);
  await resolveItemIcons([...items]);
  expect(resourceJson).toHaveBeenCalledTimes(2);
});

it("rejects Phosphor names missing from the bundled set", async () => {
  const { resolveItemIcons } = await import("@browserail/browserail/lib/icons/item-icons");
  stubIconResources();
  await expect(resolveItemIcons([{ kind: "bookmark", uid: "a", label: "A", icon: { type: "phosphor", name: "missing" } }]))
    .rejects.toThrow("Unknown Phosphor icon");
});

it("does not load icon data for bars with only text icons", async () => {
  const { resolveItemIcons } = await import("@browserail/browserail/lib/icons/item-icons");
  const items = [
    { kind: "bookmark", uid: "a", label: "A", icon: { type: "initial" } },
    { kind: "bookmark", uid: "b", label: "B", icon: { type: "text", text: "中" } },
  ] as const;
  expect(await resolveItemIcons([...items])).toEqual(items);
  expect(resourceJson).not.toHaveBeenCalled();
});
