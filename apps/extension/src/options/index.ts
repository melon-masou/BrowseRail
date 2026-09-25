import {
  type AttachmentMode,
  AUTO_FONT_SIZE,
  EXPORT_SCHEMA_VERSION,
  type ExportedMenuItem,
  type ExportedSettingsData,
  type ExpandDirection,
  isAutoFontSize,
  isExportedSettingsData,
  type MenuOrientation,
  type OnTopMode,
  type TabMode,
} from "@browserail/protocol";
import browser from "webextension-polyfill";

import {
  createMenu,
  DEFAULT_FONT_SIZE,
  DEFAULT_MENU_GAP_PERCENT,
  type DynamicBookmark,
  type DynamicValuesMap,
  type ExtensionConfig,
  loadBookmarkRootPrefix,
  loadDynamicValues,
  loadConfig,
  loadSyncEnabled,
  loadWidgetEnabled,
  normalizeFontSize,
  normalizeMenu,
  saveBookmarkRootPrefix,
  saveConfig,
  saveSyncEnabled,
  saveWidgetEnabled,
  type StoredMenu,
  type StoredMenuItem,
  type StoredMenuItemType,
  type StoredShortcut,
  type StoredNativeShortcut,
  type UrlRule,
} from "../config";
import {
  buildSpaceDirectiveUrl,
  type BookmarkNode,
  combineRootAndItemPath,
  findBookmarkNodeByPath,
  formatSpecialRootForDisplay,
  getFolderPath,
  getItemRelativePath,
  getSpecialRootTypeFromNode,
  getSpecialRootTypeFromTitle,
  resolveBookmarkNodeByPath,
  SPECIAL_ROOT_PLACEHOLDERS,
} from "../bookmarks";
import { isLocalDesktopUrl, probeDesktopConnection } from "../desktop-connection";
import { browserKind } from "../browser-adapter";
import { createRandomInstanceLabel } from "../instance-label";
import {
  applyStaticI18n,
  getLanguage,
  type Lang,
  LANGUAGES,
  onLanguageChange,
  saveLanguage,
  t,
} from "@browserail/i18n";

import { positionPopover } from "./popover-position";

import "./styles.css";

// A dark, muted palette: each hue at a low-lightness "surface" tone so buttons
// read as one coherent set of tinted-dark chips (with white text) instead of
// saturated category colors. Rendered at (near) full fidelity — WYSIWYG with the
// picker — so this palette IS the look, not a post-render transform.
const PALETTE_COLORS = [
  "#1e3a8a", // Blue
  "#075985", // Sky
  "#155e75", // Cyan
  "#065f46", // Emerald
  "#166534", // Green
  "#3f6212", // Lime
  "#854d0e", // Gold
  "#92400e", // Amber
  "#9a3412", // Orange
  "#991b1b", // Red
  "#9d174d", // Pink
  "#86198f", // Fuchsia
  "#6b21a8", // Purple
  "#3730a3", // Indigo
  "#334155", // Slate
  "#1e293b", // Charcoal
  "#115e59", // Teal
  "#7c2d12", // Rust
  "#831843", // Wine
  "#172554", // Navy
];

function getRandomPaletteColor(): string {
  return PALETTE_COLORS[Math.floor(Math.random() * PALETTE_COLORS.length)] ?? PALETTE_COLORS[0]!;
}

const SETTINGS_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`;
const REMOVE_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg>`;

const connectionForm = element<HTMLFormElement>("connection-form");
const saveConnectionBtn = element<HTMLButtonElement>("save-connection-btn");
const connectionStatus = element<HTMLOutputElement>("connection-status");
const menusForm = element<HTMLFormElement>("menus-form");
const instanceLabel = element<HTMLInputElement>("instance-label");
const randomInstanceLabel = element<HTMLButtonElement>("random-instance-label");
const toggleEnabledButton = element<HTMLButtonElement>("toggle-enabled-button");
const desktopUrl = element<HTMLInputElement>("desktop-url");
const stateCard = element<HTMLDivElement>("state-card");
const stateBadge = element<HTMLSpanElement>("state-badge");
const stateDetail = element<HTMLDivElement>("state-detail");
const testDesktop = element<HTMLButtonElement>("test-desktop");
const desktopTestStatus = element<HTMLOutputElement>("desktop-test-status");
const menusContainer = element<HTMLDivElement>("menus");
const addMenu = element<HTMLButtonElement>("add-menu");
const saveBtn = element<HTMLButtonElement>("save-btn");
const previewBtn = element<HTMLButtonElement>("preview-btn");
const exportBtn = element<HTMLButtonElement>("export-btn");
const importBtn = element<HTMLButtonElement>("import-btn");
const importFileInput = element<HTMLInputElement>("import-file-input");
const status = element<HTMLOutputElement>("status");
const reconnectButton = element<HTMLButtonElement>("reconnect-button");
const resyncButton = element<HTMLButtonElement>("resync-button");
const resyncStatus = element<HTMLOutputElement>("resync-status");
const languageSelect = element<HTMLSelectElement>("language-select");

// Dialog elements
const pickerDialog = element<HTMLDialogElement>("bookmark-picker-dialog");
const pickerTitle = element<HTMLHeadingElement>("picker-title");
const pickerFlattenLabel = element<HTMLLabelElement>("picker-flatten-label");
const pickerFlattenCheckbox = element<HTMLInputElement>("picker-flatten-checkbox");
const pickerHoverExpandLabel = element<HTMLLabelElement>("picker-hover-expand-label");
const pickerHoverExpandCheckbox = element<HTMLInputElement>("picker-hover-expand-checkbox");
const pickerIncludeFoldersLabel = element<HTMLLabelElement>("picker-include-folders-label");
const pickerIncludeFoldersCheckbox = element<HTMLInputElement>("picker-include-folders-checkbox");
const pickerCloseBtn = element<HTMLButtonElement>("picker-close-btn");
const pickerUpBtn = element<HTMLButtonElement>("picker-up-btn");
const pickerBreadcrumbs = element<HTMLDivElement>("picker-breadcrumbs");
const pickerSelectCurrentBtn = element<HTMLButtonElement>("picker-select-current-btn");
const pickerContent = element<HTMLDivElement>("picker-content");
const pickerConfirmBtn = element<HTMLButtonElement>("picker-confirm-btn");

// Color popover elements
const colorPopover = element<HTMLDivElement>("color-popover");
const colorPopoverTitle = element<HTMLSpanElement>("color-popover-title");
const colorPopoverClose = element<HTMLButtonElement>("color-popover-close");
const popoverColorInput = element<HTMLInputElement>("popover-color-input");
const popoverColorHex = element<HTMLInputElement>("popover-color-hex");
const colorPopoverPresets = element<HTMLDivElement>("color-popover-presets");
const popoverRandomBtn = element<HTMLButtonElement>("popover-random-btn");
const popoverDefaultBtn = element<HTMLButtonElement>("popover-default-btn");

// Menu settings dialog elements
const menuSettingsDialog = element<HTMLDialogElement>("menu-settings-dialog");
const menuSettingsDialogTitle = element<HTMLSpanElement>("menu-settings-dialog-title");
const menuSettingsClose = element<HTMLButtonElement>("menu-settings-close");
const menuSettingsTabs = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".menu-settings-tab"),
);
const menuSettingOrientation = element<HTMLSelectElement>("menu-setting-orientation");
const menuSettingExpandDirection = element<HTMLSelectElement>("menu-setting-expand-direction");
const menuSettingFontSize = element<HTMLInputElement>("menu-setting-font-size");
const menuSettingFontSizeAuto = element<HTMLInputElement>("menu-setting-font-size-auto");
const menuSettingPopupFontSize = element<HTMLInputElement>("menu-setting-popup-font-size");
const menuSettingGap = element<HTMLInputElement>("menu-setting-gap");

const menuSettingAttachmentMode = element<HTMLSelectElement>("menu-setting-attachment-mode");
const menuSettingOnTopMode = element<HTMLSelectElement>("menu-setting-on-top-mode");
const menuSettingTabMode = element<HTMLSelectElement>("menu-setting-tab-mode");

// Item settings popover elements
const itemSettingsPopover = element<HTMLDivElement>("item-settings-popover");
const itemSettingsTitle = element<HTMLSpanElement>("item-settings-title");
const itemSettingsClose = element<HTMLButtonElement>("item-settings-close");
const itemSettingsFolderControls = element<HTMLDivElement>("item-settings-folder-controls");
const itemSettingsBookmarkControls = element<HTMLDivElement>("item-settings-bookmark-controls");
const itemSettingsSpaceControls = element<HTMLDivElement>("item-settings-space-controls");
const itemSettingSpaceUnits = element<HTMLInputElement>("item-setting-space-units");
const itemSettingTransparent = element<HTMLInputElement>("item-setting-transparent");
const itemSettingRename = element<HTMLInputElement>("item-setting-rename");
const itemSettingClearRename = element<HTMLButtonElement>("item-setting-clear-rename");
const itemSettingTabMode = element<HTMLSelectElement>("item-setting-tab-mode");
const itemSettingFlatten = element<HTMLInputElement>("item-setting-flatten");
const itemSettingHoverExpand = element<HTMLInputElement>("item-setting-hover-expand");
const itemSettingIncludeFoldersLabel = element<HTMLLabelElement>("item-setting-include-folders-label");
const itemSettingIncludeFolders = element<HTMLInputElement>("item-setting-include-folders");
const itemSettingsDynamicControls = element<HTMLDivElement>("item-settings-dynamic-controls");
const itemSettingDynamicShowPageTitle = element<HTMLInputElement>("item-setting-dynamic-show-page-title");
const shortcutsList = element<HTMLDivElement>("shortcuts-list");
const configureBrowserShortcutsBtn = element<HTMLButtonElement>("configure-browser-shortcuts-btn");
const shortcutsSubtabBrowser = element<HTMLButtonElement>("shortcuts-subtab-browser");
const shortcutsSubtabNative = element<HTMLButtonElement>("shortcuts-subtab-native");
const shortcutsBrowserPanel = element<HTMLDivElement>("shortcuts-browser-panel");
const shortcutsNativePanel = element<HTMLDivElement>("shortcuts-native-panel");
const addNativeShortcutBtn = element<HTMLButtonElement>("add-native-shortcut-btn");
const nativeShortcutsList = element<HTMLDivElement>("native-shortcuts-list");
const shortcutSettingsPopover = element<HTMLDivElement>("shortcut-settings-popover");
const shortcutSettingsTitle = element<HTMLSpanElement>("shortcut-settings-title");
const shortcutSettingsClose = element<HTMLButtonElement>("shortcut-settings-close");
const shortcutSettingTabMode = element<HTMLSelectElement>("shortcut-setting-tab-mode");
const shortcutSettingChangeBtn = element<HTMLButtonElement>("shortcut-setting-change-btn");
const colorPopoverCycleRow = element<HTMLDivElement>("color-popover-cycle-row");
const colorPopoverCycleToggle = element<HTMLInputElement>("color-popover-cycle-toggle");
const colorPopoverCycleSection = element<HTMLDivElement>("color-popover-cycle-section");
const colorPopoverCycleList = element<HTMLDivElement>("color-popover-cycle-list");
const itemSettingChangeBtn = element<HTMLButtonElement>("item-setting-change-btn");
const addSpaceBookmarkBtn = element<HTMLButtonElement>("add-space-bookmark-btn");
const spaceBookmarkDialog = element<HTMLDialogElement>("space-bookmark-dialog");
const spaceBookmarkClose = element<HTMLButtonElement>("space-bookmark-close");
const spaceBookmarkCloseBtn = element<HTMLButtonElement>("space-bookmark-close-btn");
const spaceBookmarkForm = element<HTMLFormElement>("space-bookmark-form");
const spaceBookmarkUnits = element<HTMLInputElement>("space-bookmark-units");
const spaceBookmarkColor = element<HTMLInputElement>("space-bookmark-color");
const spaceBookmarkTransparent = element<HTMLInputElement>("space-bookmark-transparent");
const spaceBookmarkResult = element<HTMLOutputElement>("space-bookmark-result");
const spaceBookmarkFolderBtn = element<HTMLButtonElement>("space-bookmark-folder-btn");
const spaceBookmarkFolderDisplay = element<HTMLSpanElement>("space-bookmark-folder-display");
const dynamicMarkerDialog = element<HTMLDialogElement>("dynamic-marker-dialog");
const dynamicMarkerClose = element<HTMLButtonElement>("dynamic-marker-close");
const dynamicMarkerCloseBtn = element<HTMLButtonElement>("dynamic-marker-close-btn");
const dynamicMarkerForm = element<HTMLFormElement>("dynamic-marker-form");
const dynamicMarkerFolderBtn = element<HTMLButtonElement>("dynamic-marker-folder-btn");
const dynamicMarkerFolderDisplay = element<HTMLSpanElement>("dynamic-marker-folder-display");
const dynamicMarkerResult = element<HTMLOutputElement>("dynamic-marker-result");
const addItemPopover = element<HTMLDivElement>("add-item-popover");
const addPopoverBookmarkBtn = element<HTMLButtonElement>("add-popover-bookmark-btn");
const addPopoverSpaceBtn = element<HTMLButtonElement>("add-popover-space-btn");
const addPopoverMenuToggleBtn = element<HTMLButtonElement>("add-popover-menu-toggle-btn");
const menusCardTabs = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".menus-card-tab"),
);
const dynamicList = element<HTMLDivElement>("dynamic-list");
const addDynamicBtn = element<HTMLButtonElement>("add-dynamic-btn");
const addPopoverDynamicBtn = element<HTMLButtonElement>("add-popover-dynamic-btn");
const pickDynamicDialog = element<HTMLDialogElement>("pick-dynamic-dialog");
const pickDynamicTitle = element<HTMLSpanElement>("pick-dynamic-title");
const pickDynamicClose = element<HTMLButtonElement>("pick-dynamic-close");
const pickDynamicList = element<HTMLDivElement>("pick-dynamic-list");
const dynamicSettingsDialog = element<HTMLDialogElement>("dynamic-settings-dialog");
const dynamicSettingsDialogTitle = element<HTMLSpanElement>("dynamic-settings-dialog-title");
const dynamicSettingsClose = element<HTMLButtonElement>("dynamic-settings-close");
const dynamicSettingUrlRulesList = element<HTMLDivElement>("dynamic-setting-url-rules-list");
const addUrlRuleBtn = element<HTMLButtonElement>("add-url-rule-btn");
const urlRulesList = element<HTMLDivElement>("url-rules-list");
const menuSettingUrlRulesList = element<HTMLDivElement>("menu-setting-url-rules-list");
const syncEnabledToggle = document.getElementById("sync-enabled-toggle") as HTMLInputElement | null;
const bookmarkRootInput = document.getElementById("bookmark-root-input") as HTMLInputElement | null;
const pickBookmarkRootBtn = document.getElementById("pick-bookmark-root-btn") as HTMLButtonElement | null;

let widgetEnabled = true;
let isConnectionDirty = false;
let isMenusDirty = false;
let bookmarkRootPrefix: string[] = [];
let menus: StoredMenu[] = [];
let urlRules: UrlRule[] = [];
let dynamicBookmarks: DynamicBookmark[] = [];
let shortcuts: StoredShortcut[] = [];
let nativeShortcuts: StoredNativeShortcut[] = [];
let rawBookmarkTree: browser.Bookmarks.BookmarkTreeNode[] = [];
let desktopTestGeneration = 0;

// Popover state
let activeColorTarget: StoredMenu | StoredMenuItem | null = null;
let activeColorSwatchElement: HTMLElement | null = null;

let activeMenuSettingsIndex = -1;

let activeItemSettings: { menuIndex: number; itemIndex: number } | null = null;
let activeItemSettingsBtn: HTMLElement | null = null;

let activeAddMenuIndex = -1;
let activeAddBtn: HTMLElement | null = null;

// Picker state
let pickerCurrentFolderId = "0";
let pickerSelectedId: string | null = null;
let pickerMode: "addItem" | "editItem" | "selectRoot" | "pickFolder" | "pickShortcut" | "pickNativeShortcut" = "addItem";
let pickerTargetMenuIndex = -1;
let pickerTargetItemIndex = -1;
let pickerTargetShortcutSlot = "";
let pickerTargetNativeShortcutId = "";
let activeRecordingKeyId: string | null = null;
// Remembers the destination folder chosen for gap-bookmark and dynamic-marker tools so the next
// open reuses it. Only the dialogs (pickFolder mode) read this.
let gapBookmarkFolderId = "0";
let activeDynamicMarkerDb: DynamicBookmark | null = null;
let activeShortcutSettingsTarget: StoredShortcut | StoredNativeShortcut | null = null;
let activeShortcutSettingsBtn: HTMLElement | null = null;

let browserCommandsMap: Record<string, string> = {};

async function refreshBrowserCommands(): Promise<void> {
  try {
    if (browser.commands && typeof browser.commands.getAll === "function") {
      const commands = await browser.commands.getAll();
      browserCommandsMap = {};
      for (const cmd of commands) {
        if (cmd.name) {
          browserCommandsMap[cmd.name] = cmd.shortcut || "";
        }
      }
      renderShortcuts();
      if (menus.length > 0) {
        renderMenus();
      }
    }
  } catch (err) {
    console.error("Failed to query browser commands:", err);
  }
}

function findItemShortcut(item: StoredMenuItem): StoredShortcut | undefined {
  if (item.type === "dynamic" && item.dynamicUid) {
    return shortcuts.find((s) => s.type === "dynamic" && s.dynamicUid === item.dynamicUid);
  }
  if (item.type === "bookmark" || (!item.type && item.url)) {
    return shortcuts.find((s) => {
      if (s.type === "dynamic") return false;
      if (item.url && s.url && item.url === s.url) return true;
      if (
        item.path &&
        s.path &&
        item.path.length === s.path.length &&
        item.path.every((p, idx) => p === s.path![idx])
      ) {
        return true;
      }
      return false;
    });
  }
  return undefined;
}

void initialize();

browser.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "desktopStateChanged" &&
    "state" in message &&
    typeof message.state === "string"
  ) {
    renderDesktopState(message.state);
  }
});

function markConnectionDirty(): void {
  if (!isConnectionDirty) {
    isConnectionDirty = true;
    saveConnectionBtn.classList.add("is-dirty");
  }
}

function clearConnectionDirty(): void {
  isConnectionDirty = false;
  saveConnectionBtn.classList.remove("is-dirty");
}

function markMenusDirty(): void {
  if (!isMenusDirty) {
    isMenusDirty = true;
    saveBtn.classList.add("is-dirty");
  }
}

function clearMenusDirty(): void {
  isMenusDirty = false;
  saveBtn.classList.remove("is-dirty");
}

function markDirty(): void {
  markMenusDirty();
}

function clearDirty(): void {
  clearConnectionDirty();
  clearMenusDirty();
}

window.addEventListener("beforeunload", (event) => {
  if (isConnectionDirty || isMenusDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

window.addEventListener("pagehide", () => {
  if (isMenusDirty) {
    void browser.runtime.sendMessage({ type: "cancelPreview" });
  }
});

connectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void persistConnection();
});

menusForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void persistMenus();
});

previewBtn.addEventListener("click", () => {
  void previewCurrentConfig();
});

instanceLabel.addEventListener("input", markConnectionDirty);
desktopUrl.addEventListener("input", () => {
  clearDesktopTestStatus();
  markConnectionDirty();
});

addMenu.addEventListener("click", () => {
  menus.push(createMenu());
  renderMenus();
  markDirty();
});

toggleEnabledButton.addEventListener("click", () => {
  clearResyncStatus();
  widgetEnabled = !widgetEnabled;
  updateDesktopControls();
  if (!widgetEnabled) {
    renderDesktopState("disabled", t("state.detail.disabledConnection"));
  } else {
    renderDesktopState("connecting", t("state.detail.connectingToWidget"));
  }
  void saveWidgetEnabled(widgetEnabled);
  void browser.runtime.sendMessage({ type: "setWidgetEnabled", enabled: widgetEnabled });
});

randomInstanceLabel.addEventListener("click", () => {
  instanceLabel.value = createRandomInstanceLabel();
  markConnectionDirty();
});

testDesktop.addEventListener("click", () => void testDesktopAddress());

reconnectButton.addEventListener("click", () => {
  void manualReconnect();
});
resyncButton.addEventListener("click", () => void resyncDesktopWindows());

pickerCloseBtn.addEventListener("click", () => pickerDialog.close());

pickerFlattenCheckbox.addEventListener("change", () => {
  // Flatten and expand-on-hover are independent; only clear include-folders when
  // flatten is turned off (it has no meaning without flatten).
  if (!pickerFlattenCheckbox.checked) {
    pickerIncludeFoldersCheckbox.checked = false;
  }
  updateSelectedInfo();
});

pickerIncludeFoldersCheckbox.addEventListener("change", () => {
  updateSelectedInfo();
});

pickerHoverExpandCheckbox.addEventListener("change", () => {
  updateSelectedInfo();
});

