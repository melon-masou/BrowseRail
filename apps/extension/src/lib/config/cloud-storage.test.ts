import { beforeEach, expect, it, vi } from "vitest";
import { defaultBarSettings, EXPORT_SCHEMA_VERSION, type ExportedSettingsData } from "@browserail/protocol";

const mocks = vi.hoisted(() => ({
  local: {} as Record<string, unknown>,
  cloud: {} as Record<string, unknown>,
  failUpload: false,
  readCloud: vi.fn(),
  writeCloud: vi.fn(),
}));
vi.mock("webextension-polyfill", () => ({ default: { storage: {
  local: {
    get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(mocks.local[key])])),
    set: async (values: Record<string, unknown>) => { Object.assign(mocks.local, structuredClone(values)); },
  },
  sync: {
    get: async () => { mocks.readCloud(); return structuredClone(mocks.cloud); },
    set: async (values: Record<string, unknown>) => {
      mocks.writeCloud();
      if (mocks.failUpload) throw new Error("Upload unavailable");
      for (const [key, value] of Object.entries(values)) {
        if (new TextEncoder().encode(key + JSON.stringify(value)).length > 8192) throw new Error("QUOTA_BYTES_PER_ITEM quota exceeded");
      }
      Object.assign(mocks.cloud, structuredClone(values));
    },
    remove: async (keys: string[]) => { for (const key of keys) delete mocks.cloud[key]; },
  },
} } }));

import { downloadCloudSettings, uploadCloudSettings } from "./cloud-storage";
import { loadConfig, saveConfig } from "./index";

beforeEach(() => {
  mocks.local = {}; mocks.cloud = {}; mocks.failUpload = false;
  mocks.readCloud.mockClear(); mocks.writeCloud.mockClear();
});

function snapshot(): ExportedSettingsData {
  return {
    version: EXPORT_SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    menus: [{ uid: "bar", items: [{ uid: "link", type: "static", staticUid: "docs" }], cssClass: "transparent" }],
    staticBookmarks: [{ uid: "docs", name: "Docs", url: "https://example.com" }],
    globalCss: { icons: "& { --icon: none; }" },
    shortcuts: [{ slot: "slot_1", type: "static", staticUid: "docs" }],
    nativeShortcutSets: [{ uid: "docs-keys", name: "Docs", urlRuleUids: ["docs"], shortcuts: [{ id: "docs-key", key: "F1", type: "static", staticUid: "docs" }] }],
    barConfigurations: { native: {}, browser: { bar: { ...defaultBarSettings(), placement: { boundPosition: { anchor: "topLeft", offsetX: 20, offsetY: 40 }, itemWidth: 100, itemHeight: 32 }, gapRatio: .2, extraGaps: {} } } },
  };
}

it("reads and saves local CSS without consulting stale cloud data or the removed sync switch", async () => {
  mocks.local.sync_enabled = true;
  mocks.cloud.sync_menus = { menus: [], globalCss: "old" };
  const config = await loadConfig();
  config.globalCss = { theme: "new" };
  config.panel.menus = [{ uid: "bar", items: [], cssClass: "local" }];
  await saveConfig(config);
  expect(await loadConfig()).toMatchObject({ globalCss: { theme: "new" }, panel: { menus: [{ cssClass: "local" }] } });
  expect(mocks.readCloud).not.toHaveBeenCalled();
  expect(mocks.writeCloud).not.toHaveBeenCalled();
});

it("round trips large CSS, Unicode, references and bindings under the browser's per-item quota", async () => {
  const data = snapshot();
  data.globalCss = { icons: '/* 中文 😀 \\" */\n'.repeat(1500) };
  data.globalCss.theme = "& { --bar-background: transparent; }\n".repeat(1000);
  await uploadCloudSettings(data);
  expect(await downloadCloudSettings()).toMatchObject(data);
  expect(await loadConfig()).not.toHaveProperty("globalCss");
});

it("stores exactly the supplied categories, without fabricating absent collections", async () => {
  const data = snapshot();
  await uploadCloudSettings(data);
  await uploadCloudSettings({ version: data.version, exportedAt: data.exportedAt, menus: [] });
  expect(await downloadCloudSettings()).toEqual({ version: data.version, exportedAt: data.exportedAt, menus: [] });
});

it("failed uploads preserve both the previous cloud snapshot and local settings", async () => {
  const data = snapshot();
  await uploadCloudSettings(data);
  const config = await loadConfig(); config.globalCss = { theme: "local edit" };
  await saveConfig(config);
  mocks.failUpload = true;
  await expect(uploadCloudSettings({ ...data, globalCss: { theme: "replacement" } })).rejects.toThrow("Upload unavailable");
  expect(await downloadCloudSettings()).toMatchObject(data);
  expect((await loadConfig()).globalCss).toEqual({ theme: "local edit" });
});

it("rejects missing chunks without changing local configuration", async () => {
  const data = snapshot(); await uploadCloudSettings(data);
  const missing = Object.keys(mocks.cloud).find(key => typeof mocks.cloud[key] === "string")!;
  delete mocks.cloud[missing];
  const config = await loadConfig(); await saveConfig(config);
  await expect(downloadCloudSettings()).rejects.toThrow();
  expect(await loadConfig()).toEqual(config);
});

it("does not automatically restore the old cloud format", async () => {
  mocks.cloud.sync_menus = { menus: [{ uid: "old", items: [] }] };
  await expect(downloadCloudSettings()).rejects.toThrow();
  expect((await loadConfig()).panel.menus).toEqual([]);
});

it("keeps the other cloud settings while discarding old flat Native bindings", async () => {
  const data = snapshot();
  await uploadCloudSettings(data);
  const manifest = mocks.cloud["cloud:index"] as { fields: Record<string, string[]> };
  delete manifest.fields.nativeShortcutSets;
  manifest.fields.nativeShortcuts = ["cloud:nativeShortcuts:old:0"];
  mocks.cloud["cloud:nativeShortcuts:old:0"] = JSON.stringify([{ id: "old", key: "c", type: "browserAction", browserAction: "back" }]);
  const downloaded = await downloadCloudSettings();
  expect(downloaded.menus).toEqual(data.menus);
  expect(downloaded.shortcuts).toEqual(data.shortcuts);
  expect(downloaded.nativeShortcutSets ?? []).toEqual([]);
});

it("keeps which instance exported the copy and when, so the receiving device can show its source", async () => {
  const data = { ...snapshot(), exportedAt: "2026-10-09T14:31:00.000Z", exportedBy: "Laptop" };
  await uploadCloudSettings(data);
  expect(await downloadCloudSettings()).toMatchObject({ exportedAt: "2026-10-09T14:31:00.000Z", exportedBy: "Laptop" });
});