function getRootNode(): browser.Bookmarks.BookmarkTreeNode | undefined {
  const segments = bookmarkRootPrefix.map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return undefined;
  return findBookmarkNodeByPath(rawBookmarkTree as BookmarkNode[], segments) as
    | browser.Bookmarks.BookmarkTreeNode
    | undefined;
}

// Read-only display string for the root prefix segments (first segment's
// special-root placeholder shown with its friendly folder name).
function formatRootPrefixDisplay(segments: string[]): string {
  if (segments.length === 0) return "/";
  const shown = segments.map((seg, idx) =>
    idx === 0 ? formatSpecialRootForDisplay(seg, rawBookmarkTree) : seg,
  );
  return "/" + shown.join("/");
}

function setBookmarkRootPrefix(segments: string[]): void {
  bookmarkRootPrefix = segments.map((s) => s.trim()).filter(Boolean);
  if (bookmarkRootInput) {
    bookmarkRootInput.value = formatRootPrefixDisplay(bookmarkRootPrefix);
  }
}

pickerUpBtn.addEventListener("click", () => {
  const currentPath = getFolderPath(pickerCurrentFolderId, rawBookmarkTree as BookmarkNode[]);
  if (currentPath.length > 1) {
    const rootNode = pickerMode === "selectRoot" || pickerMode === "pickFolder" ? undefined : getRootNode();
    if (rootNode && pickerCurrentFolderId === rootNode.id) {
      return;
    }
    const parent = currentPath[currentPath.length - 2];
    if (parent) {
      pickerCurrentFolderId = parent.id;
      pickerSelectedId = null;
      renderPicker();
    }
  }
});

pickerSelectCurrentBtn.addEventListener("click", () => {
  if (pickerCurrentFolderId) {
    pickerSelectedId = pickerCurrentFolderId;
    renderPicker();
  }
});

pickerConfirmBtn.addEventListener("click", () => {
  if (pickerMode === "pickFolder") {
    const targetId =
      pickerSelectedId || (pickerCurrentFolderId !== "0" ? pickerCurrentFolderId : "0");
    gapBookmarkFolderId = targetId;
    updateGapBookmarkFolderDisplay();
    updateDynamicMarkerFolderDisplay();
    pickerDialog.close();
    return;
  }

  if (pickerMode === "selectRoot") {
    const targetId = pickerSelectedId || (pickerCurrentFolderId !== "0" ? pickerCurrentFolderId : null);
    const targetNode = targetId && targetId !== "0" ? findBookmarkNode(targetId, rawBookmarkTree) : undefined;
    if (!targetNode || targetNode.id === "0") {
      setBookmarkRootPrefix([]);
      markConnectionDirty();
      renderMenus();
      pickerDialog.close();
      return;
    }
    const pathNodes = getFolderPath(targetNode.id, rawBookmarkTree as BookmarkNode[]);
    const segments = pathNodes
      .filter((n) => n.id !== "0" && Boolean(n.title && n.title.trim()))
      .map((n, idx) => {
        if (idx === 0) {
          const special = getSpecialRootTypeFromNode(n);
          if (special) return SPECIAL_ROOT_PLACEHOLDERS[special];
        }
        return n.title.trim();
      });
    setBookmarkRootPrefix(segments);
    markConnectionDirty();
    renderMenus();
    pickerDialog.close();
    return;
  }

  if (!pickerSelectedId) return;

  const selectedNode = findBookmarkNode(pickerSelectedId, rawBookmarkTree);
  const isFolder = selectedNode?.children !== undefined || selectedNode?.url === undefined;
  const isFlatten = isFolder && pickerFlattenCheckbox.checked;
  const itemType = isFlatten ? "flattenFolder" : isFolder ? "folder" : "bookmark";
  const expandOnHover = isFolder ? pickerHoverExpandCheckbox.checked : undefined;
  const includeFolders = isFlatten && pickerIncludeFoldersCheckbox.checked ? true : undefined;
  const relativePath = getItemRelativePath(
    pickerSelectedId,
    rawBookmarkTree as BookmarkNode[],
    bookmarkRootPrefix,
  );

  const newItem: StoredMenuItem = {
    uid: crypto.randomUUID(),
    type: itemType,
    ...(expandOnHover !== undefined ? { expandOnHover } : {}),
    ...(includeFolders ? { includeFolders } : {}),
    ...(relativePath !== undefined ? { path: relativePath } : {}),
    ...(selectedNode?.url ? { url: selectedNode.url } : {}),
  };

  if (pickerMode === "pickShortcut") {
    if (!pickerSelectedId) return;
    const selectedNode = findBookmarkNode(pickerSelectedId, rawBookmarkTree);
    if (!selectedNode || selectedNode.url === undefined) return;
    const relativePath = getItemRelativePath(
      pickerSelectedId,
      rawBookmarkTree as BookmarkNode[],
      bookmarkRootPrefix,
    );

    const existing = shortcuts.find((s) => s.slot === pickerTargetShortcutSlot);
    if (existing) {
      existing.type = "bookmark";
      if (relativePath !== undefined) {
        existing.path = relativePath;
      } else {
        delete existing.path;
      }
      existing.url = selectedNode.url;
      existing.title = selectedNode.title;
      delete existing.dynamicUid;
    } else {
      shortcuts.push({
        slot: pickerTargetShortcutSlot,
        type: "bookmark",
        ...(relativePath !== undefined ? { path: relativePath } : {}),
        url: selectedNode.url,
        title: selectedNode.title,
        tabMode: "replace",
      });
    }
    renderShortcuts();
    renderMenus();
    markDirty();
    pickerDialog.close();
    return;
  }

  if (pickerMode === "pickNativeShortcut") {
    if (!pickerSelectedId) return;
    const selectedNode = findBookmarkNode(pickerSelectedId, rawBookmarkTree);
    if (!selectedNode || selectedNode.url === undefined) return;
    const relativePath = getItemRelativePath(
      pickerSelectedId,
      rawBookmarkTree as BookmarkNode[],
      bookmarkRootPrefix,
    );

    const existing = nativeShortcuts.find((s) => s.id === pickerTargetNativeShortcutId);
    if (existing) {
      existing.type = "bookmark";
      if (relativePath !== undefined) {
        existing.path = relativePath;
      } else {
        delete existing.path;
      }
      existing.url = selectedNode.url;
      existing.title = selectedNode.title;
      delete existing.dynamicUid;
      renderNativeShortcuts();
      markDirty();
    }
    pickerDialog.close();
    return;
  }

  if (pickerMode === "addItem") {
    const menu = menus[pickerTargetMenuIndex];
    if (menu) {
      menu.items.push(newItem);
      renderMenus();
      markDirty();
    }
    pickerDialog.close();
  } else if (pickerMode === "editItem") {
    const menu = menus[pickerTargetMenuIndex];
    const existing = menu?.items[pickerTargetItemIndex];
    if (existing) {
      if (newItem.type !== undefined) existing.type = newItem.type;
      if (newItem.expandOnHover !== undefined) existing.expandOnHover = newItem.expandOnHover;
      else delete existing.expandOnHover;
      if (newItem.includeFolders) {
        existing.includeFolders = true;
      } else {
        delete existing.includeFolders;
      }
      if (newItem.path !== undefined) existing.path = newItem.path;
      else delete existing.path;
      if (newItem.url !== undefined) existing.url = newItem.url;
      else delete existing.url;
      renderMenus();
      markDirty();
    }
    pickerDialog.close();
  }
});

// Re-read the browser bookmark tree into the cache. The tree is otherwise
// loaded once at init, so bookmarks the user creates in the browser afterwards
// would be missing from the picker until the options page is reopened.
async function refreshBookmarkTree(): Promise<void> {
  try {
    const tree = await browser.bookmarks.getTree();
    rawBookmarkTree = tree;
  } catch {
    // Keep the previous cache if the read fails.
  }
}

async function openBookmarkPicker(
  mode: "addItem" | "editItem" | "selectRoot" | "pickFolder" | "pickShortcut" | "pickNativeShortcut",
  menuIndex = -1,
  itemIndex = -1,
  shortcutSlot = "",
  nativeShortcutId = "",
): Promise<void> {
  // Pick up bookmarks added in the browser since the page (or last picker) loaded.
  await refreshBookmarkTree();

  pickerMode = mode;
  pickerTargetMenuIndex = menuIndex;
  pickerTargetItemIndex = itemIndex;
  pickerTargetShortcutSlot = shortcutSlot;
  pickerTargetNativeShortcutId = nativeShortcutId;

  const rootNode = mode === "selectRoot" ? undefined : getRootNode();
  pickerCurrentFolderId = rootNode?.id ?? "0";

  let initialFlatten = false;
  let initialHover = true;
  let initialIncludeFolders = false;

  if (mode === "editItem") {
    const existing = menus[menuIndex]?.items[itemIndex];
    if (existing) {
      const node = getItemNode(existing);
      pickerSelectedId = node?.id ?? null;
      initialFlatten = existing.type === "flattenFolder";
      initialHover = existing.expandOnHover !== false;
      initialIncludeFolders = existing.includeFolders === true;
      if (node) {
        const path = getFolderPath(node.id, rawBookmarkTree as BookmarkNode[]);
        if (path.length > 1) {
          const parent = path[path.length - 2];
          if (parent) {
            const parentId = parent.id;
            if (rootNode) {
              const parentPath = getFolderPath(parentId, rawBookmarkTree as BookmarkNode[]);
              if (parentPath.some((n) => n.id === rootNode.id)) {
                pickerCurrentFolderId = parentId;
              }
            } else {
              pickerCurrentFolderId = parentId;
            }
          }
        }
      }
    } else {
      pickerSelectedId = null;
    }
  } else if (mode === "selectRoot") {
    pickerSelectedId = null;
    if (bookmarkRootPrefix.length > 0) {
      const currentRoot = getRootNode();
      if (currentRoot) {
        pickerSelectedId = currentRoot.id;
        const path = getFolderPath(currentRoot.id, rawBookmarkTree as BookmarkNode[]);
        if (path.length > 1) {
          const parent = path[path.length - 2];
          if (parent) {
            pickerCurrentFolderId = parent.id;
          }
        }
      }
    }
  } else if (mode === "pickFolder") {
    // Reuse the folder chosen last time; fall back to the configured root.
    const remembered = findBookmarkNode(gapBookmarkFolderId, rawBookmarkTree);
    const target = remembered ?? rootNode;
    pickerSelectedId = target?.id ?? null;
    if (target) {
      const path = getFolderPath(target.id, rawBookmarkTree as BookmarkNode[]);
      if (path.length > 1) {
        const parent = path[path.length - 2];
        if (parent) {
          pickerCurrentFolderId = parent.id;
        }
      } else {
        pickerCurrentFolderId = target.id;
      }
    }
  } else if (mode === "pickShortcut") {
    pickerSelectedId = null;
    const existing = shortcuts.find((s) => s.slot === shortcutSlot);
    if (existing?.path) {
      const rootPrefix = bookmarkRootPrefix;
      const effectivePath = combineRootAndItemPath(rootPrefix, existing.path);
      const node = findBookmarkNodeByPath(rawBookmarkTree as BookmarkNode[], effectivePath, existing.url);
      if (node) {
        pickerSelectedId = node.id;
        const path = getFolderPath(node.id, rawBookmarkTree as BookmarkNode[]);
        if (path.length > 1) {
          const parent = path[path.length - 2];
          if (parent) {
            pickerCurrentFolderId = parent.id;
          }
        }
      }
    }
  } else if (mode === "pickNativeShortcut") {
    pickerSelectedId = null;
    const existing = nativeShortcuts.find((s) => s.id === nativeShortcutId);
    if (existing?.path) {
      const rootPrefix = bookmarkRootPrefix;
      const effectivePath = combineRootAndItemPath(rootPrefix, existing.path);
      const node = findBookmarkNodeByPath(rawBookmarkTree as BookmarkNode[], effectivePath, existing.url);
      if (node) {
        pickerSelectedId = node.id;
        const path = getFolderPath(node.id, rawBookmarkTree as BookmarkNode[]);
        if (path.length > 1) {
          const parent = path[path.length - 2];
          if (parent) {
            pickerCurrentFolderId = parent.id;
          }
        }
      }
    }
  } else {
    pickerSelectedId = null;
  }

  pickerFlattenCheckbox.checked = initialFlatten;
  pickerHoverExpandCheckbox.checked = initialHover;
  pickerHoverExpandCheckbox.disabled = false;
  pickerIncludeFoldersCheckbox.checked = initialFlatten && initialIncludeFolders;
  pickerFlattenLabel.style.display = "none";
  pickerHoverExpandLabel.style.display = "none";
  pickerIncludeFoldersLabel.style.display = "none";

  if (mode === "selectRoot") {
    pickerTitle.textContent = t("picker.selectRootTitle");
    pickerConfirmBtn.textContent = t("picker.selectRootConfirm");
  } else if (mode === "pickFolder") {
    pickerTitle.textContent = t("picker.pickFolderTitle");
    pickerConfirmBtn.textContent = t("picker.pickFolderConfirm");
  } else if (mode === "editItem") {
    pickerTitle.textContent = t("picker.changeTitle");
    pickerConfirmBtn.textContent = t("picker.apply");
  } else if (mode === "pickShortcut") {
    const slotNum = shortcutSlot.replace("slot_", "");
    pickerTitle.textContent = t("shortcuts.pickDialogTitle", { n: slotNum });
    pickerConfirmBtn.textContent = t("picker.apply");
  } else if (mode === "pickNativeShortcut") {
    const existing = nativeShortcuts.find((s) => s.id === nativeShortcutId);
    pickerTitle.textContent = t("shortcuts.pickNativeDialogTitle", { key: existing?.key || "" });
    pickerConfirmBtn.textContent = t("picker.apply");
  } else {
    pickerTitle.textContent = t("picker.addItemTitle", { n: menuIndex + 1 });
    pickerConfirmBtn.textContent = t("picker.addToMenu");
  }

  renderPicker();
  pickerDialog.showModal();
}

function findBookmarkNode(
  id: string,
  nodes: browser.Bookmarks.BookmarkTreeNode[],
): browser.Bookmarks.BookmarkTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findBookmarkNode(id, node.children);
      if (found) return found;
    }
  }
  return undefined;
}

function getItemNode(item: StoredMenuItem): browser.Bookmarks.BookmarkTreeNode | undefined {
  return getItemResolution(item).node as browser.Bookmarks.BookmarkTreeNode | undefined;
}

function getItemResolution(item: StoredMenuItem) {
  const effectivePath = combineRootAndItemPath(bookmarkRootPrefix, item.path);
  if (effectivePath.length > 0 || item.url) {
    return resolveBookmarkNodeByPath(rawBookmarkTree as BookmarkNode[], effectivePath, item.url);
  }
  return { duplicatePath: false };
}

function enrichMenuItems(
  items: StoredMenuItem[],
  nodes: browser.Bookmarks.BookmarkTreeNode[],
): void {
  if (nodes.length === 0) return;
  for (const item of items) {
    if (item.path && item.path.length > 0) {
      const firstSeg = item.path[0];
      if (firstSeg) {
        const special = getSpecialRootTypeFromTitle(firstSeg);
        if (special) {
          item.path[0] = SPECIAL_ROOT_PLACEHOLDERS[special];
        }
      }
    }
    if (item.type === "space" || item.type === "menuToggle") continue;
    const node = getItemNode(item);
    if (!node) continue;
    const refreshedPath = getItemRelativePath(
      node.id,
      nodes as BookmarkNode[],
      bookmarkRootPrefix,
    );
    if (refreshedPath !== undefined) {
      item.path = refreshedPath;
    }
    if (!item.type) {
      item.type = node.children !== undefined || node.url === undefined ? "folder" : "bookmark";
    }
    if (node.url !== undefined) {
      item.url = node.url;
    } else {
      delete item.url;
    }
  }
}

function renderPicker(): void {
  const rootNode = pickerMode === "selectRoot" || pickerMode === "pickFolder" ? undefined : getRootNode();
  const currentFolder = findBookmarkNode(pickerCurrentFolderId, rawBookmarkTree);
  const currentPath = getFolderPath(pickerCurrentFolderId, rawBookmarkTree as BookmarkNode[]);

  let displayPath = currentPath;
  if (rootNode) {
    const rootIndex = currentPath.findIndex((n) => n.id === rootNode.id);
    if (rootIndex !== -1) {
      displayPath = currentPath.slice(rootIndex);
      pickerUpBtn.disabled = displayPath.length <= 1;
    } else {
      pickerCurrentFolderId = rootNode.id;
      displayPath = [rootNode as BookmarkNode];
      pickerUpBtn.disabled = true;
    }
  } else {
    pickerUpBtn.disabled = currentPath.length <= 1;
  }

  // Update select current folder button
  const currentFolderName =
    currentFolder?.title || (currentFolder?.id === "0" ? t("common.bookmarks") : t("common.folder"));
  pickerSelectCurrentBtn.textContent = `${t("picker.selectCurrent")}: ${currentFolderName}`;
  pickerSelectCurrentBtn.dataset.selected = String(pickerSelectedId === pickerCurrentFolderId);

  // Render Breadcrumbs
  pickerBreadcrumbs.replaceChildren(
    ...displayPath.map((node, index) => {
      const isCurrent = index === displayPath.length - 1;
      const isSelected = pickerSelectedId === node.id;
      const span = document.createElement("span");
      span.className = `picker-crumb ${isCurrent ? "current" : ""} ${isSelected ? "selected" : ""}`;
      span.textContent = node.title || (node.id === "0" ? t("common.bookmarks") : t("common.folder"));
      if (!isCurrent) {
        span.addEventListener("click", () => {
          pickerCurrentFolderId = node.id;
          pickerSelectedId = null;
          renderPicker();
        });
      } else {
        span.title = t("picker.selectCurrent");
        span.addEventListener("click", () => {
          pickerSelectedId = node.id;
          renderPicker();
        });
      }
      const sep = document.createElement("span");
      sep.textContent = " / ";
      sep.style.color = "#94a3b8";

      const fragment = document.createDocumentFragment();
      fragment.append(span);
      if (!isCurrent) fragment.append(sep);
      return fragment;
    }),
  );

  // Render list of items in current folder
  const allItems =
    currentFolder?.children ??
    (rawBookmarkTree[0]?.children ?? rawBookmarkTree);

  const items =
    pickerMode === "selectRoot" || pickerMode === "pickFolder"
      ? allItems.filter((node) => node.children !== undefined || node.url === undefined)
      : allItems;

  pickerContent.replaceChildren();

  if (!items || items.length === 0) {
    const empty = document.createElement("div");
    empty.style.padding = "24px";
    empty.style.textAlign = "center";
    empty.style.color = "#64748b";
    empty.textContent = t("picker.emptyFolder");
    pickerContent.appendChild(empty);
  } else {
    for (const node of items) {
      const isFolder = node.children !== undefined || node.url === undefined;
      const row = document.createElement("div");
      row.className = "picker-item-row";
      row.dataset.selected = String(pickerSelectedId === node.id);

      const icon = document.createElement("span");
      icon.className = "picker-item-icon";
      icon.textContent = isFolder ? "📁" : "🔖";

      const titleSpan = document.createElement("span");
      titleSpan.className = "picker-item-title";
      titleSpan.textContent = node.title || (isFolder ? t("common.folder") : node.url || t("common.untitled"));
      if (node.url) {
        titleSpan.title = node.url;
      }

      row.append(icon, titleSpan);

      if (isFolder) {
        const count = node.children ? ` (${node.children.length})` : "";
        titleSpan.textContent += count;

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "picker-item-open-btn";
        openBtn.textContent = t("picker.open");
        openBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          pickerCurrentFolderId = node.id;
          pickerSelectedId = null;
          renderPicker();
        });
        row.append(openBtn);
      }

      row.addEventListener("click", () => {
        pickerSelectedId = node.id;
        renderPicker();
      });

      if (isFolder) {
        row.addEventListener("dblclick", () => {
          pickerCurrentFolderId = node.id;
          pickerSelectedId = null;
          renderPicker();
        });
      } else {
        row.addEventListener("dblclick", () => {
          pickerSelectedId = node.id;
          pickerConfirmBtn.click();
        });
      }

      pickerContent.appendChild(row);
    }
  }

  updateSelectedInfo();
}

function updateSelectedInfo(): void {
  if (pickerMode === "pickFolder") {
    pickerFlattenLabel.style.display = "none";
    pickerHoverExpandLabel.style.display = "none";
    pickerIncludeFoldersLabel.style.display = "none";
    // Mirror the select-root flow: an explicitly selected folder wins, otherwise
    // the folder currently open can be confirmed directly.
    const targetId = pickerSelectedId || (pickerCurrentFolderId !== "0" ? pickerCurrentFolderId : null);
    const targetNode = targetId ? findBookmarkNode(targetId, rawBookmarkTree) : undefined;
    const isFolder = targetNode?.children !== undefined || targetNode?.url === undefined;
    pickerConfirmBtn.disabled = !(targetId && isFolder);
    return;
  }

  if (pickerMode === "selectRoot") {
    pickerFlattenLabel.style.display = "none";
    pickerHoverExpandLabel.style.display = "none";
    pickerIncludeFoldersLabel.style.display = "none";
    const selectedTargetId = pickerSelectedId || (pickerCurrentFolderId !== "0" ? pickerCurrentFolderId : null);
    pickerConfirmBtn.disabled = !selectedTargetId;
    return;
  }

  if (pickerMode === "pickShortcut" || pickerMode === "pickNativeShortcut") {
    pickerFlattenLabel.style.display = "none";
    pickerHoverExpandLabel.style.display = "none";
    pickerIncludeFoldersLabel.style.display = "none";
    const selectedNode = pickerSelectedId ? findBookmarkNode(pickerSelectedId, rawBookmarkTree) : undefined;
    const isBookmark = Boolean(selectedNode && selectedNode.url !== undefined);
    pickerConfirmBtn.disabled = !isBookmark;
    return;
  }

  if (pickerSelectedId) {
    const selectedNode = findBookmarkNode(pickerSelectedId, rawBookmarkTree);
    const isFolder = selectedNode?.children !== undefined || selectedNode?.url === undefined;
    if (isFolder) {
      pickerFlattenLabel.style.display = "inline-flex";
      pickerHoverExpandLabel.style.display = "inline-flex";
      pickerIncludeFoldersLabel.style.display = pickerFlattenCheckbox.checked ? "inline-flex" : "none";
    } else {
      pickerFlattenLabel.style.display = "none";
      pickerHoverExpandLabel.style.display = "none";
      pickerIncludeFoldersLabel.style.display = "none";
      pickerFlattenCheckbox.checked = false;
      pickerIncludeFoldersCheckbox.checked = false;
    }
    pickerConfirmBtn.disabled = false;
  } else {
    pickerFlattenLabel.style.display = "none";
    pickerHoverExpandLabel.style.display = "none";
    pickerIncludeFoldersLabel.style.display = "none";
    pickerConfirmBtn.disabled = true;
  }
}

let resyncStatusTimer: ReturnType<typeof setTimeout> | undefined;

function clearResyncStatus(): void {
  if (resyncStatusTimer !== undefined) {
    clearTimeout(resyncStatusTimer);
    resyncStatusTimer = undefined;
  }
  resyncStatus.value = "";
  delete resyncStatus.dataset.state;
}

function setResyncStatus(state: "pending" | "success" | "error", message: string, autoClearMs = 0): void {
  if (resyncStatusTimer !== undefined) {
    clearTimeout(resyncStatusTimer);
    resyncStatusTimer = undefined;
  }
  resyncStatus.dataset.state = state;
  resyncStatus.value = message;
  if (autoClearMs > 0) {
    resyncStatusTimer = setTimeout(() => {
      clearResyncStatus();
    }, autoClearMs);
  }
}

async function manualReconnect(): Promise<void> {
  clearResyncStatus();
  renderDesktopState("connecting", t("state.detail.reconnectingToWidget"));
  try {
    await browser.runtime.sendMessage({ type: "manualReconnect" });
  } catch {
    // Ignore
  }
}

async function resyncDesktopWindows(): Promise<void> {
  clearResyncStatus();
  resyncButton.disabled = true;
  resyncButton.textContent = t("resync.resyncing");
  setResyncStatus("pending", t("resync.closingRebuilding"));
  try {
    const result = (await browser.runtime.sendMessage({ type: "resyncWindows" })) as
      | { ok?: boolean; message?: string }
      | undefined;
    setResyncStatus(result?.ok ? "success" : "error", result?.message ?? t("resync.failed"), 3500);
  } catch {
    setResyncStatus("error", t("resync.backgroundUnavailable"), 3500);
  } finally {
    resyncButton.textContent = t("btn.resync");
    resyncButton.disabled = stateCard.dataset.state !== "connected";
  }
}

function renderDesktopState(state: string, detail?: string): void {
  stateCard.dataset.state = state;
  stateBadge.textContent = badgeLabel(state);
  stateDetail.textContent = detail || defaultDetailForState(state);
  resyncButton.disabled = state !== "connected";
  if (state !== "connected") {
    clearResyncStatus();
  }
}

const KNOWN_STATES = [
  "connected",
  "connecting",
  "syncing",
  "handshaking",
  "reconnecting",
  "disconnected",
  "disabled",
] as const;

function badgeLabel(state: string): string {
  const known = KNOWN_STATES.find((s) => s === state);
  return known ? t(`state.badge.${known}`) : state;
}

function defaultDetailForState(state: string): string {
  switch (state) {
    case "connected":
      return t("state.detail.connected");
    case "syncing":
      return t("state.detail.syncing");
    case "connecting":
      return t("state.detail.connecting");
    case "handshaking":
      return t("state.detail.handshaking");
    case "reconnecting":
      return t("state.detail.reconnecting");
    case "disabled":
      return t("state.detail.disabled");
    case "disconnected":
    default:
      return t("state.detail.disconnected");
  }
}

async function refreshDesktopState(): Promise<void> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: "getDesktopState",
    })) as { state?: string; detail?: string } | undefined;
    if (response?.state) {
      renderDesktopState(response.state);
    }
  } catch {
    // Ignore if background is unavailable
  }
}

function initLanguagePicker(): void {
  languageSelect.replaceChildren(
    ...LANGUAGES.map((lang) => {
      const opt = document.createElement("option");
      opt.value = lang;
      opt.textContent = lang === "zh-CN" ? t("language.zhCN") : t("language.en");
      return opt;
    }),
  );
  languageSelect.value = getLanguage();
  languageSelect.addEventListener("change", () => {
    void saveLanguage(languageSelect.value as Lang);
  });
}

/** Re-apply translations to everything on screen after a language change. */
function rerenderForLanguage(): void {
  closeAddItemDropdown();
  applyStaticI18n();
  for (const opt of languageSelect.options) {
    opt.textContent = opt.value === "zh-CN" ? t("language.zhCN") : t("language.en");
  }
  languageSelect.value = getLanguage();
  renderShortcuts();
  renderMenus();
  renderUrlRules();
  renderDynamicList();
  updateDesktopControls();
  renderDesktopState(stateCard.dataset.state ?? "disconnected");
  if (pickerDialog.open) {
    updateSelectedInfo();
  }
  if (spaceBookmarkDialog.open) {
    updateGapBookmarkFolderDisplay();
  }
}

function initHeaderLinks(): void {
  const downloadLink = document.getElementById("download-desktop-link") as HTMLAnchorElement | null;
  if (!downloadLink) return;

  const isReleaseBuild = typeof __BROWSERAIL_IS_RELEASE__ !== "undefined" && __BROWSERAIL_IS_RELEASE__;
  const buildReleaseTag = typeof __BROWSERAIL_RELEASE_TAG__ !== "undefined" ? __BROWSERAIL_RELEASE_TAG__ : "";
  const manifestVersion = browser.runtime?.getManifest?.()?.version;
  const hasCustomManifestVersion = Boolean(manifestVersion && manifestVersion !== "0.1.0");

  const isRelease = isReleaseBuild || hasCustomManifestVersion;
  const effectiveTag = buildReleaseTag || (hasCustomManifestVersion ? `v${manifestVersion}` : "");

  if (isRelease) {
    downloadLink.href = effectiveTag
      ? `https://github.com/melon-masou/BrowseRail/releases/tag/${effectiveTag}`
      : "https://github.com/melon-masou/BrowseRail/releases";
    downloadLink.style.display = "";
  } else {
    downloadLink.style.display = "none";
  }
}

async function initialize(): Promise<void> {
  applyStaticI18n();
  initLanguagePicker();
  initHeaderLinks();
  onLanguageChange(rerenderForLanguage);
  initMenusCardTabs();
  initColorPopover();
  initMenuSettingsDialog();
  initItemSettingsPopover();
  initSpaceBookmarkDialog();
  initAddItemPopover();
  initDynamicPanel();
  initShortcutsPanel();
  void refreshDesktopState();
  void refreshBrowserCommands();
  window.addEventListener("focus", () => {
    void refreshBrowserCommands();
  });
  const [config, enabled, tree, rootPrefix] = await Promise.all([
    loadConfig(),
    loadWidgetEnabled(),
    browser.bookmarks.getTree(),
    loadBookmarkRootPrefix(),
  ]);
  rawBookmarkTree = tree;

  instanceLabel.value = config.instanceLabel;
  widgetEnabled = enabled;
  desktopUrl.value = config.desktopWidget.url;
  bookmarkRootPrefix = rootPrefix;
  // Default the gap-bookmark destination to the configured root, matching the
  // location gap bookmarks landed in before the picker existed.
  gapBookmarkFolderId = getRootNode()?.id ?? "0";
  if (bookmarkRootInput) {
    // Read-only display: the root is set only via the "pick root" button, so a
    // folder title containing "/" can be represented (a typed string can't).
    bookmarkRootInput.readOnly = true;
    bookmarkRootInput.value = formatRootPrefixDisplay(bookmarkRootPrefix);
  }
  if (pickBookmarkRootBtn) {
    pickBookmarkRootBtn.addEventListener("click", () => {
      void openBookmarkPicker("selectRoot");
    });
  }
  menus = structuredClone(config.panel.menus);
  urlRules = structuredClone(config.urlRules);
  dynamicBookmarks = structuredClone(config.dynamicBookmarks ?? []);
  shortcuts = structuredClone(config.shortcuts ?? []);
  nativeShortcuts = structuredClone(config.nativeShortcuts ?? []);
  updateDesktopControls();
  renderMenus();
  renderUrlRules();
  renderDynamicList();
  renderShortcuts();
  renderNativeShortcuts();
  clearDirty();
}

async function persistConnection(): Promise<void> {
  if (!isLocalDesktopUrl(desktopUrl.value)) {
    desktopUrl.setCustomValidity(t("validation.localWsAddress"));
    desktopUrl.reportValidity();
    return;
  }
  desktopUrl.setCustomValidity("");

  await saveBookmarkRootPrefix(bookmarkRootPrefix);

  if (syncEnabledToggle) {
    await saveSyncEnabled(syncEnabledToggle.checked);
  }

  const currentConfig = await loadConfig();
  await saveConfig({
    ...currentConfig,
    desktopWidget: {
      url: desktopUrl.value.trim(),
    },
    instanceLabel: instanceLabel.value.trim(),
  });
  await browser.runtime.sendMessage({ type: "configSaved" });
  clearConnectionDirty();
  const savedMsg = t("status.saved");
  connectionStatus.value = savedMsg;
  setTimeout(() => {
    if (connectionStatus.value === savedMsg) {
      connectionStatus.value = "";
    }
  }, 1_500);
}

function initMenusCardTabs(): void {
  for (const tab of menusCardTabs) {
    tab.addEventListener("click", () => {
      const targetId = tab.dataset.tabTarget;
      if (!targetId) return;
      for (const other of menusCardTabs) {
        const panelId = other.dataset.tabTarget;
        if (!panelId) continue;
        const panel = document.getElementById(panelId);
        const selected = other === tab;
        other.setAttribute("aria-selected", String(selected));
        if (panel) panel.toggleAttribute("hidden", !selected);
      }
    });
  }
}

async function persistMenus(): Promise<void> {
  for (const menu of menus) {
    enrichMenuItems(menu.items, rawBookmarkTree);
  }

  const currentConfig = await loadConfig();
  await saveConfig({
    ...currentConfig,
    panel: {
      menus,
    },
    urlRules,
    dynamicBookmarks,
    shortcuts,
    nativeShortcuts,
  });
  await browser.runtime.sendMessage({ type: "configSaved" });
  clearMenusDirty();
  const savedMsg = t("status.saved");
  status.value = savedMsg;
  setTimeout(() => {
    if (status.value === savedMsg) {
      status.value = "";
    }
  }, 1_500);
}

async function persistMenuEnabled(menu: StoredMenu, enabled: boolean): Promise<boolean> {
  const currentConfig = await loadConfig();
  if (!currentConfig.panel.menus.some((storedMenu) => storedMenu.uid === menu.uid)) {
    return false;
  }

  await saveConfig({
    ...currentConfig,
    panel: {
      menus: currentConfig.panel.menus.map((storedMenu) =>
        storedMenu.uid === menu.uid ? { ...storedMenu, enabled } : storedMenu,
      ),
    },
  });
  await browser.runtime.sendMessage({ type: "configSaved" });
  return true;
}


async function previewCurrentConfig(): Promise<void> {
  await saveBookmarkRootPrefix(bookmarkRootPrefix);

  const previewConfig: ExtensionConfig = {
    desktopWidget: {
      url: desktopUrl.value,
    },
    instanceLabel: instanceLabel.value,
    panel: {
      menus,
    },
    urlRules,
    dynamicBookmarks,
    shortcuts: structuredClone(shortcuts),
    nativeShortcuts: structuredClone(nativeShortcuts),
  };

  try {
    previewBtn.disabled = true;
    status.value = t("preview.updating");
    const result = (await browser.runtime.sendMessage({
      type: "previewConfig",
      config: previewConfig,
    })) as { ok?: boolean; message?: string } | undefined;

    let previewingMsg = "";
    if (result?.ok) {
      previewingMsg = t("preview.active");
      status.value = previewingMsg;
    } else {
      status.value = t("preview.failed", { message: result?.message ?? t("preview.desktopUnavailable") });
    }
    setTimeout(() => {
      if (previewingMsg && status.value === previewingMsg) {
        status.value = "";
      }
    }, 3_500);
  } catch (err) {
    status.value = t("preview.failed", { message: String(err) });
  } finally {
    previewBtn.disabled = false;
  }
}

function initColorPopover(): void {
  colorPopoverPresets.replaceChildren(
    ...PALETTE_COLORS.map((color) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "color-preset-dot";
      dot.style.backgroundColor = color;
      dot.title = color;
      dot.addEventListener("click", () => {
        setColor(color);
      });
      return dot;
    }),
  );

  colorPopoverClose.addEventListener("click", () => closeColorPopover());

  colorPopoverCycleToggle.addEventListener("change", () => {
    if (!activeColorTarget || !("type" in activeColorTarget) || activeColorTarget.type !== "flattenFolder") return;
    const item = activeColorTarget as StoredMenuItem;
    if (colorPopoverCycleToggle.checked) {
      if (!Array.isArray(item.cycleColors) || item.cycleColors.length === 0) {
        item.cycleColors = ["#1e3a8a", "#065f46"];
      }
      delete item.color;
      colorPopoverCycleSection.style.display = "block";
      selectedCycleIndex = 0;
      renderPopoverCycleList();
      const firstColor = item.cycleColors[0] ?? "#3b82f6";
      popoverColorInput.value = firstColor;
      popoverColorHex.value = firstColor.toUpperCase();
    } else {
      delete item.cycleColors;
      delete item.color;
      colorPopoverCycleSection.style.display = "none";
      selectedCycleIndex = -1;
      popoverColorInput.value = "#3b82f6";
      popoverColorHex.value = "";
    }
    updateActiveTargetSwatch();
    markDirty();
  });

  popoverColorInput.addEventListener("input", () => {
    setColor(popoverColorInput.value);
  });

  popoverColorHex.addEventListener("input", () => {
    let val = popoverColorHex.value.trim();
    if (!val.startsWith("#")) {
      val = "#" + val;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      setColor(val);
    }
  });

  popoverRandomBtn.addEventListener("click", () => {
    setColor(getRandomPaletteColor());
  });

  popoverDefaultBtn.addEventListener("click", () => {
    if (!activeColorTarget || !activeColorSwatchElement) return;
    if ("type" in activeColorTarget && activeColorTarget.type === "flattenFolder") {
      const item = activeColorTarget as StoredMenuItem;
      if (colorPopoverCycleToggle.checked && Array.isArray(item.cycleColors) && item.cycleColors.length > 0) {
        if (item.cycleColors.length > 1 && selectedCycleIndex >= 0) {
          item.cycleColors.splice(selectedCycleIndex, 1);
          selectedCycleIndex = Math.max(0, selectedCycleIndex - 1);
          renderPopoverCycleList();
          const curColor = item.cycleColors[selectedCycleIndex] ?? "#3b82f6";
          popoverColorInput.value = curColor;
          popoverColorHex.value = curColor.toUpperCase();
        } else {
          delete item.cycleColors;
          delete item.color;
          colorPopoverCycleToggle.checked = false;
          colorPopoverCycleSection.style.display = "none";
          selectedCycleIndex = -1;
          popoverColorInput.value = "#3b82f6";
          popoverColorHex.value = "";
        }
        updateActiveTargetSwatch();
        markDirty();
        return;
      }
    }
    delete activeColorTarget.color;
    popoverColorInput.value = "#3b82f6";
    popoverColorHex.value = "";
    updateActiveTargetSwatch();
    markDirty();
  });

  document.addEventListener("pointerdown", (e) => {
    if (colorPopover.style.display === "none") return;
    const target = e.target as Node | null;
    if (
      target &&
      !colorPopover.contains(target) &&
      activeColorSwatchElement &&
      !activeColorSwatchElement.contains(target)
    ) {
      closeColorPopover();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && colorPopover.style.display !== "none") {
      closeColorPopover();
    }
  });
}

let selectedCycleIndex = -1;

function renderPopoverCycleList(): void {
  colorPopoverCycleList.replaceChildren();
  if (!activeColorTarget || !("type" in activeColorTarget) || activeColorTarget.type !== "flattenFolder") {
    return;
  }
  const item = activeColorTarget as StoredMenuItem;
  if (!Array.isArray(item.cycleColors)) {
    item.cycleColors = [];
  }

  item.cycleColors.forEach((color, idx) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `cycle-color-dot ${idx === selectedCycleIndex ? "is-selected" : ""}`;
    dot.style.backgroundColor = color;
    dot.title = color;

    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedCycleIndex = idx;
      renderPopoverCycleList();
      popoverColorInput.value = color;
      popoverColorHex.value = color.toUpperCase();
    });

    const delBtn = document.createElement("span");
    delBtn.className = "cycle-color-dot-del";
    delBtn.textContent = "✕";
    delBtn.title = t("common.close");
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      item.cycleColors!.splice(idx, 1);
      if (selectedCycleIndex >= item.cycleColors!.length) {
        selectedCycleIndex = item.cycleColors!.length - 1;
      }
      if (item.cycleColors!.length === 0) {
        delete item.cycleColors;
        delete item.color;
        colorPopoverCycleToggle.checked = false;
        colorPopoverCycleSection.style.display = "none";
        selectedCycleIndex = -1;
        popoverColorInput.value = "#3b82f6";
        popoverColorHex.value = "";
      } else {
        renderPopoverCycleList();
        const curColor = item.cycleColors![selectedCycleIndex] ?? "#3b82f6";
        popoverColorInput.value = curColor;
        popoverColorHex.value = curColor.toUpperCase();
      }
      updateActiveTargetSwatch();
      markDirty();
    });

    dot.appendChild(delBtn);
    colorPopoverCycleList.appendChild(dot);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "cycle-color-dot-add";
  addBtn.textContent = "+";
  addBtn.title = t("itemSettings.addColor");
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const nextPreset = PALETTE_COLORS[item.cycleColors!.length % PALETTE_COLORS.length] || "#3b82f6";
    item.cycleColors!.push(nextPreset);
    selectedCycleIndex = item.cycleColors!.length - 1;
    renderPopoverCycleList();
    popoverColorInput.value = nextPreset;
    popoverColorHex.value = nextPreset.toUpperCase();
    updateActiveTargetSwatch();
    markDirty();
  });
  colorPopoverCycleList.appendChild(addBtn);
}

function updateActiveTargetSwatch(): void {
  if (!activeColorTarget || !activeColorSwatchElement) return;
  if ("type" in activeColorTarget && activeColorTarget.type === "flattenFolder") {
    const colors = activeColorTarget.cycleColors;
    if (colors && colors.length > 0) {
      if (colors.length === 1) {
        const onlyColor = colors[0] ?? "";
        activeColorSwatchElement.style.background = "";
        activeColorSwatchElement.style.backgroundColor = onlyColor;
        activeColorSwatchElement.style.borderColor = onlyColor;
      } else {
        activeColorSwatchElement.style.background = `linear-gradient(135deg, ${colors.join(", ")})`;
        activeColorSwatchElement.style.borderColor = "transparent";
      }
      activeColorSwatchElement.classList.remove("has-no-color");
      activeColorSwatchElement.title = t("item.cycleColorsTitle", { count: colors.length });
    } else {
      activeColorSwatchElement.style.background = "";
      activeColorSwatchElement.style.backgroundColor = "transparent";
      activeColorSwatchElement.style.borderColor = "#cbd5e1";
      activeColorSwatchElement.classList.add("has-no-color");
      activeColorSwatchElement.title = t("item.cycleColorsEmpty");
    }
  } else {
    updateSwatchAppearance(activeColorSwatchElement, activeColorTarget.color);
  }
}

function setColor(color: string): void {
  if (!activeColorTarget || !activeColorSwatchElement) return;
  if ("type" in activeColorTarget && activeColorTarget.type === "flattenFolder") {
    const item = activeColorTarget as StoredMenuItem;
    if (!colorPopoverCycleToggle.checked) {
      colorPopoverCycleToggle.checked = true;
      colorPopoverCycleSection.style.display = "block";
      item.cycleColors = [color];
      selectedCycleIndex = 0;
      renderPopoverCycleList();
    } else {
      if (!Array.isArray(item.cycleColors)) {
        item.cycleColors = [];
      }
      if (selectedCycleIndex < 0 || selectedCycleIndex >= item.cycleColors.length) {
        selectedCycleIndex = 0;
      }
      if (item.cycleColors.length > 0) {
        item.cycleColors[selectedCycleIndex] = color;
      } else {
        item.cycleColors.push(color);
      }
      renderPopoverCycleList();
    }
  } else {
    activeColorTarget.color = color;
  }
  popoverColorInput.value = color;
  popoverColorHex.value = color.toUpperCase();
  updateActiveTargetSwatch();
  markDirty();
}

function updateSwatchAppearance(swatch: HTMLElement, color?: string): void {
  if (color) {
    swatch.style.background = "";
    swatch.style.backgroundColor = color;
    swatch.style.borderColor = color;
    swatch.classList.remove("has-no-color");
    swatch.title = t("color.swatchSet", { color });
  } else {
    swatch.style.background = "";
    swatch.style.backgroundColor = "transparent";
    swatch.style.borderColor = "#cbd5e1";
    swatch.classList.add("has-no-color");
    swatch.title = t("color.swatchEmpty");
  }
}

function openColorPopover(target: StoredMenu | StoredMenuItem, swatchElement: HTMLElement): void {
  if (activeColorTarget === target && colorPopover.style.display !== "none") {
    closeColorPopover();
    return;
  }
  // Measure before close* calls below; they can re-render and detach this swatch,
  // whose rect then reports 0,0 and moves the popover to the top-left corner.
  const rect = swatchElement.getBoundingClientRect();
  closeAddItemDropdown();
  closeMenuSettingsDialog();
  activeColorTarget = target;
  activeColorSwatchElement = swatchElement;

  const isFlatten = "type" in target && target.type === "flattenFolder";
  if (isFlatten) {
    colorPopoverCycleRow.style.display = "flex";
    colorPopoverTitle.style.display = "none";
    const hasCycle = Array.isArray(target.cycleColors) && target.cycleColors.length > 0;
    colorPopoverCycleToggle.checked = hasCycle;
    if (hasCycle) {
      colorPopoverCycleSection.style.display = "block";
      selectedCycleIndex = 0;
      renderPopoverCycleList();
      const firstColor = target.cycleColors![0] ?? "#3b82f6";
      popoverColorInput.value = firstColor;
      popoverColorHex.value = firstColor.toUpperCase();
    } else {
      colorPopoverCycleSection.style.display = "none";
      selectedCycleIndex = -1;
      popoverColorInput.value = "#3b82f6";
      popoverColorHex.value = "";
    }
  } else {
    colorPopoverCycleRow.style.display = "none";
    colorPopoverTitle.style.display = "block";
    colorPopoverCycleSection.style.display = "none";
    selectedCycleIndex = -1;
    const currentColor = target.color || "#3b82f6";
    popoverColorInput.value = currentColor;
    popoverColorHex.value = target.color ? target.color.toUpperCase() : "";
  }

  positionPopover(colorPopover, rect, 220);
}

function closeColorPopover(): void {
  colorPopover.style.display = "none";
  activeColorTarget = null;
  activeColorSwatchElement = null;
  if (activeMenuSettingsIndex < 0 && !activeItemSettings) {
    renderMenus();
  }
}

function initMenuSettingsDialog(): void {
  menuSettingsClose.addEventListener("click", () => closeMenuSettingsDialog());
  menuSettingsDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeMenuSettingsDialog();
  });

  menuSettingsTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const panel = document.getElementById(tab.getAttribute("aria-controls") || "");
      if (!panel) return;
      menuSettingsTabs.forEach((candidate) => {
        const candidatePanel = document.getElementById(candidate.getAttribute("aria-controls") || "");
        const selected = candidate === tab;
        candidate.classList.toggle("is-active", selected);
        candidate.setAttribute("aria-selected", String(selected));
        if (candidatePanel) candidatePanel.hidden = !selected;
      });
    });
  });

  menuSettingOrientation.addEventListener("change", () => {
    const menu = menus[activeMenuSettingsIndex];
    if (menu) {
      menu.orientation = menuSettingOrientation.value as MenuOrientation;
      markDirty();
    }
  });

  menuSettingExpandDirection.addEventListener("change", () => {
    const menu = menus[activeMenuSettingsIndex];
    if (menu) {
      const val = menuSettingExpandDirection.value;
      if (val === "down" || val === "up" || val === "right" || val === "left") {
        menu.expandDirection = val;
      } else {
        delete menu.expandDirection;
      }
      markDirty();
    }
  });

  menuSettingFontSize.addEventListener("input", () => {
    const menu = menus[activeMenuSettingsIndex];
    const val = parseInt(menuSettingFontSize.value, 10);
    if (menu && !menuSettingFontSizeAuto.checked && !isNaN(val)) {
      menu.buttonFontSize = Math.max(1, val);
      markDirty();
    }
  });

  menuSettingFontSizeAuto.addEventListener("change", () => {
    const menu = menus[activeMenuSettingsIndex];
    if (!menu) return;
    if (menuSettingFontSizeAuto.checked) {
      menu.buttonFontSize = AUTO_FONT_SIZE;
      menuSettingFontSize.disabled = true;
    } else {
      const val = parseInt(menuSettingFontSize.value, 10);
      menu.buttonFontSize = !isNaN(val) ? Math.max(1, val) : DEFAULT_FONT_SIZE;
      menuSettingFontSize.disabled = false;
    }
    markDirty();
  });

  menuSettingPopupFontSize.addEventListener("input", () => {
    const menu = menus[activeMenuSettingsIndex];
    const val = parseInt(menuSettingPopupFontSize.value, 10);
    if (menu && !isNaN(val)) {
      menu.popupFontSize = Math.max(1, val);
      markDirty();
    }
  });

  menuSettingGap.addEventListener("input", () => {
    const menu = menus[activeMenuSettingsIndex];
    const val = parseInt(menuSettingGap.value, 10);
    if (menu && !isNaN(val)) {
      menu.gap = Math.max(0, Math.min(100, val));
      markDirty();
    }
  });

  menuSettingAttachmentMode.addEventListener("change", () => {
    const menu = menus[activeMenuSettingsIndex];
    if (menu) {
      menu.attachmentMode = menuSettingAttachmentMode.value as AttachmentMode;
      if (menu.attachmentMode === "free") {
        menu.onTopMode = "alwaysOnTop";
        menuSettingOnTopMode.value = "alwaysOnTop";
      }
      menuSettingOnTopMode.disabled = menu.attachmentMode === "free";
      markDirty();
    }
  });

  menuSettingOnTopMode.addEventListener("change", () => {
    const menu = menus[activeMenuSettingsIndex];
    if (menu && menu.attachmentMode !== "free") {
      menu.onTopMode = menuSettingOnTopMode.value as OnTopMode;
      markDirty();
    }
  });

  menuSettingTabMode.addEventListener("change", () => {
    const menu = menus[activeMenuSettingsIndex];
    if (menu) {
      menu.tabMode = menuSettingTabMode.value === "newTab" ? "newTab" : "replace";
      markDirty();
    }
  });
}

function openMenuSettingsDialog(menuIndex: number, tab = 0): void {
  closeAddItemDropdown();
  closeColorPopover();
  closeItemSettingsPopover();

  activeMenuSettingsIndex = menuIndex;
  const menu = menus[menuIndex];
  if (!menu) return;

  const barFontAuto = isAutoFontSize(menu.buttonFontSize);
  // Auto has no px value, so show the default in the (disabled) number field.
  const barFs = menu.buttonFontSize !== undefined && !barFontAuto
    ? normalizeFontSize(menu.buttonFontSize)
    : DEFAULT_FONT_SIZE;
  const popupFs = menu.popupFontSize !== undefined
    ? normalizeFontSize(menu.popupFontSize)
    : DEFAULT_FONT_SIZE;
  const gapVal = menu.gap !== undefined ? menu.gap : DEFAULT_MENU_GAP_PERCENT;
  menuSettingsDialogTitle.textContent = t("menu.settingsTitle");
  menuSettingOrientation.value = menu.orientation;
  menuSettingExpandDirection.value = menu.expandDirection ?? "";
  menuSettingFontSize.value = String(barFs);
  menuSettingFontSizeAuto.checked = barFontAuto;
  menuSettingFontSize.disabled = barFontAuto;
  menuSettingPopupFontSize.value = String(popupFs);
  menuSettingGap.value = String(gapVal);
  menuSettingAttachmentMode.value = menu.attachmentMode ?? "lastFocused";
  const isFree = menuSettingAttachmentMode.value === "free";
  if (isFree) menu.onTopMode = "alwaysOnTop";
  menuSettingOnTopMode.value = isFree ? "alwaysOnTop" : menu.onTopMode ?? "aboveBrowser";
  menuSettingOnTopMode.disabled = isFree;
  menuSettingTabMode.value = menu.tabMode ?? "replace";
  renderMenuUrlRulesContent(menu);

  const tabButton = menuSettingsTabs[tab];
  if (tabButton) tabButton.click();
  menuSettingsDialog.showModal();
}

function closeMenuSettingsDialog(): void {
  menuSettingsDialog.close();
  activeMenuSettingsIndex = -1;
  renderMenus();
}

function renderMenuUrlRulesContent(menu: StoredMenu): void {
  menuSettingUrlRulesList.replaceChildren();

  const allRow = document.createElement("label");
  allRow.className = "menu-setting-url-rule-item";
  const allRadio = document.createElement("input");
  allRadio.type = "checkbox";
  const hasSpecificSets = Array.isArray(menu.urlRuleUids) && menu.urlRuleUids.length > 0;
  allRadio.checked = !hasSpecificSets;

  const allSpan = document.createElement("span");
  allSpan.textContent = t("menuBehavior.allUrls");
  allRow.append(allRadio, allSpan);
  menuSettingUrlRulesList.appendChild(allRow);

  allRadio.addEventListener("change", () => {
    if (allRadio.checked) {
      delete menu.urlRuleUids;
    } else {
      if (urlRules.length > 0) {
        const firstRule = urlRules[0];
        if (firstRule) menu.urlRuleUids = [firstRule.uid];
      }
    }
    renderMenuUrlRulesContent(menu);
    markDirty();
  });

  if (urlRules.length === 0) {
    const hint = document.createElement("div");
    hint.className = "url-rule-empty-hint";
    hint.style.fontSize = "11px";
    hint.style.padding = "6px";
    hint.textContent = t("menuBehavior.noUrlRules");
    menuSettingUrlRulesList.appendChild(hint);
  } else {
    urlRules.forEach((ws) => {
      const row = document.createElement("label");
      row.className = "menu-setting-url-rule-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = Array.isArray(menu.urlRuleUids) && menu.urlRuleUids.includes(ws.uid);
      cb.addEventListener("change", () => {
        if (!Array.isArray(menu.urlRuleUids)) {
          menu.urlRuleUids = [];
        }
        if (cb.checked) {
          if (!menu.urlRuleUids.includes(ws.uid)) {
            menu.urlRuleUids.push(ws.uid);
          }
        } else {
          menu.urlRuleUids = menu.urlRuleUids.filter((u) => u !== ws.uid);
        }
        if (menu.urlRuleUids.length === 0) {
          delete menu.urlRuleUids;
        }
        renderMenuUrlRulesContent(menu);
        markDirty();
      });

      const span = document.createElement("span");
      span.textContent = ws.name || t("urlRules.defaultName");
      if (ws.patterns.length > 0) {
        span.title = ws.patterns.join("\n");
      }

      row.append(cb, span);
      menuSettingUrlRulesList.appendChild(row);
    });
  }
}

function initItemSettingsPopover(): void {
  itemSettingsClose.addEventListener("click", () => closeItemSettingsPopover());

  itemSettingRename.addEventListener("input", () => {
    if (!activeItemSettings) return;
    const menu = menus[activeItemSettings.menuIndex];
    const item = menu?.items[activeItemSettings.itemIndex];
    if (!item) return;

    const val = itemSettingRename.value.trim();
    if (val) {
      item.rename = val;
    } else {
      delete item.rename;
    }
    renderMenus();
    markDirty();
  });

  itemSettingClearRename.addEventListener("click", () => {
    if (!activeItemSettings) return;
    const menu = menus[activeItemSettings.menuIndex];
    const item = menu?.items[activeItemSettings.itemIndex];
    if (!item) return;

    itemSettingRename.value = "";
    delete item.rename;
    renderMenus();
    markDirty();
  });

  itemSettingTabMode.addEventListener("change", () => {
    if (!activeItemSettings) return;
    const menu = menus[activeItemSettings.menuIndex];
    const item = menu?.items[activeItemSettings.itemIndex];
    if (!item) return;

    const val = itemSettingTabMode.value;
    if (val === "newTab" || val === "replace") {
      item.tabMode = val;
    } else {
      delete item.tabMode;
    }
    renderMenus();
    markDirty();
  });

  itemSettingFlatten.addEventListener("change", () => {
    if (!activeItemSettings) return;
    const menu = menus[activeItemSettings.menuIndex];
    const item = menu?.items[activeItemSettings.itemIndex];
    if (!item) return;

    // Flatten and expand-on-hover are independent: expand-on-hover applies to the
    // sub-folders emitted when "include folders" is on, so toggling flatten must
    // not change the hover checkbox.
    if (itemSettingFlatten.checked) {
      item.type = "flattenFolder";
      delete item.color;
      itemSettingIncludeFoldersLabel.style.display = "inline-flex";
      itemSettingIncludeFolders.checked = item.includeFolders === true;
    } else {
      item.type = "folder";
      delete item.includeFolders;
      delete item.cycleColors;
      itemSettingIncludeFoldersLabel.style.display = "none";
      itemSettingIncludeFolders.checked = false;
    }
    renderMenus();
    markDirty();
  });

  itemSettingIncludeFolders.addEventListener("change", () => {
    if (!activeItemSettings) return;
    const menu = menus[activeItemSettings.menuIndex];
    const item = menu?.items[activeItemSettings.itemIndex];
    if (!item) return;

    if (itemSettingIncludeFolders.checked) {
      item.includeFolders = true;
    } else {
      delete item.includeFolders;
    }
    renderMenus();
    markDirty();
  });

  itemSettingHoverExpand.addEventListener("change", () => {
    if (!activeItemSettings) return;
    const menu = menus[activeItemSettings.menuIndex];
    const item = menu?.items[activeItemSettings.itemIndex];
    if (!item) return;

    // Only controls expand-on-hover; leaves the flatten/include-folders state alone.
    item.expandOnHover = itemSettingHoverExpand.checked;
    renderMenus();
    markDirty();
  });

  itemSettingSpaceUnits.addEventListener("input", () => {
    if (!activeItemSettings) return;
    const menu = menus[activeItemSettings.menuIndex];
    const item = menu?.items[activeItemSettings.itemIndex];
    if (!item || item.type !== "space") return;

    const val = parseFloat(itemSettingSpaceUnits.value);
    if (!Number.isNaN(val) && val > 0) {
      item.units = Math.max(0.1, Math.min(20, val));
    } else {
      item.units = 1;
    }
    renderMenus();
    markDirty();
  });

  itemSettingTransparent.addEventListener("change", () => {
    if (!activeItemSettings) return;
    const menu = menus[activeItemSettings.menuIndex];
    const item = menu?.items[activeItemSettings.itemIndex];
    if (!item || item.type !== "space") return;

    item.transparent = itemSettingTransparent.checked;
    renderMenus();
    markDirty();
  });

  itemSettingDynamicShowPageTitle.addEventListener("change", () => {
    if (!activeItemSettings) return;
    const menu = menus[activeItemSettings.menuIndex];
    const item = menu?.items[activeItemSettings.itemIndex];
    if (!item || item.type !== "dynamic") return;

    if (itemSettingDynamicShowPageTitle.checked) {
      item.showPageTitle = true;
    } else {
      delete item.showPageTitle;
    }
    renderMenus();
    markDirty();
  });

  itemSettingChangeBtn.addEventListener("click", () => {
    if (!activeItemSettings) return;
    const { menuIndex, itemIndex } = activeItemSettings;
    closeItemSettingsPopover();
    void openBookmarkPicker("editItem", menuIndex, itemIndex);
  });

  document.addEventListener("pointerdown", (e) => {
    if (itemSettingsPopover.style.display === "none") return;
    const target = e.target as Node | null;
    if (
      target &&
      !itemSettingsPopover.contains(target) &&
      activeItemSettingsBtn &&
      !activeItemSettingsBtn.contains(target)
    ) {
      closeItemSettingsPopover();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && itemSettingsPopover.style.display !== "none") {
      closeItemSettingsPopover();
    }
  });
}

function openItemSettingsPopover(menuIndex: number, itemIndex: number, anchorEl: HTMLElement): void {
  if (
    activeItemSettings &&
    activeItemSettings.menuIndex === menuIndex &&
    activeItemSettings.itemIndex === itemIndex &&
    itemSettingsPopover.style.display !== "none"
  ) {
    closeItemSettingsPopover();
    return;
  }
  // Measure the anchor before the close calls below, which re-render the menu list
  // and detach this button — a detached node reports a 0,0 rect (top-left popup).
  const rect = anchorEl.getBoundingClientRect();
  closeAddItemDropdown();
  closeMenuSettingsDialog();

  const menu = menus[menuIndex];
  const item = menu?.items[itemIndex];
  if (!menu || !item) return;

  activeItemSettings = { menuIndex, itemIndex };
  activeItemSettingsBtn = anchorEl;

  const isSpace = item.type === "space";
  if (isSpace) {
    itemSettingsTitle.textContent = `␣ ${t("item.spaceBadge")}`;
    itemSettingsSpaceControls.style.display = "block";
    itemSettingsBookmarkControls.style.display = "none";
    itemSettingsDynamicControls.style.display = "none";
    itemSettingSpaceUnits.value = String(item.units ?? 1);
    itemSettingTransparent.checked = item.transparent !== false;
  } else {
    itemSettingsSpaceControls.style.display = "none";
    itemSettingsBookmarkControls.style.display = "block";

    const isMenuToggle = item.type === "menuToggle";
    const isDynamic = item.type === "dynamic";
    const tabModeField = itemSettingTabMode.parentElement;
    const changeActions = itemSettingChangeBtn.parentElement;
    if (tabModeField) tabModeField.style.display = isMenuToggle ? "none" : "";
    if (changeActions) changeActions.style.display = (isMenuToggle || isDynamic) ? "none" : "";

    if (isMenuToggle) {
      itemSettingsTitle.textContent = `⇕ ${item.rename || t("menu.foldButton")}`;
      itemSettingRename.value = item.rename ?? "";
      itemSettingsFolderControls.style.display = "none";
      itemSettingsDynamicControls.style.display = "none";
      positionPopover(itemSettingsPopover, rect, 250);
      return;
    }

    if (isDynamic) {
      const db = dynamicBookmarks.find((d) => d.uid === item.dynamicUid);
      itemSettingsTitle.textContent = `🜂 ${db?.name || t("dynamic.defaultName")}`;
      itemSettingRename.value = item.rename ?? "";
      itemSettingTabMode.value = item.tabMode ?? "";
      itemSettingsFolderControls.style.display = "none";
      itemSettingsDynamicControls.style.display = "block";
      itemSettingDynamicShowPageTitle.checked = item.showPageTitle === true;
      positionPopover(itemSettingsPopover, rect, 250);
      return;
    }

    itemSettingsDynamicControls.style.display = "none";

    const node = getItemNode(item);
    const isFolderNode = node ? (node.children !== undefined || node.url === undefined) : (item.type === "folder" || item.type === "flattenFolder");
    const isFolder = item.type === "folder" || (!item.type && isFolderNode) || item.type === "flattenFolder";

    const lastSeg = item.path && item.path.length > 0 ? item.path[item.path.length - 1] : undefined;
    const rawLabel =
      node?.title ??
      (lastSeg
        ? formatSpecialRootForDisplay(lastSeg, rawBookmarkTree)
        : "");
    itemSettingsTitle.textContent = `${isFolder ? "📁" : "🔖"} ${rawLabel.trim()}`;
    itemSettingRename.value = item.rename ?? "";
    itemSettingTabMode.value = item.tabMode ?? "";

    if (isFolder) {
      itemSettingsFolderControls.style.display = "flex";
      const isFlatten = item.type === "flattenFolder";
      itemSettingFlatten.checked = isFlatten;
      itemSettingHoverExpand.disabled = false;
      itemSettingHoverExpand.checked = item.expandOnHover !== false;
      itemSettingIncludeFoldersLabel.style.display = isFlatten ? "inline-flex" : "none";
      itemSettingIncludeFolders.checked = isFlatten && item.includeFolders === true;
    } else {
      itemSettingsFolderControls.style.display = "none";
    }
  }

  positionPopover(itemSettingsPopover, rect, 250);
}

function closeItemSettingsPopover(): void {
  itemSettingsPopover.style.display = "none";
  activeItemSettings = null;
  activeItemSettingsBtn = null;
}

function openShortcutSettingsPopover(
  target: StoredShortcut | StoredNativeShortcut,
  titleText: string,
  anchorEl: HTMLElement,
): void {
  if (activeShortcutSettingsBtn === anchorEl && shortcutSettingsPopover.style.display !== "none") {
    closeShortcutSettingsPopover();
    return;
  }

  closeColorPopover();
  closeItemSettingsPopover();
  closeAddItemDropdown();

  activeShortcutSettingsTarget = target;
  activeShortcutSettingsBtn = anchorEl;

  shortcutSettingsTitle.textContent = titleText;
  shortcutSettingTabMode.value = target.tabMode === "newTab" ? "newTab" : "replace";

  const rect = anchorEl.getBoundingClientRect();
  positionPopover(shortcutSettingsPopover, rect, 200);
}

function closeShortcutSettingsPopover(): void {
  shortcutSettingsPopover.style.display = "none";
  activeShortcutSettingsTarget = null;
  activeShortcutSettingsBtn = null;
}

function initSpaceBookmarkDialog(): void {
  addSpaceBookmarkBtn.addEventListener("click", () => {
    spaceBookmarkResult.textContent = "";
    delete spaceBookmarkResult.dataset.state;
    updateGapBookmarkFolderDisplay();
    spaceBookmarkDialog.showModal();
  });
  spaceBookmarkClose.addEventListener("click", () => spaceBookmarkDialog.close());
  spaceBookmarkCloseBtn.addEventListener("click", () => spaceBookmarkDialog.close());
  spaceBookmarkTransparent.addEventListener("change", updateSpaceBookmarkColorState);
  updateSpaceBookmarkColorState();
  spaceBookmarkFolderBtn.addEventListener("click", () => {
    void openBookmarkPicker("pickFolder");
  });

  spaceBookmarkForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addSpaceBookmark();
  });
}

function updateGapBookmarkFolderDisplay(): void {
  const node = findBookmarkNode(gapBookmarkFolderId, rawBookmarkTree);
  const label =
    gapBookmarkFolderId === "0"
      ? t("toolkit.defaultLocation")
      : node?.title || t("common.folder");
  spaceBookmarkFolderDisplay.textContent = label;
}

function updateSpaceBookmarkColorState(): void {
  spaceBookmarkColor.disabled = spaceBookmarkTransparent.checked;
}

async function addSpaceBookmark(): Promise<void> {
  const url = buildSpaceDirectiveUrl({
    units: Number(spaceBookmarkUnits.value),
    transparent: spaceBookmarkTransparent.checked,
    color: spaceBookmarkColor.value,
  });
  try {
    await browser.bookmarks.create({
      title: "Space",
      url,
      ...(gapBookmarkFolderId !== "0" ? { parentId: gapBookmarkFolderId } : {}),
    });
    rawBookmarkTree = await browser.bookmarks.getTree();
    spaceBookmarkResult.textContent = t("toolkit.added");
    spaceBookmarkResult.dataset.state = "success";
  } catch (error) {
    spaceBookmarkResult.textContent = t("toolkit.addFailed", {
      error: error instanceof Error ? error.message : String(error),
    });
    spaceBookmarkResult.dataset.state = "error";
  }
}

const DEFAULT_DYNAMIC_CODE = `/**
 * Dynamic Bookmark Handler
 *
 * @param {Object} context
 * @param {string} context.action  - Trigger event: "visit"
 * @param {string} context.url     - URL of the visited page
 * @param {string} context.title   - Title of the visited page
 * @param {Object} context.current - Current bookmark state: { url, title }
 *
 * @returns {Object}
 *   - { newUrl: string, title?: string } - Updates bookmark URL (title is optional; page title used if omitted)
 *   - { newUrl: null }                   - Keeps current bookmark unchanged
 */
function dynamicBookmark({ action, url, title, current }) {
  // Example 1: Track the last visited GitHub repository
  // if (url.startsWith("https://github.com/")) {
  //   return { newUrl: url, title };
  // }

  // Example 2: Track docs pages and customize bookmark title
  // if (url.includes("/docs/")) {
  //   return { newUrl: url, title: \`Doc: \${title}\` };
  // }

  return { newUrl: null };
}
`;

function createDynamicBookmark(): DynamicBookmark {
  return { uid: crypto.randomUUID(), name: t("dynamic.defaultName"), code: DEFAULT_DYNAMIC_CODE };
}

function buildDynamicMarkerUrl(uid: string): string {
  return `https://browserail.local/#Dynamic:${uid}`;
}

let dynamicValuesCache: DynamicValuesMap = {};
const collapsedDynamicUids = new Set<string>();

async function refreshDynamicValues(): Promise<void> {
  try {
    dynamicValuesCache = await loadDynamicValues();
  } catch {
    dynamicValuesCache = {};
  }
  renderDynamicList();
}

function renderDynamicList(): void {
  dynamicList.replaceChildren();
  if (dynamicBookmarks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "url-rule-empty-hint";
    empty.textContent = t("dynamic.empty");
    dynamicList.append(empty);
    return;
  }
  for (const db of dynamicBookmarks) {
    dynamicList.append(renderDynamicCard(db));
  }
}

function openDynamicSettingsDialog(db: DynamicBookmark): void {
  dynamicSettingsDialogTitle.textContent = `${db.name || t("dynamic.defaultName")} - ${t("menu.settings")}`;
  renderDynamicUrlRulesContent(db);
  dynamicSettingsDialog.showModal();
}

function renderDynamicUrlRulesContent(db: DynamicBookmark): void {
  dynamicSettingUrlRulesList.replaceChildren();

  const allRow = document.createElement("label");
  allRow.className = "menu-setting-url-rule-item";
  const allRadio = document.createElement("input");
  allRadio.type = "checkbox";
  const hasSpecificSets = Array.isArray(db.urlRuleUids) && db.urlRuleUids.length > 0;
  allRadio.checked = !hasSpecificSets;

  const allSpan = document.createElement("span");
  allSpan.textContent = t("menuBehavior.allUrls");
  allRow.append(allRadio, allSpan);
  dynamicSettingUrlRulesList.appendChild(allRow);

  allRadio.addEventListener("change", () => {
    if (allRadio.checked) {
      delete db.urlRuleUids;
    } else {
      if (urlRules.length > 0) {
        const firstRule = urlRules[0];
        if (firstRule) db.urlRuleUids = [firstRule.uid];
      }
    }
    renderDynamicUrlRulesContent(db);
    markDirty();
  });

  if (urlRules.length === 0) {
    const hint = document.createElement("div");
    hint.className = "url-rule-empty-hint";
    hint.style.fontSize = "11px";
    hint.style.padding = "6px";
    hint.textContent = t("menuBehavior.noUrlRules");
    dynamicSettingUrlRulesList.appendChild(hint);
  } else {
    urlRules.forEach((rule) => {
      const row = document.createElement("label");
      row.className = "menu-setting-url-rule-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = Array.isArray(db.urlRuleUids) && db.urlRuleUids.includes(rule.uid);
      cb.addEventListener("change", () => {
        if (!Array.isArray(db.urlRuleUids)) {
          db.urlRuleUids = [];
        }
        if (cb.checked) {
          if (!db.urlRuleUids.includes(rule.uid)) {
            db.urlRuleUids.push(rule.uid);
          }
        } else {
          db.urlRuleUids = db.urlRuleUids.filter((u) => u !== rule.uid);
        }
        if (db.urlRuleUids.length === 0) {
          delete db.urlRuleUids;
        }
        renderDynamicUrlRulesContent(db);
        markDirty();
      });

      const span = document.createElement("span");
      span.textContent = rule.name || t("urlRules.defaultName");
      if (rule.patterns.length > 0) {
        span.title = rule.patterns.join("\n");
      }

      row.append(cb, span);
      dynamicSettingUrlRulesList.appendChild(row);
    });
  }
}

function renderDynamicCard(db: DynamicBookmark): HTMLElement {
  const isCollapsed = collapsedDynamicUids.has(db.uid);
  const card = document.createElement("article");
  card.className = `menu-card dynamic-card${isCollapsed ? " is-collapsed" : ""}`;
  card.dataset.collapsed = String(isCollapsed);

  const header = document.createElement("header");

  const titleRow = document.createElement("div");
  titleRow.className = "menu-title-row";

  const collapseBtn = document.createElement("button");
  collapseBtn.type = "button";
  collapseBtn.className = "menu-collapse-btn";
  collapseBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>`;
  collapseBtn.title = isCollapsed ? t("menu.expand") : t("menu.collapse");
  collapseBtn.setAttribute("aria-label", collapseBtn.title);
  collapseBtn.setAttribute("aria-expanded", String(!isCollapsed));
  collapseBtn.addEventListener("click", () => {
    if (collapsedDynamicUids.has(db.uid)) {
      collapsedDynamicUids.delete(db.uid);
    } else {
      collapsedDynamicUids.add(db.uid);
    }
    renderDynamicList();
  });

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "dynamic-name-input";
  nameInput.value = db.name;
  nameInput.placeholder = t("dynamic.defaultName");
  nameInput.addEventListener("input", () => {
    db.name = nameInput.value;
    markDirty();
  });

  titleRow.append(collapseBtn, nameInput);

  const headerActions = document.createElement("div");
  headerActions.className = "dynamic-header-actions";

  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "action-btn menu-header-btn";
  settingsBtn.innerHTML = `${SETTINGS_ICON_SVG}<span>${t("menu.settings")}</span>`;
  settingsBtn.title = t("menu.settingsTitle");
  settingsBtn.addEventListener("click", () => {
    openDynamicSettingsDialog(db);
  });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "remove-item-btn menu-remove-btn";
  del.title = t("common.delete");
  del.setAttribute("aria-label", t("common.delete"));
  del.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg><span>${t("common.delete")}</span>`;
  del.addEventListener("click", () => {
    collapsedDynamicUids.delete(db.uid);
    dynamicBookmarks = dynamicBookmarks.filter((d) => d.uid !== db.uid);
    for (const menu of menus) {
      menu.items = menu.items.filter((i) => !(i.type === "dynamic" && i.dynamicUid === db.uid));
    }
    renderDynamicList();
    renderMenus();
    markDirty();
  });

  headerActions.append(settingsBtn, del);

  const live = dynamicValuesCache[db.uid];
  const subtitleRow = document.createElement("div");
  subtitleRow.className = "dynamic-subtitle-row";

  const currentGroup = document.createElement("div");
  currentGroup.className = "dynamic-current-group";

  const currentLabel = document.createElement("span");
  currentLabel.className = "dynamic-current-label";
  currentLabel.textContent = `${t("dynamic.currentLabel")}:`;
  currentGroup.append(currentLabel);

  if (live?.url) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "dynamic-current-chip";
    const fullTooltip = `${live.title ? `${live.title}\n` : ""}${live.url}\n(${t("dynamic.copyTooltip")})`;
    chip.title = fullTooltip;
    chip.setAttribute("aria-label", fullTooltip);

    const copyIcon = `<svg class="dynamic-current-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    const checkIcon = `<svg class="dynamic-current-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

    const displayTitle = live.url;
    chip.innerHTML = `${copyIcon}<span class="dynamic-current-title"></span>`;
    const titleSpan = chip.querySelector(".dynamic-current-title") as HTMLElement;
    titleSpan.textContent = displayTitle;

    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      void navigator.clipboard.writeText(live.url).then(() => {
        chip.classList.add("is-copied");
        chip.innerHTML = `${checkIcon}<span class="dynamic-current-title"></span>`;
        (chip.querySelector(".dynamic-current-title") as HTMLElement).textContent = t("dynamic.copied");
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          chip.classList.remove("is-copied");
          chip.innerHTML = `${copyIcon}<span class="dynamic-current-title"></span>`;
          (chip.querySelector(".dynamic-current-title") as HTMLElement).textContent = displayTitle;
        }, 1500);
      });
    });

    currentGroup.append(chip);
  } else {
    const emptySpan = document.createElement("span");
    emptySpan.className = "dynamic-current-empty";
    emptySpan.textContent = t("dynamic.noValue");
    currentGroup.append(emptySpan);
  }

  const actionsGroup = document.createElement("div");
  actionsGroup.className = "dynamic-card-actions";

  const addToBookmarksBtn = document.createElement("button");
  addToBookmarksBtn.type = "button";
  addToBookmarksBtn.className = "action-btn dynamic-add-btn";
  addToBookmarksBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg><span>${t("dynamic.addToBookmarks")}</span>`;
  addToBookmarksBtn.title = t("dynamic.addToBookmarks");
  addToBookmarksBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openDynamicMarkerDialog(db);
  });

  actionsGroup.append(addToBookmarksBtn);
  subtitleRow.append(currentGroup, actionsGroup);
  header.append(titleRow, headerActions, subtitleRow);

  // Card Body: pure code editor
  const body = document.createElement("div");
  body.className = "dynamic-card-body";

  const code = document.createElement("textarea");
  code.className = "dynamic-code";
  code.rows = 14;
  code.spellcheck = false;
  code.value = db.code;
  code.addEventListener("input", () => {
    db.code = code.value;
    markDirty();
  });
  code.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = code.selectionStart;
      const end = code.selectionEnd;
      code.value = code.value.substring(0, start) + "  " + code.value.substring(end);
      code.selectionStart = code.selectionEnd = start + 2;
      db.code = code.value;
      markDirty();
    }
  });

  body.append(code);
  card.append(header, body);
  return card;
}

function openPickDynamicBookmarkDialog(target: number | { shortcutSlot: string } | { nativeShortcutId: string }): void {
  if (typeof target === "number") {
    if (target < 0 || target >= menus.length) return;
    const menu = menus[target];
    if (!menu) return;
  }

  if (dynamicBookmarks.length === 0) {
    status.value = t("dynamic.noneCreated");
    return;
  }
  pickDynamicTitle.textContent = t("dynamic.pickTitle");
  pickDynamicList.replaceChildren();
  for (const db of dynamicBookmarks) {
    const itemBtn = document.createElement("button");
    itemBtn.type = "button";
    itemBtn.className = "pick-menu-item";

    const info = document.createElement("div");
    info.className = "pick-menu-item-info";
    const icon = document.createElement("span");
    icon.className = "pick-menu-item-icon";
    icon.textContent = "🜂";
    const title = document.createElement("span");
    title.className = "pick-menu-item-title";
    title.textContent = db.name;
    info.append(icon, title);

    const meta = document.createElement("span");
    meta.className = "pick-menu-item-meta";
    const liveVal = dynamicValuesCache[db.uid];
    meta.textContent = liveVal?.url || t("dynamic.noValueShort");

    itemBtn.append(info, meta);
    itemBtn.addEventListener("click", () => {
      if (typeof target === "number") {
        const menu = menus[target];
        if (menu) {
          menu.items.push({
            uid: crypto.randomUUID(),
            type: "dynamic",
            dynamicUid: db.uid,
          });
          renderMenus();
          markDirty();
          pickDynamicDialog.close();
          status.value = t("dynamic.addedToMenu", {
            menu: t("menu.title", { n: target + 1 }),
          });
        }
      } else if ("shortcutSlot" in target) {
        const slot = target.shortcutSlot;
        const existing = shortcuts.find((s) => s.slot === slot);
        if (existing) {
          existing.type = "dynamic";
          existing.dynamicUid = db.uid;
          delete existing.path;
          delete existing.url;
          delete existing.title;
        } else {
          shortcuts.push({
            slot,
            type: "dynamic",
            dynamicUid: db.uid,
            tabMode: "replace",
          });
        }
        renderShortcuts();
        renderMenus();
        markDirty();
        pickDynamicDialog.close();
      } else if ("nativeShortcutId" in target) {
        const id = target.nativeShortcutId;
        const existing = nativeShortcuts.find((s) => s.id === id);
        if (existing) {
          existing.type = "dynamic";
          existing.dynamicUid = db.uid;
          delete existing.path;
          delete existing.url;
          delete existing.title;
          renderNativeShortcuts();
          markDirty();
        }
        pickDynamicDialog.close();
      }
    });
    pickDynamicList.append(itemBtn);
  }
  pickDynamicDialog.showModal();
}

function updateDynamicMarkerFolderDisplay(): void {
  const node = findBookmarkNode(gapBookmarkFolderId, rawBookmarkTree);
  const label =
    gapBookmarkFolderId === "0"
      ? t("toolkit.defaultLocation")
      : node?.title || gapBookmarkFolderId;
  dynamicMarkerFolderDisplay.textContent = label;
}

function openDynamicMarkerDialog(db: DynamicBookmark): void {
  activeDynamicMarkerDb = db;
  dynamicMarkerResult.textContent = "";
  delete dynamicMarkerResult.dataset.state;
  updateDynamicMarkerFolderDisplay();
  dynamicMarkerDialog.showModal();
}

async function addDynamicMarkerBookmark(): Promise<void> {
  if (!activeDynamicMarkerDb) return;
  try {
    await browser.bookmarks.create({
      title: activeDynamicMarkerDb.name || t("dynamic.defaultName"),
      url: buildDynamicMarkerUrl(activeDynamicMarkerDb.uid),
      ...(gapBookmarkFolderId !== "0" ? { parentId: gapBookmarkFolderId } : {}),
    });
    rawBookmarkTree = await browser.bookmarks.getTree();
    dynamicMarkerResult.textContent = t("toolkit.added");
    dynamicMarkerResult.dataset.state = "success";
  } catch (error) {
    dynamicMarkerResult.textContent = t("toolkit.addFailed", {
      error: error instanceof Error ? error.message : String(error),
    });
    dynamicMarkerResult.dataset.state = "error";
  }
}

function initDynamicPanel(): void {
  addDynamicBtn.addEventListener("click", () => {
    const newDb = createDynamicBookmark();
    collapsedDynamicUids.delete(newDb.uid);
    dynamicBookmarks.push(newDb);
    renderDynamicList();
    markDirty();
  });
  document.getElementById("dynamic-tab")?.addEventListener("click", () => {
    void refreshDynamicValues();
  });

  dynamicSettingsClose.addEventListener("click", () => dynamicSettingsDialog.close());
  dynamicSettingsDialog.addEventListener("click", (e) => {
    if (e.target === dynamicSettingsDialog) dynamicSettingsDialog.close();
  });

  pickDynamicClose.addEventListener("click", () => pickDynamicDialog.close());
  pickDynamicDialog.addEventListener("click", (e) => {
    if (e.target === pickDynamicDialog) pickDynamicDialog.close();
  });

  dynamicMarkerFolderBtn.addEventListener("click", () => {
    void openBookmarkPicker("pickFolder");
  });
  dynamicMarkerClose.addEventListener("click", () => dynamicMarkerDialog.close());
  dynamicMarkerCloseBtn.addEventListener("click", () => dynamicMarkerDialog.close());
  dynamicMarkerDialog.addEventListener("click", (e) => {
    if (e.target === dynamicMarkerDialog) dynamicMarkerDialog.close();
  });
  dynamicMarkerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    void addDynamicMarkerBookmark();
  });

  void refreshDynamicValues();
}

function initShortcutsPanel(): void {
  shortcutsSubtabBrowser.addEventListener("click", () => {
    shortcutsSubtabBrowser.classList.add("is-active");
    shortcutsSubtabNative.classList.remove("is-active");
    shortcutsBrowserPanel.hidden = false;
    shortcutsNativePanel.hidden = true;
  });

  shortcutsSubtabNative.addEventListener("click", () => {
    shortcutsSubtabNative.classList.add("is-active");
    shortcutsSubtabBrowser.classList.remove("is-active");
    shortcutsNativePanel.hidden = false;
    shortcutsBrowserPanel.hidden = true;
  });

  addNativeShortcutBtn.addEventListener("click", () => {
    const newId = crypto.randomUUID();
    nativeShortcuts.push({
      id: newId,
      key: "",
      tabMode: "replace",
    });
    activeRecordingKeyId = newId;
    renderNativeShortcuts();
    markDirty();
  });

  window.addEventListener("keydown", (e) => {
    if (!activeRecordingKeyId) return;

    if (e.key === "Escape") {
      e.preventDefault();
      activeRecordingKeyId = null;
      renderNativeShortcuts();
      return;
    }

    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");

    let keyName = e.key;
    if (e.code.startsWith("Key")) {
      keyName = e.code.slice(3).toLowerCase();
    } else if (e.code.startsWith("Digit")) {
      keyName = e.code.slice(5);
    } else if (e.key === " ") {
      keyName = "Space";
    } else if (keyName.length === 1) {
      keyName = keyName.toLowerCase();
    }

    if (parts.length > 0 && keyName.length === 1) {
      keyName = keyName.toUpperCase();
    }

    parts.push(keyName);
    const recorded = parts.join("+");

    const target = nativeShortcuts.find((s) => s.id === activeRecordingKeyId);
    if (target) {
      target.key = recorded;
      markDirty();
    }
    activeRecordingKeyId = null;
    renderNativeShortcuts();
  });

  configureBrowserShortcutsBtn.addEventListener("click", () => {
    const kind = browserKind();
    const url =
      kind === "firefox"
        ? "about:addons"
        : kind === "edge"
          ? "edge://extensions/shortcuts"
          : "chrome://extensions/shortcuts";
    void browser.tabs.create({ url });
  });

  document.getElementById("shortcuts-tab")?.addEventListener("click", () => {
    void refreshBrowserCommands();
  });

  shortcutSettingsClose.addEventListener("click", closeShortcutSettingsPopover);
  shortcutSettingTabMode.addEventListener("change", () => {
    if (activeShortcutSettingsTarget) {
      activeShortcutSettingsTarget.tabMode = shortcutSettingTabMode.value as TabMode;
      renderShortcuts();
      renderNativeShortcuts();
      markDirty();
    }
  });

  shortcutSettingChangeBtn.addEventListener("click", () => {
    if (!activeShortcutSettingsTarget) return;
    const target = activeShortcutSettingsTarget;
    closeShortcutSettingsPopover();

    if ("slot" in target) {
      if (target.type === "dynamic") {
        openPickDynamicBookmarkDialog({ shortcutSlot: target.slot });
      } else {
        void openBookmarkPicker("pickShortcut", -1, -1, target.slot);
      }
    } else {
      if (target.type === "dynamic") {
        openPickDynamicBookmarkDialog({ nativeShortcutId: target.id });
      } else {
        void openBookmarkPicker("pickNativeShortcut", -1, -1, "", target.id);
      }
    }
  });

  document.addEventListener("pointerdown", (e) => {
    if (shortcutSettingsPopover.style.display === "none") return;
    const target = e.target as Node;
    if (
      shortcutSettingsPopover.contains(target) ||
      (activeShortcutSettingsBtn && activeShortcutSettingsBtn.contains(target))
    ) {
      return;
    }
    closeShortcutSettingsPopover();
  });
}

function renderNativeShortcuts(): void {
  nativeShortcutsList.replaceChildren();

  if (nativeShortcuts.length === 0) {
    const emptyRow = document.createElement("div");
    emptyRow.className = "shortcut-row";
    const emptyLabel = document.createElement("span");
    emptyLabel.className = "shortcut-empty-label";
    emptyLabel.textContent = t("shortcuts.emptyNative");
    emptyRow.append(emptyLabel);
    nativeShortcutsList.append(emptyRow);
    return;
  }

  for (const item of nativeShortcuts) {
    const row = document.createElement("div");
    row.className = "shortcut-row";

    // Key col
    const keyCol = document.createElement("div");
    keyCol.className = "shortcut-slot-col";

    const keyBtn = document.createElement("button");
    keyBtn.type = "button";
    const isRecording = activeRecordingKeyId === item.id;
    if (isRecording) {
      keyBtn.className = "key-recorder-btn is-recording";
      keyBtn.textContent = t("shortcuts.pressKey");
    } else if (item.key && item.key.trim().length > 0) {
      keyBtn.className = "key-recorder-btn";
      keyBtn.textContent = item.key;
    } else {
      keyBtn.className = "key-recorder-btn is-unset";
      keyBtn.textContent = t("shortcuts.pressKey");
    }

    keyBtn.addEventListener("click", () => {
      if (activeRecordingKeyId === item.id) {
        activeRecordingKeyId = null;
      } else {
        activeRecordingKeyId = item.id;
      }
      renderNativeShortcuts();
    });

    keyCol.append(keyBtn);

    // Target col
    const targetCol = document.createElement("div");
    targetCol.className = "shortcut-target-col";

    const actionsCol = document.createElement("div");
    actionsCol.className = "shortcut-actions-col";

    const hasTarget = item.type === "dynamic" ? Boolean(item.dynamicUid) : Boolean(item.path || item.url);

    if (hasTarget) {
      const icon = document.createElement("span");
      icon.className = "shortcut-target-icon";

      const title = document.createElement("span");
      title.className = "shortcut-target-title";

      const urlSpan = document.createElement("span");
      urlSpan.className = "shortcut-target-url";

      if (item.type === "dynamic") {
        icon.textContent = "🜂";
        const db = dynamicBookmarks.find((d) => d.uid === item.dynamicUid);
        title.textContent = db?.name || t("dynamic.defaultName");
        const liveVal = item.dynamicUid ? dynamicValuesCache[item.dynamicUid] : undefined;
        urlSpan.textContent = liveVal?.url || "";
        urlSpan.title = liveVal?.url || "";
      } else {
        icon.textContent = "🔖";
        let displayTitle = item.title || "";
        let displayUrl = item.url || "";
        if (item.path) {
          const rootPrefix = bookmarkRootPrefix;
          const effectivePath = combineRootAndItemPath(rootPrefix, item.path);
          const node = findBookmarkNodeByPath(rawBookmarkTree as BookmarkNode[], effectivePath, item.url);
          if (node?.title) displayTitle = node.title;
          if (node?.url) displayUrl = node.url;
        }
        title.textContent =
          displayTitle || (item.path ? item.path[item.path.length - 1] || "Bookmark" : "Bookmark");
        urlSpan.textContent = displayUrl;
        urlSpan.title = displayUrl;
      }

      targetCol.append(icon, title, urlSpan);

      // Settings button
      const settingsBtn = document.createElement("button");
      settingsBtn.type = "button";
      settingsBtn.className = "item-settings-btn";
      settingsBtn.title = t("itemSettings.title");
      settingsBtn.innerHTML = SETTINGS_ICON_SVG;
      settingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openShortcutSettingsPopover(item, item.key || t("itemSettings.title"), settingsBtn);
      });

      actionsCol.append(settingsBtn);
    } else {
      const emptyLabel = document.createElement("span");
      emptyLabel.className = "shortcut-empty-label";
      emptyLabel.textContent = t("shortcuts.emptyTarget");
      targetCol.append(emptyLabel);

      const pickBookmarkBtn = document.createElement("button");
      pickBookmarkBtn.type = "button";
      pickBookmarkBtn.className = "action-btn";
      pickBookmarkBtn.textContent = t("shortcuts.pickBookmark");
      pickBookmarkBtn.addEventListener("click", () => {
        void openBookmarkPicker("pickNativeShortcut", -1, -1, "", item.id);
      });
      actionsCol.append(pickBookmarkBtn);

      if (dynamicBookmarks.length > 0) {
        const pickDynamicBtn = document.createElement("button");
        pickDynamicBtn.type = "button";
        pickDynamicBtn.className = "action-btn";
        pickDynamicBtn.textContent = t("shortcuts.pickDynamic");
        pickDynamicBtn.addEventListener("click", () => {
          openPickDynamicBookmarkDialog({ nativeShortcutId: item.id });
        });
        actionsCol.append(pickDynamicBtn);
      }
    }

    // Delete button (matches menu item remove-item-btn)
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "remove-item-btn";
    deleteBtn.title = t("common.delete");
    deleteBtn.innerHTML = REMOVE_ICON_SVG;
    deleteBtn.addEventListener("click", () => {
      const idx = nativeShortcuts.findIndex((s) => s.id === item.id);
      if (idx !== -1) {
        nativeShortcuts.splice(idx, 1);
        if (activeRecordingKeyId === item.id) activeRecordingKeyId = null;
        if (activeShortcutSettingsTarget === item) closeShortcutSettingsPopover();
        renderNativeShortcuts();
        markDirty();
      }
    });
    actionsCol.append(deleteBtn);

    row.append(keyCol, targetCol, actionsCol);
    nativeShortcutsList.append(row);
  }
}

function renderShortcuts(): void {
  shortcutsList.replaceChildren();

  for (let i = 1; i <= 9; i++) {
    const slotKey = `slot_${i}`;
    const row = document.createElement("div");
    row.className = "shortcut-row";

    // Slot info col
    const slotCol = document.createElement("div");
    slotCol.className = "shortcut-slot-col";

    const slotTitle = document.createElement("span");
    slotTitle.className = "shortcut-slot-title";
    slotTitle.textContent = t("shortcuts.slotTitle", { n: String(i) });

    const keyBadge = document.createElement("span");
    const rawKey = browserCommandsMap[slotKey];
    if (rawKey && rawKey.trim().length > 0) {
      keyBadge.className = "shortcut-key-badge";
      keyBadge.textContent = rawKey;
    } else {
      keyBadge.className = "shortcut-key-badge is-unset";
      keyBadge.textContent = t("shortcuts.keyUnset");
      keyBadge.title = t("shortcuts.keyUnsetHint");
    }

    slotCol.append(slotTitle, keyBadge);

    // Target col
    const targetCol = document.createElement("div");
    targetCol.className = "shortcut-target-col";

    const target = shortcuts.find((s) => s.slot === slotKey);

    const actionsCol = document.createElement("div");
    actionsCol.className = "shortcut-actions-col";

    if (
      target &&
      (target.type === "dynamic"
        ? Boolean(target.dynamicUid)
        : Boolean(target.path || target.url))
    ) {
      const icon = document.createElement("span");
      icon.className = "shortcut-target-icon";

      const title = document.createElement("span");
      title.className = "shortcut-target-title";

      const urlSpan = document.createElement("span");
      urlSpan.className = "shortcut-target-url";

      if (target.type === "dynamic") {
        icon.textContent = "🜂";
        const db = dynamicBookmarks.find((d) => d.uid === target.dynamicUid);
        title.textContent = db?.name || t("dynamic.defaultName");
        const liveVal = target.dynamicUid ? dynamicValuesCache[target.dynamicUid] : undefined;
        urlSpan.textContent = liveVal?.url || "";
        urlSpan.title = liveVal?.url || "";
      } else {
        icon.textContent = "🔖";
        let displayTitle = target.title || "";
        let displayUrl = target.url || "";
        if (target.path) {
          const rootPrefix = bookmarkRootPrefix;
          const effectivePath = combineRootAndItemPath(rootPrefix, target.path);
          const node = findBookmarkNodeByPath(rawBookmarkTree as BookmarkNode[], effectivePath, target.url);
          if (node?.title) displayTitle = node.title;
          if (node?.url) displayUrl = node.url;
        }
        title.textContent =
          displayTitle || (target.path ? target.path[target.path.length - 1] || "Bookmark" : "Bookmark");
        urlSpan.textContent = displayUrl;
        urlSpan.title = displayUrl;
      }

      targetCol.append(icon, title, urlSpan);

      // Settings button
      const settingsBtn = document.createElement("button");
      settingsBtn.type = "button";
      settingsBtn.className = "item-settings-btn";
      settingsBtn.title = t("menu.settings");
      settingsBtn.innerHTML = SETTINGS_ICON_SVG;
      settingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openShortcutSettingsPopover(target, t("shortcuts.slotTitle", { n: String(i) }), settingsBtn);
      });

      // Clear button (minus icon, matching remove-item-btn)
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "remove-item-btn";
      clearBtn.title = t("shortcuts.clearTarget");
      clearBtn.innerHTML = REMOVE_ICON_SVG;
      clearBtn.addEventListener("click", () => {
        const idx = shortcuts.findIndex((s) => s.slot === slotKey);
        if (idx !== -1) {
          if (activeShortcutSettingsTarget === shortcuts[idx]) {
            closeShortcutSettingsPopover();
          }
          shortcuts.splice(idx, 1);
          renderShortcuts();
          renderMenus();
          markDirty();
        }
      });

      actionsCol.append(settingsBtn, clearBtn);
    } else {
      const emptyLabel = document.createElement("span");
      emptyLabel.className = "shortcut-empty-label";
      emptyLabel.textContent = t("shortcuts.emptyTarget");
      targetCol.append(emptyLabel);

      const pickBookmarkBtn = document.createElement("button");
      pickBookmarkBtn.type = "button";
      pickBookmarkBtn.className = "action-btn";
      pickBookmarkBtn.textContent = t("shortcuts.pickBookmark");
      pickBookmarkBtn.addEventListener("click", () => {
        void openBookmarkPicker("pickShortcut", -1, -1, slotKey);
      });
      actionsCol.append(pickBookmarkBtn);

      if (dynamicBookmarks.length > 0) {
        const pickDynamicBtn = document.createElement("button");
        pickDynamicBtn.type = "button";
        pickDynamicBtn.className = "action-btn";
        pickDynamicBtn.textContent = t("shortcuts.pickDynamic");
        pickDynamicBtn.addEventListener("click", () => {
          openPickDynamicBookmarkDialog({ shortcutSlot: slotKey });
        });
        actionsCol.append(pickDynamicBtn);
      }
    }

    row.append(slotCol, targetCol, actionsCol);
    shortcutsList.append(row);
  }
}

function initAddItemPopover(): void {
  addPopoverBookmarkBtn.addEventListener("click", () => {
    const menuIdx = activeAddMenuIndex;
    closeAddItemDropdown();
    if (menuIdx >= 0 && menuIdx < menus.length) {
      void openBookmarkPicker("addItem", menuIdx);
    }
  });

  addPopoverSpaceBtn.addEventListener("click", () => {
    const menuIdx = activeAddMenuIndex;
    closeAddItemDropdown();
    if (menuIdx >= 0 && menuIdx < menus.length) {
      const menu = menus[menuIdx];
      if (menu) {
        const newSpace: StoredMenuItem = {
          uid: crypto.randomUUID(),
          type: "space",
          units: 1,
          transparent: true,
        };
        menu.items.push(newSpace);
        renderMenus();
        markDirty();
      }
    }
  });

  addPopoverMenuToggleBtn.addEventListener("click", () => {
    const menuIdx = activeAddMenuIndex;
    closeAddItemDropdown();
    if (menuIdx < 0 || menuIdx >= menus.length) return;
    const menu = menus[menuIdx];
    if (!menu) return;
    if (menu.items.some((item) => item.type === "menuToggle")) {
      status.value = t("menu.menuToggleAlreadyExists");
      return;
    }
    menu.items.push({
      uid: crypto.randomUUID(),
      type: "menuToggle",
    });
    renderMenus();
    markDirty();
  });

  addPopoverDynamicBtn.addEventListener("click", () => {
    const menuIdx = activeAddMenuIndex;
    closeAddItemDropdown();
    if (menuIdx < 0 || menuIdx >= menus.length) return;
    openPickDynamicBookmarkDialog(menuIdx);
  });

  document.addEventListener("pointerdown", (e) => {
    if (addItemPopover.style.display === "none") return;
    const target = e.target as Node | null;
    if (
      target &&
      !addItemPopover.contains(target) &&
      activeAddBtn &&
      !activeAddBtn.contains(target)
    ) {
      closeAddItemDropdown();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && addItemPopover.style.display !== "none") {
      closeAddItemDropdown();
    }
  });
}

function openAddItemDropdown(menuIndex: number, btnElement: HTMLElement): void {
  if (activeAddMenuIndex === menuIndex && addItemPopover.style.display !== "none") {
    closeAddItemDropdown();
    return;
  }
  const rect = btnElement.getBoundingClientRect();
  closeMenuSettingsDialog();
  closeColorPopover();
  closeItemSettingsPopover();

  activeAddMenuIndex = menuIndex;
  activeAddBtn = btnElement;

  positionPopover(addItemPopover, rect, 170, "right");
}

function closeAddItemDropdown(): void {
  addItemPopover.style.display = "none";
  activeAddMenuIndex = -1;
  activeAddBtn = null;
}

let draggingItem: { menuIndex: number; itemIndex: number } | null = null;
// Collapsed state is view-only; persisting it would write UI preferences into
// the exported menu config that the desktop surfaces consume.
const collapsedMenuUids = new Set<string>();

function renderMenus(): void {
  menusContainer.replaceChildren(
    ...menus.map((menu, menuIndex) => {
      const isCollapsed = collapsedMenuUids.has(menu.uid);
      const card = document.createElement("article");
      card.className = `menu-card${isCollapsed ? " is-collapsed" : ""}`;
      const isMenuEnabled = menu.enabled !== false;
      card.dataset.enabled = String(isMenuEnabled);
      card.dataset.collapsed = String(isCollapsed);

      const header = document.createElement("header");

      const titleRow = document.createElement("div");
      titleRow.className = "menu-title-row";

      const collapseBtn = document.createElement("button");
      collapseBtn.type = "button";
      collapseBtn.className = "menu-collapse-btn";
      collapseBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>`;
      collapseBtn.title = isCollapsed ? t("menu.expand") : t("menu.collapse");
      collapseBtn.setAttribute("aria-label", collapseBtn.title);
      collapseBtn.setAttribute("aria-expanded", String(!isCollapsed));
      collapseBtn.addEventListener("click", () => {
        if (collapsedMenuUids.has(menu.uid)) {
          collapsedMenuUids.delete(menu.uid);
        } else {
          collapsedMenuUids.add(menu.uid);
          if (activeMenuSettingsIndex === menuIndex) closeMenuSettingsDialog();
          if (activeColorTarget === menu) closeColorPopover();
          if (activeAddMenuIndex === menuIndex) closeAddItemDropdown();
        }
        renderMenus();
      });

      const title = document.createElement("strong");
      title.textContent = t("menu.title", { n: menuIndex + 1 });

      const toggleLabel = document.createElement("label");
      toggleLabel.className = "switch-toggle";
      toggleLabel.title = isMenuEnabled ? t("menu.disable") : t("menu.enable");
      toggleLabel.setAttribute("aria-label", toggleLabel.title);

      const toggleInput = document.createElement("input");
      toggleInput.type = "checkbox";
      toggleInput.checked = isMenuEnabled;
      toggleInput.addEventListener("change", () => {
        const enabled = toggleInput.checked;
        menu.enabled = enabled;
        card.dataset.enabled = String(enabled);
        toggleLabel.title = enabled ? t("menu.disable") : t("menu.enable");
        toggleLabel.setAttribute("aria-label", toggleLabel.title);
        void persistMenuEnabled(menu, enabled)
          .then((saved) => {
            if (!saved) markDirty();
          })
          .catch((error: unknown) => {
            markDirty();
            status.value = t("status.saveFailed", { error: String(error) });
          });
      });

      const toggleSlider = document.createElement("span");
      toggleSlider.className = "switch-slider";

      toggleLabel.append(toggleInput, toggleSlider);

      const settingsBtn = document.createElement("button");
      settingsBtn.type = "button";
      settingsBtn.className = "action-btn menu-header-btn";
      settingsBtn.innerHTML = `${SETTINGS_ICON_SVG}<span>${t("menu.settings")}</span>`;
      settingsBtn.title = t("menu.settingsTitle");
      settingsBtn.addEventListener("click", () => {
        openMenuSettingsDialog(menuIndex);
      });

      const resetPositionBtn = document.createElement("button");
      resetPositionBtn.type = "button";
      resetPositionBtn.className = "action-btn menu-header-btn";
      resetPositionBtn.textContent = t("menu.resetPosition");
      resetPositionBtn.title = t("menu.resetPositionTitle");
      resetPositionBtn.addEventListener("click", () => {
        void browser.runtime.sendMessage({ type: "resetMenuLayout", menuUid: menu.uid });
      });

      titleRow.append(collapseBtn, title, toggleLabel, resetPositionBtn);

      const headerActions = document.createElement("div");
      headerActions.className = "menu-header-actions";

      // Menu default color swatch button (to the left of Settings)
      const menuColorSwatch = document.createElement("button");
      menuColorSwatch.type = "button";
      menuColorSwatch.className = `item-color-swatch menu-color-swatch ${!menu.color ? "has-no-color" : ""}`;
      menuColorSwatch.title = menu.color
        ? t("menu.colorSwatchSet", { color: menu.color })
        : t("menu.colorSwatchEmpty");
      updateSwatchAppearance(menuColorSwatch, menu.color);
      menuColorSwatch.addEventListener("click", (e) => {
        e.stopPropagation();
        openColorPopover(menu, menuColorSwatch);
      });

      const removeMenu = document.createElement("button");
      removeMenu.type = "button";
      removeMenu.className = "remove-item-btn menu-remove-btn";
      removeMenu.title = t("menu.removeMenu");
      removeMenu.setAttribute("aria-label", t("menu.removeMenu"));
      removeMenu.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg><span>${t("menu.remove")}</span>`;
      removeMenu.addEventListener("click", () => {
        if (activeMenuSettingsIndex === menuIndex) {
          closeMenuSettingsDialog();
        }
        if (activeColorTarget === menu) {
          closeColorPopover();
        }
        if (activeAddMenuIndex === menuIndex) {
          closeAddItemDropdown();
        }
        menus.splice(menuIndex, 1);
        collapsedMenuUids.delete(menu.uid);
        renderMenus();
        markDirty();
      });

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "action-btn menu-header-btn menu-add-btn";
      addBtn.textContent = t("menu.add");
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openAddItemDropdown(menuIndex, addBtn);
      });

      headerActions.append(menuColorSwatch, settingsBtn, removeMenu, addBtn);
      header.append(titleRow, headerActions);

      const items = document.createElement("ol");
      items.replaceChildren(
        ...menu.items.map((item, itemIndex) => {
          const row = document.createElement("li");
          row.className = "menu-item-row";

          if (item.type === "menuToggle") {
            const label = document.createElement("span");
            label.className = "item-label";

            const titleSpan = document.createElement("span");
            titleSpan.className = "item-title";
            titleSpan.textContent = item.rename
              ? `${item.rename} (${t("menu.addMenuToggle")})`
              : `⇕ ${t("menu.addMenuToggle")}`;
            titleSpan.title = t("menu.addMenuToggle");
            label.appendChild(titleSpan);

            const controls = document.createElement("div");
            controls.className = "item-color-controls";

            const dragHandleBtn = document.createElement("button");
            dragHandleBtn.type = "button";
            dragHandleBtn.className = "drag-handle-btn";
            dragHandleBtn.title = t("item.dragHandleTitle");
            dragHandleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>`;
            dragHandleBtn.addEventListener("mousedown", () => {
              row.draggable = true;
            });
            dragHandleBtn.addEventListener("mouseup", () => {
              if (!row.classList.contains("is-dragging")) row.draggable = false;
            });
            dragHandleBtn.addEventListener("mouseleave", () => {
              if (!row.classList.contains("is-dragging")) row.draggable = false;
            });

            row.addEventListener("dragstart", (event) => {
              draggingItem = { menuIndex, itemIndex };
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", `${menuIndex}:${itemIndex}`);
              }
              requestAnimationFrame(() => row.classList.add("is-dragging"));
            });
            row.addEventListener("dragover", (event) => {
              if (!draggingItem || draggingItem.menuIndex !== menuIndex) return;
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
              const rect = row.getBoundingClientRect();
              const isAfter = event.clientY > rect.top + rect.height / 2;
              row.classList.toggle("drag-over-top", !isAfter);
              row.classList.toggle("drag-over-bottom", isAfter);
            });
            row.addEventListener("dragleave", () => {
              row.classList.remove("drag-over-top", "drag-over-bottom");
            });
            row.addEventListener("drop", (event) => {
              event.preventDefault();
              row.classList.remove("drag-over-top", "drag-over-bottom");
              if (!draggingItem || draggingItem.menuIndex !== menuIndex) return;
              const sourceIndex = draggingItem.itemIndex;
              const rect = row.getBoundingClientRect();
              const isAfter = event.clientY > rect.top + rect.height / 2;
              let targetIndex = isAfter ? itemIndex + 1 : itemIndex;
              if (sourceIndex < targetIndex) targetIndex--;
              if (sourceIndex !== targetIndex) {
                const [moved] = menu.items.splice(sourceIndex, 1);
                if (moved) menu.items.splice(targetIndex, 0, moved);
                renderMenus();
                markDirty();
              }
              draggingItem = null;
            });
            row.addEventListener("dragend", () => {
              row.draggable = false;
              row.classList.remove("is-dragging");
              draggingItem = null;
              items.querySelectorAll(".menu-item-row").forEach((element) => {
                element.classList.remove("drag-over-top", "drag-over-bottom", "is-dragging");
              });
            });

            const settingsBtn = document.createElement("button");
            settingsBtn.type = "button";
            settingsBtn.className = "item-settings-btn";
            settingsBtn.title = t("itemSettings.title");
            settingsBtn.innerHTML = SETTINGS_ICON_SVG;
            settingsBtn.addEventListener("click", (event) => {
              event.stopPropagation();
              openItemSettingsPopover(menuIndex, itemIndex, settingsBtn);
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "remove-item-btn";
            removeBtn.title = t("menu.removeItem");
            removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg>`;
            removeBtn.addEventListener("click", () => {
              menu.items.splice(itemIndex, 1);
              renderMenus();
              markDirty();
            });

            controls.append(dragHandleBtn, settingsBtn, removeBtn);
            row.append(label, controls);
            return row;
          }

          if (item.type === "space") {
            const units = item.units ?? 1;

            const label = document.createElement("span");
            label.className = "item-label";

            const titleSpan = document.createElement("span");
            titleSpan.className = "item-title";
            titleSpan.textContent = `␣ ${t("item.spaceBadge")} (${units}x)`;
            titleSpan.title = `${t("item.spaceBadge")} (${units}x)`;
            label.appendChild(titleSpan);


            const controls = document.createElement("div");
            controls.className = "item-color-controls";

            const dragHandleBtn = document.createElement("button");
            dragHandleBtn.type = "button";
            dragHandleBtn.className = "drag-handle-btn";
            dragHandleBtn.title = t("item.dragHandleTitle");
            dragHandleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>`;

            dragHandleBtn.addEventListener("mousedown", () => {
              row.draggable = true;
            });
            dragHandleBtn.addEventListener("mouseup", () => {
              if (!row.classList.contains("is-dragging")) {
                row.draggable = false;
              }
            });
            dragHandleBtn.addEventListener("mouseleave", () => {
              if (!row.classList.contains("is-dragging")) {
                row.draggable = false;
              }
            });

            row.addEventListener("dragstart", (e) => {
              draggingItem = { menuIndex, itemIndex };
              if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", `${menuIndex}:${itemIndex}`);
              }
              requestAnimationFrame(() => {
                row.classList.add("is-dragging");
              });
            });

            row.addEventListener("dragover", (e) => {
              if (!draggingItem || draggingItem.menuIndex !== menuIndex) return;
              e.preventDefault();
              if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "move";
              }
              const rect = row.getBoundingClientRect();
              const isAfter = e.clientY > rect.top + rect.height / 2;
              row.classList.toggle("drag-over-top", !isAfter);
              row.classList.toggle("drag-over-bottom", isAfter);
            });

            row.addEventListener("dragleave", () => {
              row.classList.remove("drag-over-top", "drag-over-bottom");
            });

            row.addEventListener("drop", (e) => {
              e.preventDefault();
              row.classList.remove("drag-over-top", "drag-over-bottom");
              if (!draggingItem || draggingItem.menuIndex !== menuIndex) return;
              const sourceIndex = draggingItem.itemIndex;
              const rect = row.getBoundingClientRect();
              const isAfter = e.clientY > rect.top + rect.height / 2;
              let targetIndex = isAfter ? itemIndex + 1 : itemIndex;
              if (sourceIndex < targetIndex) {
                targetIndex--;
              }
              if (sourceIndex !== targetIndex) {
                const [moved] = menu.items.splice(sourceIndex, 1);
                if (moved) menu.items.splice(targetIndex, 0, moved);
                renderMenus();
                markDirty();
              }
              draggingItem = null;
            });

            row.addEventListener("dragend", () => {
              row.draggable = false;
              row.classList.remove("is-dragging");
              draggingItem = null;
              items.querySelectorAll(".menu-item-row").forEach((el) => {
                el.classList.remove("drag-over-top", "drag-over-bottom", "is-dragging");
              });
            });

            const settingsBtn = document.createElement("button");
            settingsBtn.type = "button";
            settingsBtn.className = "item-settings-btn";
            settingsBtn.title = t("itemSettings.title");
            settingsBtn.innerHTML = SETTINGS_ICON_SVG;
            settingsBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              openItemSettingsPopover(menuIndex, itemIndex, settingsBtn);
            });

            const swatch = document.createElement("button");
            swatch.type = "button";
            swatch.className = `item-color-swatch ${!item.color ? "has-no-color" : ""}`;
            updateSwatchAppearance(swatch, item.color);
            if (!item.color && menu.color) {
              swatch.title = t("item.followMenuColor", { color: menu.color });
            }
            swatch.addEventListener("click", (e) => {
              e.stopPropagation();
              openColorPopover(item, swatch);
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "remove-item-btn";
            removeBtn.title = t("menu.removeItem");
            removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg>`;
            removeBtn.addEventListener("click", () => {
              if (activeColorTarget === item) {
                closeColorPopover();
              }
              if (
                activeItemSettings &&
                activeItemSettings.menuIndex === menuIndex &&
                activeItemSettings.itemIndex === itemIndex
              ) {
                closeItemSettingsPopover();
              }
              menu.items.splice(itemIndex, 1);
              renderMenus();
              markDirty();
            });

            controls.append(dragHandleBtn, settingsBtn, swatch, removeBtn);
            row.append(label, controls);
            return row;
          }

          if (item.type === "dynamic") {
            const db = dynamicBookmarks.find((d) => d.uid === item.dynamicUid);
            const rawLabel = db?.name || t("dynamic.defaultName");
            const customRename = item.rename;

            const label = document.createElement("span");
            label.className = "item-label";

            const titleSpan = document.createElement("span");
            titleSpan.className = "item-title";
            if (customRename) {
              titleSpan.textContent = `${customRename} (${rawLabel.trim()})`;
            } else {
              titleSpan.textContent = `🜂 ${rawLabel.trim()}`;
            }
            const liveUrl = db?.uid ? dynamicValuesCache[db.uid]?.url : undefined;
            titleSpan.title = liveUrl ? `${rawLabel.trim()}\n${liveUrl}` : rawLabel.trim();
            label.appendChild(titleSpan);

            const dynamicTag = document.createElement("span");
            dynamicTag.className = "item-tag item-tag-dynamic";
            dynamicTag.textContent = t("section.dynamic");
            label.appendChild(dynamicTag);


            const itemShortcut = findItemShortcut(item);
            if (itemShortcut) {
              const shortcutBadge = document.createElement("span");
              shortcutBadge.className = "item-tag item-tag-shortcut";
              const rawKey = browserCommandsMap[itemShortcut.slot];
              const keyLabel = (rawKey && rawKey.trim().length > 0) ? rawKey : itemShortcut.slot.replace("slot_", "#");
              shortcutBadge.textContent = t("item.shortcutBadge", { key: keyLabel });
              shortcutBadge.title = `${t("item.shortcutBadge", { key: keyLabel })} (${t("shortcuts.slotTitle", { n: itemShortcut.slot.replace("slot_", "") })})`;
              shortcutBadge.addEventListener("click", (e) => {
                e.stopPropagation();
                document.getElementById("shortcuts-tab")?.click();
              });
              label.appendChild(shortcutBadge);
            }

            const controls = document.createElement("div");
            controls.className = "item-color-controls";

            const dragHandleBtn = document.createElement("button");
            dragHandleBtn.type = "button";
            dragHandleBtn.className = "drag-handle-btn";
            dragHandleBtn.title = t("item.dragHandleTitle");
            dragHandleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>`;

            dragHandleBtn.addEventListener("mousedown", () => {
              row.draggable = true;
            });
            dragHandleBtn.addEventListener("mouseup", () => {
              if (!row.classList.contains("is-dragging")) {
                row.draggable = false;
              }
            });
            dragHandleBtn.addEventListener("mouseleave", () => {
              if (!row.classList.contains("is-dragging")) {
                row.draggable = false;
              }
            });

            row.addEventListener("dragstart", (e) => {
              draggingItem = { menuIndex, itemIndex };
              if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", `${menuIndex}:${itemIndex}`);
              }
              requestAnimationFrame(() => {
                row.classList.add("is-dragging");
              });
            });

            row.addEventListener("dragover", (e) => {
              if (!draggingItem || draggingItem.menuIndex !== menuIndex) return;
              e.preventDefault();
              if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "move";
              }
              const rect = row.getBoundingClientRect();
              const isAfter = e.clientY > rect.top + rect.height / 2;
              row.classList.toggle("drag-over-top", !isAfter);
              row.classList.toggle("drag-over-bottom", isAfter);
            });

            row.addEventListener("dragleave", () => {
              row.classList.remove("drag-over-top", "drag-over-bottom");
            });

            row.addEventListener("drop", (e) => {
              e.preventDefault();
              row.classList.remove("drag-over-top", "drag-over-bottom");
              if (!draggingItem || draggingItem.menuIndex !== menuIndex) return;
              const sourceIndex = draggingItem.itemIndex;
              const rect = row.getBoundingClientRect();
              const isAfter = e.clientY > rect.top + rect.height / 2;
              let targetIndex = isAfter ? itemIndex + 1 : itemIndex;
              if (sourceIndex < targetIndex) {
                targetIndex--;
              }
              if (sourceIndex !== targetIndex) {
                const [moved] = menu.items.splice(sourceIndex, 1);
                if (moved) menu.items.splice(targetIndex, 0, moved);
                renderMenus();
                markDirty();
              }
              draggingItem = null;
            });

            row.addEventListener("dragend", () => {
              row.draggable = false;
              row.classList.remove("is-dragging");
              draggingItem = null;
              items.querySelectorAll(".menu-item-row").forEach((el) => {
                el.classList.remove("drag-over-top", "drag-over-bottom", "is-dragging");
              });
            });

            const settingsBtn = document.createElement("button");
            settingsBtn.type = "button";
            settingsBtn.className = "item-settings-btn";
            settingsBtn.title = t("itemSettings.title");
            settingsBtn.innerHTML = SETTINGS_ICON_SVG;
            settingsBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              openItemSettingsPopover(menuIndex, itemIndex, settingsBtn);
            });

            const swatch = document.createElement("button");
            swatch.type = "button";
            swatch.className = `item-color-swatch ${!item.color ? "has-no-color" : ""}`;
            updateSwatchAppearance(swatch, item.color);
            if (!item.color && menu.color) {
              swatch.title = t("item.followMenuColor", { color: menu.color });
            }
            swatch.addEventListener("click", (e) => {
              e.stopPropagation();
              openColorPopover(item, swatch);
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "remove-item-btn";
            removeBtn.title = t("menu.removeItem");
            removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg>`;
            removeBtn.addEventListener("click", () => {
              if (activeColorTarget === item) {
                closeColorPopover();
              }
              if (
                activeItemSettings &&
                activeItemSettings.menuIndex === menuIndex &&
                activeItemSettings.itemIndex === itemIndex
              ) {
                closeItemSettingsPopover();
              }
              menu.items.splice(itemIndex, 1);
              renderMenus();
              markDirty();
            });

            controls.append(dragHandleBtn, settingsBtn, swatch, removeBtn);
            row.append(label, controls);
            return row;
          }

          const pathResolution = getItemResolution(item);
          const node = pathResolution.node;
          const isFolderNode = node ? (node.children !== undefined || node.url === undefined) : (item.type === "folder" || item.type === "flattenFolder");
          const isFlatten = item.type === "flattenFolder";
          const isFolder = item.type === "folder" || (!item.type && isFolderNode);

          const label = document.createElement("span");
          label.className = "item-label";

          const lastSeg = item.path && item.path.length > 0 ? item.path[item.path.length - 1] : undefined;
          const rawLabel =
            node?.title ??
            (lastSeg
              ? formatSpecialRootForDisplay(lastSeg, rawBookmarkTree)
              : "");
          const customRename = item.rename;
          const iconPrefix = isFolderNode ? "📁" : "🔖";

          const titleSpan = document.createElement("span");
          titleSpan.className = "item-title";
          if (customRename) {
            titleSpan.textContent = `${customRename} (${rawLabel.trim()})`;
          } else {
            titleSpan.textContent = `${iconPrefix} ${rawLabel.trim()}`;
          }
          titleSpan.title = rawLabel.trim();
          label.appendChild(titleSpan);


          if (isFlatten) {
            const badge = document.createElement("span");
            badge.className = "item-tag item-tag-flatten";
            const childCount = node?.children
              ? (item.includeFolders
                  ? node.children.length
                  : node.children.filter((c) => c.url !== undefined).length)
              : 0;
            badge.textContent = t("item.flattenBadge", { count: childCount });
            badge.title = t("item.flattenBadgeTitle", { count: childCount });
            badge.addEventListener("click", (e) => {
              e.stopPropagation();
              openItemSettingsPopover(menuIndex, itemIndex, badge);
            });
            label.appendChild(badge);
          } else if (isFolder) {
            const badge = document.createElement("span");
            badge.className = "item-tag item-tag-folder";
            badge.textContent = t("item.folderBadge");
            badge.title = t("item.folderBadgeTitle");
            badge.addEventListener("click", (e) => {
              e.stopPropagation();
              openItemSettingsPopover(menuIndex, itemIndex, badge);
            });
            label.appendChild(badge);
          }

          const itemShortcut = findItemShortcut(item);
          if (itemShortcut) {
            const shortcutBadge = document.createElement("span");
            shortcutBadge.className = "item-tag item-tag-shortcut";
            const rawKey = browserCommandsMap[itemShortcut.slot];
            const keyLabel = (rawKey && rawKey.trim().length > 0) ? rawKey : itemShortcut.slot.replace("slot_", "#");
            shortcutBadge.textContent = t("item.shortcutBadge", { key: keyLabel });
            shortcutBadge.title = `${t("item.shortcutBadge", { key: keyLabel })} (${t("shortcuts.slotTitle", { n: itemShortcut.slot.replace("slot_", "") })})`;
            shortcutBadge.addEventListener("click", (e) => {
              e.stopPropagation();
              document.getElementById("shortcuts-tab")?.click();
            });
            label.appendChild(shortcutBadge);
          }

          const controls = document.createElement("div");
          controls.className = "item-color-controls";

          // Drag handle button to directly drag and drop bookmarks
          const dragHandleBtn = document.createElement("button");
          dragHandleBtn.type = "button";
          dragHandleBtn.className = "drag-handle-btn";
          dragHandleBtn.title = t("item.dragHandleTitle");
          dragHandleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>`;

          dragHandleBtn.addEventListener("mousedown", () => {
            row.draggable = true;
          });
          dragHandleBtn.addEventListener("mouseup", () => {
            if (!row.classList.contains("is-dragging")) {
              row.draggable = false;
            }
          });
          dragHandleBtn.addEventListener("mouseleave", () => {
            if (!row.classList.contains("is-dragging")) {
              row.draggable = false;
            }
          });

          row.addEventListener("dragstart", (e) => {
            draggingItem = { menuIndex, itemIndex };
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", `${menuIndex}:${itemIndex}`);
            }
            requestAnimationFrame(() => {
              row.classList.add("is-dragging");
            });
          });

          row.addEventListener("dragover", (e) => {
            if (!draggingItem || draggingItem.menuIndex !== menuIndex) return;
            e.preventDefault();
            if (e.dataTransfer) {
              e.dataTransfer.dropEffect = "move";
            }
            const rect = row.getBoundingClientRect();
            const isAfter = e.clientY > rect.top + rect.height / 2;
            row.classList.toggle("drag-over-top", !isAfter);
            row.classList.toggle("drag-over-bottom", isAfter);
          });

          row.addEventListener("dragleave", () => {
            row.classList.remove("drag-over-top", "drag-over-bottom");
          });

          row.addEventListener("drop", (e) => {
            e.preventDefault();
            row.classList.remove("drag-over-top", "drag-over-bottom");
            if (!draggingItem || draggingItem.menuIndex !== menuIndex) return;
            const sourceIndex = draggingItem.itemIndex;
            const rect = row.getBoundingClientRect();
            const isAfter = e.clientY > rect.top + rect.height / 2;
            let targetIndex = isAfter ? itemIndex + 1 : itemIndex;
            if (sourceIndex < targetIndex) {
              targetIndex--;
            }
            if (sourceIndex !== targetIndex) {
              const [moved] = menu.items.splice(sourceIndex, 1);
              if (moved) menu.items.splice(targetIndex, 0, moved);
              renderMenus();
              markDirty();
            }
            draggingItem = null;
          });

          row.addEventListener("dragend", () => {
            row.draggable = false;
            row.classList.remove("is-dragging");
            draggingItem = null;
            items.querySelectorAll(".menu-item-row").forEach((el) => {
              el.classList.remove("drag-over-top", "drag-over-bottom", "is-dragging");
            });
          });

          // Settings button for item
          const settingsBtn = document.createElement("button");
          settingsBtn.type = "button";
          settingsBtn.className = "item-settings-btn";
          settingsBtn.title = t("item.settingsTitle");
          settingsBtn.innerHTML = SETTINGS_ICON_SVG;
          settingsBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openItemSettingsPopover(menuIndex, itemIndex, settingsBtn);
          });

          // Color swatch button
          const swatch = document.createElement("button");
          swatch.type = "button";
          if (isFlatten) {
            swatch.className = "item-color-swatch";
            const colors = item.cycleColors;
            if (colors && colors.length > 0) {
              if (colors.length === 1) {
                const onlyColor = colors[0] ?? "";
                swatch.style.background = "";
                swatch.style.backgroundColor = onlyColor;
                swatch.style.borderColor = onlyColor;
              } else {
                swatch.style.background = `linear-gradient(135deg, ${colors.join(", ")})`;
                swatch.style.borderColor = "transparent";
              }
              swatch.classList.remove("has-no-color");
              swatch.title = t("item.cycleColorsTitle", { count: colors.length });
            } else {
              swatch.style.background = "";
              swatch.style.backgroundColor = "transparent";
              swatch.style.borderColor = "#cbd5e1";
              swatch.classList.add("has-no-color");
              swatch.title = t("item.cycleColorsEmpty");
            }
          } else {
            swatch.className = `item-color-swatch ${!item.color ? "has-no-color" : ""}`;
            updateSwatchAppearance(swatch, item.color);
            if (!item.color && menu.color) {
              swatch.title = t("item.followMenuColor", { color: menu.color });
            }
          }
          swatch.addEventListener("click", (e) => {
            e.stopPropagation();
            openColorPopover(item, swatch);
          });

          // Centered minus button for remove item
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "remove-item-btn";
          removeBtn.title = t("menu.removeItem");
          removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg>`;
          removeBtn.addEventListener("click", () => {
            if (activeColorTarget === item) {
              closeColorPopover();
            }
            if (
              activeItemSettings &&
              activeItemSettings.menuIndex === menuIndex &&
              activeItemSettings.itemIndex === itemIndex
            ) {
              closeItemSettingsPopover();
            }
            menu.items.splice(itemIndex, 1);
            renderMenus();
            markDirty();
          });

          controls.append(dragHandleBtn, settingsBtn, swatch, removeBtn);
          row.append(label, controls);
          if (pathResolution.duplicatePath) {
            const warning = document.createElement("div");
            warning.className = "item-path-warning";
            warning.textContent = t("item.duplicatePathWarning");
            row.appendChild(warning);
          }
          return row;
        }),
      );

      card.append(header, items);
      return card;
    }),
  );
}

function renderUrlRules(): void {
  urlRulesList.replaceChildren();

  if (urlRules.length === 0) {
    const emptyHint = document.createElement("div");
    emptyHint.className = "url-rule-empty-hint";
    emptyHint.textContent = t("urlRules.empty");
    urlRulesList.appendChild(emptyHint);
    return;
  }

  urlRules.forEach((ws, setIndex) => {
    const card = document.createElement("div");
    card.className = "url-rule-card";

    const header = document.createElement("div");
    header.className = "url-rule-header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "url-rule-title-group";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "url-rule-name-input";
    nameInput.placeholder = t("urlRules.namePlaceholder");
    nameInput.value = ws.name;
    nameInput.addEventListener("input", () => {
      ws.name = nameInput.value;
      renderMenus();
      markDirty();
    });

    const countPill = document.createElement("span");
    countPill.className = "url-rule-count-pill";
    countPill.textContent = t("urlRules.patternCount", { count: ws.patterns.length });

    titleGroup.append(nameInput, countPill);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "remove-item-btn menu-remove-btn";
    deleteBtn.title = t("common.delete");
    deleteBtn.setAttribute("aria-label", t("common.delete"));
    deleteBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg><span>${t("common.delete")}</span>`;
    deleteBtn.addEventListener("click", () => {
      const removedUid = ws.uid;
      urlRules.splice(setIndex, 1);
      // Clean up references in menus
      menus.forEach((menu) => {
        if (menu.urlRuleUids) {
          menu.urlRuleUids = menu.urlRuleUids.filter((uid) => uid !== removedUid);
          if (menu.urlRuleUids.length === 0) {
            delete menu.urlRuleUids;
          }
        }
      });
      renderUrlRules();
      renderMenus();
      markDirty();
    });

    header.append(titleGroup, deleteBtn);

    const patternsTextarea = document.createElement("textarea");
    patternsTextarea.className = "url-rule-patterns-input";
    patternsTextarea.rows = 3;
    patternsTextarea.placeholder = t("urlRules.patternsPlaceholder");
    patternsTextarea.value = ws.patterns.join("\n");
    patternsTextarea.addEventListener("input", () => {
      ws.patterns = patternsTextarea.value
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean);
      countPill.textContent = t("urlRules.patternCount", { count: ws.patterns.length });
      markDirty();
    });

    card.append(header, patternsTextarea);
    urlRulesList.appendChild(card);
  });
}

addUrlRuleBtn.addEventListener("click", () => {
  const newSet: UrlRule = {
    uid: crypto.randomUUID(),
    name: t("urlRules.newSetName", { n: urlRules.length + 1 }),
    patterns: [],
  };
  urlRules.push(newSet);
  renderUrlRules();
  renderMenus();
  markDirty();
  const nameInputs = urlRulesList.querySelectorAll<HTMLInputElement>(".url-rule-name-input");
  const lastInput = nameInputs[nameInputs.length - 1];
  if (lastInput) {
    lastInput.focus();
    lastInput.select();
  }
});

function updateDesktopControls(): void {
  toggleEnabledButton.textContent = widgetEnabled ? t("btn.disable") : t("btn.enable");
  toggleEnabledButton.dataset.action = widgetEnabled ? "disable" : "enable";
}

async function testDesktopAddress(): Promise<void> {
  const generation = ++desktopTestGeneration;
  const url = desktopUrl.value;
  setDesktopTestStatus(t("test.connecting"), "pending");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (generation !== desktopTestGeneration) {
    return;
  }
  try {
    await probeDesktopConnection(url);
    if (generation === desktopTestGeneration && desktopUrl.value === url) {
      setDesktopTestStatus(t("test.connected"), "success");
    }
  } catch (error) {
    if (generation === desktopTestGeneration && desktopUrl.value === url) {
      setDesktopTestStatus(
        error instanceof Error ? error.message : t("test.connectionFailed"),
        "error",
      );
    }
  }
}

function clearDesktopTestStatus(): void {
  desktopTestGeneration += 1;
  desktopTestStatus.textContent = "";
  delete desktopTestStatus.dataset.state;
}

function setDesktopTestStatus(
  message: string,
  state: "pending" | "success" | "error",
): void {
  desktopTestStatus.textContent = message;
  desktopTestStatus.dataset.state = state;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) {
    throw new Error(`Missing #${id}`);
  }
  return value as T;
}

function exportSettings(): void {
  if (isMenusDirty) {
    const msg = t("export.saveFirst");
    status.value = msg;
    setTimeout(() => {
      if (status.value === msg) {
        status.value = "";
      }
    }, 3_000);
    return;
  }

  for (const menu of menus) {
    enrichMenuItems(menu.items, rawBookmarkTree);
  }

  // Export only the menus, in a portable shape: each item keeps its own uid,
  // bookmark path, URL, type, and user settings. Instance label, desktop address,
  // and language remain per-install.
  const exportData: ExportedSettingsData = {
    version: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    ...(urlRules.length > 0 ? { urlRules: structuredClone(urlRules) } : {}),
    ...(dynamicBookmarks.length > 0 ? { dynamicBookmarks: structuredClone(dynamicBookmarks) } : {}),
    ...(shortcuts.length > 0 ? { shortcuts: structuredClone(shortcuts) } : {}),
    ...(nativeShortcuts.length > 0 ? { nativeShortcuts: structuredClone(nativeShortcuts) } : {}),
    menus: menus.map((menu) => ({
      uid: menu.uid,
      orientation: menu.orientation,
      ...(menu.urlRuleUids && menu.urlRuleUids.length > 0 ? { urlRuleUids: menu.urlRuleUids } : {}),
      ...(menu.enabled !== undefined ? { enabled: menu.enabled } : {}),
      ...(menu.buttonFontSize !== undefined ? { buttonFontSize: menu.buttonFontSize } : {}),
      ...(menu.popupFontSize !== undefined ? { popupFontSize: menu.popupFontSize } : {}),
      ...(menu.gap !== undefined ? { gap: menu.gap } : {}),
      ...(menu.color ? { color: menu.color } : {}),
      ...(menu.expandDirection ? { expandDirection: menu.expandDirection } : {}),
      ...(menu.attachmentMode ? { attachmentMode: menu.attachmentMode } : {}),
      ...(menu.onTopMode ? { onTopMode: menu.onTopMode } : {}),
      ...(menu.tabMode ? { tabMode: menu.tabMode } : {}),
      items: menu.items.map((item) => {
        if (item.type === "menuToggle") {
          return {
            uid: item.uid,
            type: "menuToggle",
            ...(item.rename ? { rename: item.rename } : {}),
          } satisfies ExportedMenuItem;
        }

        if (item.type === "dynamic") {
          return {
            uid: item.uid,
            type: "dynamic",
            ...(item.dynamicUid ? { dynamicUid: item.dynamicUid } : {}),
            ...(item.rename ? { rename: item.rename } : {}),
            ...(item.color ? { color: item.color } : {}),
            ...(item.tabMode ? { tabMode: item.tabMode } : {}),
            ...(item.showPageTitle ? { showPageTitle: true } : {}),
          } satisfies ExportedMenuItem;
        }

        const path = item.path;
        const isFolder = item.type === "folder" || item.type === "flattenFolder";
        const itemType: string = item.type ?? (isFolder ? "folder" : "bookmark");

        const exportedItem: ExportedMenuItem = {
          uid: item.uid,
          type: itemType,
          ...(path !== undefined ? { path } : {}),
          ...(item.url ? { url: item.url } : {}),
          ...(typeof item.units === "number" ? { units: item.units } : {}),
          ...(item.transparent !== undefined ? { transparent: item.transparent } : {}),
          ...(item.rename ? { rename: item.rename } : {}),
          ...(itemType === "flattenFolder"
            ? (item.cycleColors && item.cycleColors.length > 0 ? { cycleColors: item.cycleColors } : {})
            : (item.color ? { color: item.color } : {})),
          ...(item.expandOnHover !== undefined ? { expandOnHover: item.expandOnHover } : {}),
          ...(item.includeFolders ? { includeFolders: true } : {}),
          ...(item.tabMode ? { tabMode: item.tabMode } : {}),
        };
        return exportedItem;
      }),
    })),
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  a.href = downloadUrl;
  a.download = `browserail-menus-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);

  const exportedMsg = t("export.exported");
  status.value = exportedMsg;
  setTimeout(() => {
    if (status.value === exportedMsg) {
      status.value = "";
    }
  }, 2_500);
}

async function importSettings(file: File): Promise<void> {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    if (!isExportedSettingsData(parsed)) {
      status.value = t("import.invalidJson");
      return;
    }

    const menusSource = parsed.menus;

    // Rebuild each item from its portable fields.
    const importedMenus: StoredMenu[] = [];
    for (const rawMenu of menusSource) {
      if (typeof rawMenu !== "object" || rawMenu === null) continue;
      const menuRecord = rawMenu as unknown as Record<string, unknown>;
      const rawItems = Array.isArray(menuRecord.items) ? menuRecord.items : [];

      const items: StoredMenuItem[] = [];
      let hasMenuToggle = false;
      for (const rawItem of rawItems) {
        if (typeof rawItem !== "object" || rawItem === null) continue;
        const itemRecord = rawItem as Record<string, unknown>;

        const path = Array.isArray(itemRecord.path)
          ? itemRecord.path.filter((p): p is string => typeof p === "string")
          : undefined;
        const type: StoredMenuItemType = typeof itemRecord.type === "string" && itemRecord.type
          ? itemRecord.type
          : "bookmark";
        const uid = typeof itemRecord.uid === "string" && itemRecord.uid
          ? itemRecord.uid
          : crypto.randomUUID();

        const rename = typeof itemRecord.rename === "string" && itemRecord.rename
          ? itemRecord.rename
          : undefined;

        const expandDirection =
          itemRecord.expandDirection === "down" ||
          itemRecord.expandDirection === "up" ||
          itemRecord.expandDirection === "right" ||
          itemRecord.expandDirection === "left"
            ? (itemRecord.expandDirection as ExpandDirection)
            : undefined;

        const cycleColors = Array.isArray(itemRecord.cycleColors)
          ? itemRecord.cycleColors.filter((c): c is string => typeof c === "string" && Boolean(c))
          : undefined;

        if (type === "menuToggle") {
          if (hasMenuToggle) continue;
          hasMenuToggle = true;
          items.push({
            uid,
            type: "menuToggle",
            ...(rename ? { rename } : {}),
          });
          continue;
        }

        items.push({
          uid,
          type,
          ...(path !== undefined ? { path } : {}),
          ...(typeof itemRecord.url === "string" && itemRecord.url
            ? { url: itemRecord.url }
            : {}),
          ...(typeof itemRecord.units === "number" ? { units: itemRecord.units } : {}),
          ...(typeof itemRecord.transparent === "boolean" ? { transparent: itemRecord.transparent } : {}),
          ...(rename ? { rename } : {}),
          ...(type === "flattenFolder"
            ? (cycleColors && cycleColors.length > 0 ? { cycleColors } : {})
            : (typeof itemRecord.color === "string" && itemRecord.color ? { color: itemRecord.color } : {})),
          ...(expandDirection ? { expandDirection } : {}),
          ...(typeof itemRecord.expandOnHover === "boolean"
            ? { expandOnHover: itemRecord.expandOnHover }
            : {}),
          ...(itemRecord.includeFolders === true ? { includeFolders: true } : {}),
          ...(itemRecord.tabMode === "newTab" || itemRecord.tabMode === "replace"
            ? { tabMode: itemRecord.tabMode }
            : {}),
          ...(type === "dynamic" && typeof itemRecord.dynamicUid === "string" && itemRecord.dynamicUid
            ? { dynamicUid: itemRecord.dynamicUid }
            : {}),
          ...(type === "dynamic" && itemRecord.showPageTitle === true
            ? { showPageTitle: true }
            : {}),
        });
      }

      const normalizedMenu = normalizeMenu({
        ...menuRecord,
        uid: typeof menuRecord.uid === "string" && menuRecord.uid ? menuRecord.uid : crypto.randomUUID(),
        items,
      });
      if (normalizedMenu) importedMenus.push(normalizedMenu);
    }

    // Only the menus, URL rules, and shortcuts are imported; instance label, desktop address, attachment
    // mode, always-on-top, and language keep their current values.
    menus = importedMenus;
    if (Array.isArray(parsed.urlRules)) {
      urlRules = parsed.urlRules
        .filter(
          (ws): ws is UrlRule =>
            typeof ws === "object" &&
            ws !== null &&
            typeof (ws as UrlRule).uid === "string" &&
            typeof (ws as UrlRule).name === "string",
        )
        .map((ws) => ({
          uid: ws.uid,
          name: ws.name,
          patterns: Array.isArray(ws.patterns)
            ? ws.patterns.filter((p): p is string => typeof p === "string")
            : [],
        }));
      renderUrlRules();
    }
    if (Array.isArray(parsed.dynamicBookmarks)) {
      dynamicBookmarks = parsed.dynamicBookmarks.flatMap((db): DynamicBookmark[] => {
        if (typeof db !== "object" || db === null) return [];
        const record = db as unknown as Record<string, unknown>;
        if (typeof record.uid !== "string" || !record.uid) return [];
        const urlRuleUids = Array.isArray(record.urlRuleUids)
          ? record.urlRuleUids.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
          : undefined;
        return [
          {
            uid: record.uid,
            name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : "Dynamic bookmark",
            code: typeof record.code === "string" ? record.code : "",
            ...(urlRuleUids && urlRuleUids.length > 0 ? { urlRuleUids } : {}),
          },
        ];
      });
      renderDynamicList();
    }
    if (Array.isArray(parsed.shortcuts)) {
      shortcuts = parsed.shortcuts.flatMap((sc): StoredShortcut[] => {
        if (typeof sc !== "object" || sc === null) return [];
        const record = sc as unknown as Record<string, unknown>;
        if (typeof record.slot !== "string") return [];
        return [
          {
            slot: record.slot,
            type: record.type === "dynamic" ? "dynamic" : "bookmark",
            ...(Array.isArray(record.path) ? { path: record.path.filter((p): p is string => typeof p === "string") } : {}),
            ...(typeof record.url === "string" ? { url: record.url } : {}),
            ...(typeof record.title === "string" ? { title: record.title } : {}),
            ...(typeof record.dynamicUid === "string" ? { dynamicUid: record.dynamicUid } : {}),
            ...(record.tabMode === "newTab" || record.tabMode === "replace" ? { tabMode: record.tabMode } : {}),
          },
        ];
      });
      renderShortcuts();
    }
    if (Array.isArray(parsed.nativeShortcuts)) {
      nativeShortcuts = parsed.nativeShortcuts.flatMap((sc): StoredNativeShortcut[] => {
        if (typeof sc !== "object" || sc === null) return [];
        const record = sc as unknown as Record<string, unknown>;
        if (typeof record.id !== "string" || !record.id) return [];
        return [
          {
            id: record.id,
            key: typeof record.key === "string" ? record.key : "",
            type: record.type === "dynamic" ? "dynamic" : "bookmark",
            ...(Array.isArray(record.path) ? { path: record.path.filter((p): p is string => typeof p === "string") } : {}),
            ...(typeof record.url === "string" ? { url: record.url } : {}),
            ...(typeof record.title === "string" ? { title: record.title } : {}),
            ...(typeof record.dynamicUid === "string" ? { dynamicUid: record.dynamicUid } : {}),
            ...(record.tabMode === "newTab" || record.tabMode === "replace" ? { tabMode: record.tabMode } : {}),
          },
        ];
      });
      renderNativeShortcuts();
    }
    renderMenus();
    markDirty();

    const importedMsg = t("import.savedOk");
    status.value = importedMsg;
    setTimeout(() => {
      if (status.value === importedMsg) {
        status.value = "";
      }
    }, 3_000);
  } catch (err) {
    status.value = t("import.failed", { error: String(err) });
  }
}

exportBtn.addEventListener("click", () => {
  exportSettings();
});

importBtn.addEventListener("click", () => {
  if (
    isMenusDirty &&
    !window.confirm(t("import.confirmOverwrite"))
  ) {
    return;
  }
  importFileInput.value = "";
  importFileInput.click();
});

importFileInput.addEventListener("change", () => {
  const file = importFileInput.files?.[0];
  if (file) {
    void importSettings(file);
  }
});

// Chrome Sync Toggle
if (syncEnabledToggle) {
  void loadSyncEnabled().then((enabled) => {
    syncEnabledToggle.checked = enabled;
  });

  syncEnabledToggle.addEventListener("change", () => {
    markConnectionDirty();
  });
}

// Debug & Diagnostics Card
const debugLoggingToggle = document.getElementById("debug-logging-toggle") as HTMLInputElement | null;
const copyDebugBtn = document.getElementById("copy-debug-btn") as HTMLButtonElement | null;
const copyDebugStatus = document.getElementById("copy-debug-status") as HTMLSpanElement | null;

void browser.storage.local.get("debugLoggingEnabled").then((res) => {
  const enabled = Boolean(res.debugLoggingEnabled);
  if (debugLoggingToggle) {
    debugLoggingToggle.checked = enabled;
  }
  if (copyDebugBtn) {
    copyDebugBtn.disabled = !enabled;
  }
}).catch(() => {});

debugLoggingToggle?.addEventListener("change", async () => {
  const enabled = Boolean(debugLoggingToggle.checked);
  if (copyDebugBtn) {
    copyDebugBtn.disabled = !enabled;
  }
  try {
    await browser.storage.local.set({ debugLoggingEnabled: enabled });
    await browser.runtime.sendMessage({ type: "setDebugLogging", enabled }).catch(() => {});
    if (copyDebugStatus) {
      const msg = enabled ? t("diagnostics.loggingEnabled") : t("diagnostics.loggingDisabled");
      copyDebugStatus.textContent = msg;
      setTimeout(() => {
        if (copyDebugStatus.textContent === msg) {
          copyDebugStatus.textContent = "";
        }
      }, 2500);
    }
  } catch (err) {
    if (copyDebugStatus) {
      copyDebugStatus.textContent = t("diagnostics.setFailed", { error: String(err) });
    }
  }
});

copyDebugBtn?.addEventListener("click", async () => {
  if (!debugLoggingToggle?.checked) {
    if (copyDebugStatus) {
      copyDebugStatus.textContent = t("diagnostics.notEnabled");
    }
    return;
  }

  if (copyDebugBtn) copyDebugBtn.disabled = true;
  if (copyDebugStatus) copyDebugStatus.textContent = t("diagnostics.collecting");

  try {
    const extInfo = await browser.runtime
      .sendMessage({ type: "getDebugInfo" })
      .catch((err) => ({ error: String(err) }));

    let desktopInfo: unknown = null;
    try {
      const res = await fetch("http://127.0.0.1:17654/debug");
      if (res.ok) {
        desktopInfo = await res.json();
      } else {
        desktopInfo = { status: res.status, statusText: res.statusText };
      }
    } catch (fetchErr) {
      desktopInfo = {
        error: `Failed to fetch http://127.0.0.1:17654/debug: ${String(fetchErr)}`,
      };
    }

    const combined = {
      timestamp: new Date().toISOString(),
      extension: extInfo,
      desktop: desktopInfo,
    };

    const text = JSON.stringify(combined, null, 2);
    let copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        // fallback to textarea
      }
    }
    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      copied = document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    if (copyDebugStatus) {
      const msg = copied ? t("diagnostics.copied") : t("diagnostics.copyFailed");
      copyDebugStatus.textContent = msg;
      setTimeout(() => {
        if (copyDebugStatus.textContent === msg) {
          copyDebugStatus.textContent = "";
        }
      }, 3000);
    }
  } catch (err) {
    if (copyDebugStatus) {
      copyDebugStatus.textContent = t("diagnostics.fetchFailed", { error: String(err) });
    }
  } finally {
    if (copyDebugBtn) copyDebugBtn.disabled = !debugLoggingToggle?.checked;
  }
});
