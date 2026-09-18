import type { AttachmentMode, MenuFontSize, MenuOrientation } from "@browserail/protocol";
import browser from "webextension-polyfill";

import {
  createMenu,
  DEFAULT_FONT_SIZE,
  DEFAULT_MENU_GAP,
  DEFAULT_MENU_GAP_PERCENT,
  type ExtensionConfig,
  getItemDimensions,
  loadConfig,
  loadWidgetEnabled,
  normalizeConfig,
  normalizeFontSize,
  saveConfig,
  saveWidgetEnabled,
  type StoredMenu,
  type StoredMenuItem,
} from "../config";
import { type BookmarkNode, extractLeadingEmoji, findBookmarkNodeByPath } from "../bookmarks";
import { isLocalDesktopUrl, probeDesktopConnection } from "../desktop-connection";
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

import "./styles.css";

const PALETTE_COLORS = [
  "#2563eb", // Blue
  "#0284c7", // Sky
  "#0891b2", // Cyan
  "#059669", // Emerald
  "#16a34a", // Green
  "#65a30d", // Lime
  "#ca8a04", // Gold
  "#d97706", // Amber
  "#ea580c", // Orange
  "#dc2626", // Red
  "#db2777", // Pink
  "#c026d3", // Fuchsia
  "#7c3aed", // Purple
  "#4f46e5", // Indigo
  "#475569", // Slate
  "#334155", // Charcoal
  "#0d9488", // Teal
  "#9a3412", // Rust
  "#9d174d", // Wine
  "#1e293b", // Navy
];

function getRandomPaletteColor(): string {
  return PALETTE_COLORS[Math.floor(Math.random() * PALETTE_COLORS.length)];
}

interface BookmarkOption {
  id: string;
  label: string;
}

const form = element<HTMLFormElement>("settings");
const instanceLabel = element<HTMLInputElement>("instance-label");
const randomInstanceLabel = element<HTMLButtonElement>("random-instance-label");
const toggleEnabledButton = element<HTMLButtonElement>("toggle-enabled-button");
const desktopUrl = element<HTMLInputElement>("desktop-url");
const stateCard = element<HTMLDivElement>("state-card");
const stateBadge = element<HTMLSpanElement>("state-badge");
const stateDetail = element<HTMLDivElement>("state-detail");
const testDesktop = element<HTMLButtonElement>("test-desktop");
const desktopTestStatus = element<HTMLOutputElement>("desktop-test-status");
const attachmentMode = element<HTMLSelectElement>("attachment-mode");
const alwaysOnTop = element<HTMLInputElement>("always-on-top");
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
const pickerCloseBtn = element<HTMLButtonElement>("picker-close-btn");
const pickerUpBtn = element<HTMLButtonElement>("picker-up-btn");
const pickerBreadcrumbs = element<HTMLDivElement>("picker-breadcrumbs");
const pickerContent = element<HTMLDivElement>("picker-content");
const pickerSelectedInfo = element<HTMLDivElement>("picker-selected-info");
const pickerCustomBtn = element<HTMLButtonElement>("picker-custom-btn");
const pickerConfirmBtn = element<HTMLButtonElement>("picker-confirm-btn");

// Color popover elements
const colorPopover = element<HTMLDivElement>("color-popover");
const colorPopoverClose = element<HTMLButtonElement>("color-popover-close");
const popoverColorInput = element<HTMLInputElement>("popover-color-input");
const colorPopoverPresets = element<HTMLDivElement>("color-popover-presets");
const popoverRandomBtn = element<HTMLButtonElement>("popover-random-btn");
const popoverDefaultBtn = element<HTMLButtonElement>("popover-default-btn");

// Menu settings popover elements
const menuSettingsPopover = element<HTMLDivElement>("menu-settings-popover");
const menuSettingsTitle = element<HTMLSpanElement>("menu-settings-title");
const menuSettingsClose = element<HTMLButtonElement>("menu-settings-close");
const menuSettingOrientation = element<HTMLSelectElement>("menu-setting-orientation");
const menuSettingFontSize = element<HTMLInputElement>("menu-setting-font-size");
const menuSettingGap = element<HTMLInputElement>("menu-setting-gap");
const menuSettingTabMode = element<HTMLSelectElement>("menu-setting-tab-mode");
const menuSettingColorSwatch = element<HTMLButtonElement>("menu-setting-color-swatch");

// Item settings popover elements
const itemSettingsPopover = element<HTMLDivElement>("item-settings-popover");
const itemSettingsTitle = element<HTMLSpanElement>("item-settings-title");
const itemSettingsClose = element<HTMLButtonElement>("item-settings-close");
const itemSettingsFolderControls = element<HTMLDivElement>("item-settings-folder-controls");
const itemSettingRename = element<HTMLInputElement>("item-setting-rename");
const itemSettingClearRename = element<HTMLButtonElement>("item-setting-clear-rename");
const itemSettingTabMode = element<HTMLSelectElement>("item-setting-tab-mode");
const itemSettingFlatten = element<HTMLInputElement>("item-setting-flatten");
const itemSettingHoverExpandLabel = element<HTMLLabelElement>("item-setting-hover-expand-label");
const itemSettingHoverExpand = element<HTMLInputElement>("item-setting-hover-expand");
const itemSettingChangeBtn = element<HTMLButtonElement>("item-setting-change-btn");

let widgetEnabled = true;
let isDirty = false;
let menus: StoredMenu[] = [];
let rawBookmarkTree: browser.Bookmarks.BookmarkTreeNode[] = [];
let bookmarkOptions: BookmarkOption[] = [];
let bookmarkLabels = new Map<string, string>();
let desktopTestGeneration = 0;

// Popover state
let activeColorTarget: StoredMenu | StoredMenuItem | null = null;
let activeColorSwatchElement: HTMLElement | null = null;

let activeSettingsMenuIndex = -1;
let activeSettingsBtn: HTMLElement | null = null;

let activeItemSettings: { menuIndex: number; itemIndex: number } | null = null;
let activeItemSettingsBtn: HTMLElement | null = null;

// Picker state
let pickerCurrentFolderId = "0";
let pickerSelectedId: string | null = null;
let pickerMode: "addMenu" | "addItem" | "editItem" = "addMenu";
let pickerTargetMenuIndex = -1;
let pickerTargetItemIndex = -1;

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
    const detail =
      "detail" in message && typeof message.detail === "string" ? message.detail : undefined;
    renderDesktopState(message.state, detail);
  }
});

function markDirty(): void {
  if (!isDirty) {
    isDirty = true;
    saveBtn.classList.add("is-dirty");
  }
}

function clearDirty(): void {
  isDirty = false;
  saveBtn.classList.remove("is-dirty");
}

window.addEventListener("beforeunload", (event) => {
  if (isDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

window.addEventListener("pagehide", () => {
  if (isDirty) {
    void browser.runtime.sendMessage({ type: "cancelPreview" });
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void persist();
});

previewBtn.addEventListener("click", () => {
  void previewCurrentConfig();
});

instanceLabel.addEventListener("input", markDirty);
desktopUrl.addEventListener("input", () => {
  clearDesktopTestStatus();
  markDirty();
});
attachmentMode.addEventListener("change", markDirty);
alwaysOnTop.addEventListener("change", markDirty);

addMenu.addEventListener("click", () => {
  openBookmarkPicker("addMenu");
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
  markDirty();
});

testDesktop.addEventListener("click", () => void testDesktopAddress());

reconnectButton.addEventListener("click", () => {
  void manualReconnect();
});
resyncButton.addEventListener("click", () => void resyncDesktopWindows());

pickerCloseBtn.addEventListener("click", () => pickerDialog.close());

pickerFlattenCheckbox.addEventListener("change", () => {
  if (pickerFlattenCheckbox.checked) {
    pickerHoverExpandCheckbox.checked = false;
    pickerHoverExpandCheckbox.disabled = true;
  } else {
    pickerHoverExpandCheckbox.disabled = false;
    pickerHoverExpandCheckbox.checked = true;
  }
  updateSelectedInfo();
});

pickerHoverExpandCheckbox.addEventListener("change", () => {
  if (pickerHoverExpandCheckbox.checked) {
    pickerFlattenCheckbox.checked = false;
  }
  updateSelectedInfo();
});

pickerUpBtn.addEventListener("click", () => {
  const currentPath = getFolderPath(pickerCurrentFolderId, rawBookmarkTree);
  if (currentPath.length > 1) {
    const parent = currentPath[currentPath.length - 2];
    pickerCurrentFolderId = parent.id;
    pickerSelectedId = null;
    renderPicker();
  }
});

pickerCustomBtn.addEventListener("click", () => {
  if (pickerMode === "addMenu") {
    menus.push(createMenu());
    renderMenus();
    markDirty();
    pickerDialog.close();
  }
});

pickerConfirmBtn.addEventListener("click", () => {
  if (!pickerSelectedId) return;

  const selectedNode = findBookmarkNode(pickerSelectedId, rawBookmarkTree);
  const isFolder = selectedNode?.children !== undefined || selectedNode?.url === undefined;
  const isFlatten = isFolder && pickerFlattenCheckbox.checked;
  const itemType = isFlatten ? "flattenFolder" : isFolder ? "folder" : "bookmark";
  const expandOnHover = isFolder && !isFlatten ? pickerHoverExpandCheckbox.checked : undefined;
  const { path, url } = getItemPathAndUrl(pickerSelectedId, rawBookmarkTree);

  const newItem: StoredMenuItem = {
    bookmarkId: pickerSelectedId,
    type: itemType,
    ...(expandOnHover !== undefined ? { expandOnHover } : {}),
    ...(path ? { path } : {}),
    ...(url ? { url } : {}),
  };

  if (pickerMode === "addMenu") {
    const newMenu = createMenu();
    newMenu.items.push(newItem);
    menus.push(newMenu);
    renderMenus();
    markDirty();
    pickerDialog.close();
  } else if (pickerMode === "addItem") {
    const menu = menus[pickerTargetMenuIndex];
    if (menu) {
      menu.items.push(newItem);
      renderMenus();
      markDirty();
    }
    pickerDialog.close();
  } else if (pickerMode === "editItem") {
    const menu = menus[pickerTargetMenuIndex];
    if (menu && menu.items[pickerTargetItemIndex]) {
      const existing = menu.items[pickerTargetItemIndex];
      existing.bookmarkId = newItem.bookmarkId;
      existing.type = newItem.type;
      existing.expandOnHover = newItem.expandOnHover;
      existing.path = newItem.path;
      existing.url = newItem.url;
      renderMenus();
      markDirty();
    }
    pickerDialog.close();
  }
});

function openBookmarkPicker(
  mode: "addMenu" | "addItem" | "editItem",
  menuIndex = -1,
  itemIndex = -1,
): void {
  pickerMode = mode;
  pickerTargetMenuIndex = menuIndex;
  pickerTargetItemIndex = itemIndex;
  pickerCurrentFolderId = "0";

  let initialFlatten = false;
  let initialHover = true;

  if (mode === "editItem") {
    const existing = menus[menuIndex]?.items[itemIndex];
    if (existing) {
      pickerSelectedId = existing.bookmarkId;
      initialFlatten = existing.type === "flattenFolder";
      initialHover = existing.expandOnHover !== false;
      const path = getFolderPath(existing.bookmarkId, rawBookmarkTree);
      if (path.length > 1) {
        pickerCurrentFolderId = path[path.length - 2].id;
      }
    } else {
      pickerSelectedId = null;
    }
  } else {
    pickerSelectedId = null;
  }

  pickerFlattenCheckbox.checked = initialFlatten;
  pickerHoverExpandCheckbox.checked = !initialFlatten && initialHover;
  pickerHoverExpandCheckbox.disabled = initialFlatten;
  pickerFlattenLabel.style.display = "none";
  pickerHoverExpandLabel.style.display = "none";

  if (mode === "addMenu") {
    pickerTitle.textContent = t("picker.addMenuTitle");
    pickerConfirmBtn.textContent = t("picker.addAsMenu");
    pickerCustomBtn.textContent = t("picker.createEmptyMenu");
    pickerCustomBtn.style.display = "inline-block";
  } else if (mode === "editItem") {
    pickerTitle.textContent = t("picker.changeTitle");
    pickerConfirmBtn.textContent = t("picker.apply");
    pickerCustomBtn.style.display = "none";
  } else {
    pickerTitle.textContent = t("picker.addItemTitle", { n: menuIndex + 1 });
    pickerConfirmBtn.textContent = t("picker.addToMenu");
    pickerCustomBtn.style.display = "none";
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

function getFolderPath(
  id: string,
  nodes: browser.Bookmarks.BookmarkTreeNode[],
): browser.Bookmarks.BookmarkTreeNode[] {
  function search(
    current: browser.Bookmarks.BookmarkTreeNode,
    targetId: string,
    path: browser.Bookmarks.BookmarkTreeNode[],
  ): browser.Bookmarks.BookmarkTreeNode[] | null {
    const newPath = [...path, current];
    if (current.id === targetId) return newPath;
    if (current.children) {
      for (const child of current.children) {
        const res = search(child, targetId, newPath);
        if (res) return res;
      }
    }
    return null;
  }

  for (const root of nodes) {
    const res = search(root, id, []);
    if (res) return res;
  }
  return [];
}

function getItemPathAndUrl(
  bookmarkId: string,
  nodes: browser.Bookmarks.BookmarkTreeNode[],
): { path?: string[]; url?: string } {
  const node = findBookmarkNode(bookmarkId, nodes);
  const pathNodes = getFolderPath(bookmarkId, nodes);
  const path = pathNodes
    .map((n) => n.title)
    .filter((t) => Boolean(t && t.trim()));
  return {
    path: path.length > 0 ? path : undefined,
    url: node?.url,
  };
}

function enrichMenuItemPaths(
  items: StoredMenuItem[],
  nodes: browser.Bookmarks.BookmarkTreeNode[],
): void {
  if (nodes.length === 0) return;
  for (const item of items) {
    if (item.bookmarkId) {
      const { path, url } = getItemPathAndUrl(item.bookmarkId, nodes);
      if (path && path.length > 0) {
        item.path = path;
      }
      if (url) {
        item.url = url;
      }
    }
  }
}

function renderPicker(): void {
  const currentFolder = findBookmarkNode(pickerCurrentFolderId, rawBookmarkTree);
  const currentPath = getFolderPath(pickerCurrentFolderId, rawBookmarkTree);

  // Update Up button
  pickerUpBtn.disabled = currentPath.length <= 1;

  // Render Breadcrumbs
  pickerBreadcrumbs.replaceChildren(
    ...currentPath.map((node, index) => {
      const isCurrent = index === currentPath.length - 1;
      const span = document.createElement("span");
      span.className = `picker-crumb ${isCurrent ? "current" : ""}`;
      span.textContent = node.title || (node.id === "0" ? t("common.bookmarks") : t("common.folder"));
      if (!isCurrent) {
        span.addEventListener("click", () => {
          pickerCurrentFolderId = node.id;
          pickerSelectedId = null;
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
  const items =
    currentFolder?.children ??
    (rawBookmarkTree.length > 0 ? rawBookmarkTree[0].children ?? rawBookmarkTree : []);
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
  if (pickerSelectedId) {
    const selectedNode = findBookmarkNode(pickerSelectedId, rawBookmarkTree);
    const isFolder = selectedNode?.children !== undefined || selectedNode?.url === undefined;
    if (isFolder) {
      pickerFlattenLabel.style.display = "inline-flex";
      pickerHoverExpandLabel.style.display = "inline-flex";
      const isFlatten = pickerFlattenCheckbox.checked;
      const isHover = pickerHoverExpandCheckbox.checked;
      const hoverHint = !isFlatten ? (isHover ? t("picker.hintHover") : t("picker.hintClick")) : "";
      pickerSelectedInfo.textContent = t("picker.selectedFolder", {
        flatten: isFlatten ? t("picker.flattenTag") : "",
        name: selectedNode?.title || t("common.folder"),
        hint: hoverHint,
      });
    } else {
      pickerFlattenLabel.style.display = "none";
      pickerHoverExpandLabel.style.display = "none";
      pickerFlattenCheckbox.checked = false;
      pickerHoverExpandCheckbox.checked = true;
      pickerHoverExpandCheckbox.disabled = false;
      pickerSelectedInfo.textContent = t("picker.selectedBookmark", {
        name: selectedNode?.title || t("common.bookmark"),
      });
    }
    pickerConfirmBtn.disabled = false;
  } else {
    pickerFlattenLabel.style.display = "none";
    pickerHoverExpandLabel.style.display = "none";
    pickerSelectedInfo.textContent = t("picker.selectHint");
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
      renderDesktopState(response.state, response.detail);
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
  applyStaticI18n();
  for (const opt of languageSelect.options) {
    opt.textContent = opt.value === "zh-CN" ? t("language.zhCN") : t("language.en");
  }
  languageSelect.value = getLanguage();
  renderMenus();
  updateDesktopControls();
  renderDesktopState(stateCard.dataset.state ?? "disconnected");
  if (pickerDialog.open) {
    updateSelectedInfo();
  }
}

async function initialize(): Promise<void> {
  applyStaticI18n();
  initLanguagePicker();
  onLanguageChange(rerenderForLanguage);
  initColorPopover();
  initMenuSettingsPopover();
  initItemSettingsPopover();
  void refreshDesktopState();
  const [config, enabled, tree] = await Promise.all([
    loadConfig(),
    loadWidgetEnabled(),
    browser.bookmarks.getTree(),
  ]);
  rawBookmarkTree = tree;
  bookmarkOptions = flattenBookmarks(tree);
  bookmarkLabels = new Map(bookmarkOptions.map((option) => [option.id, option.label]));

  instanceLabel.value = config.instanceLabel;
  widgetEnabled = enabled;
  desktopUrl.value = config.desktopWidget.url;
  attachmentMode.value = config.attachmentMode;
  alwaysOnTop.checked = config.panel.alwaysOnTop;
  menus = structuredClone(config.panel.menus);
  updateDesktopControls();
  renderMenus();
  clearDirty();
}

async function persist(): Promise<void> {
  if (!isLocalDesktopUrl(desktopUrl.value)) {
    desktopUrl.setCustomValidity(t("validation.localWsAddress"));
    desktopUrl.reportValidity();
    return;
  }
  desktopUrl.setCustomValidity("");

  for (const menu of menus) {
    enrichMenuItemPaths(menu.items, rawBookmarkTree);
  }

  await saveConfig({
    instanceLabel: instanceLabel.value,
    attachmentMode: attachmentMode.value as AttachmentMode,
    desktopWidget: {
      url: desktopUrl.value,
    },
    panel: {
      alwaysOnTop: alwaysOnTop.checked,
      menus,
    },
  });
  await browser.runtime.sendMessage({ type: "configSaved" });
  clearDirty();
  const savedMsg = t("status.saved");
  status.value = savedMsg;
  setTimeout(() => {
    if (status.value === savedMsg) {
      status.value = "";
    }
  }, 1_500);
}

async function previewCurrentConfig(): Promise<void> {
  const previewConfig: ExtensionConfig = {
    instanceLabel: instanceLabel.value,
    attachmentMode: attachmentMode.value as AttachmentMode,
    desktopWidget: {
      url: desktopUrl.value,
    },
    panel: {
      alwaysOnTop: alwaysOnTop.checked,
      menus,
    },
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

  popoverColorInput.addEventListener("input", () => {
    setColor(popoverColorInput.value);
  });

  popoverRandomBtn.addEventListener("click", () => {
    setColor(getRandomPaletteColor());
  });

  popoverDefaultBtn.addEventListener("click", () => {
    if (!activeColorTarget || !activeColorSwatchElement) return;
    delete activeColorTarget.color;
    popoverColorInput.value = "#3b82f6";
    updateSwatchAppearance(activeColorSwatchElement, undefined);
    markDirty();
  });

  document.addEventListener("click", (e) => {
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

function setColor(color: string): void {
  if (!activeColorTarget || !activeColorSwatchElement) return;
  activeColorTarget.color = color;
  popoverColorInput.value = color;
  updateSwatchAppearance(activeColorSwatchElement, color);
  markDirty();
}

function updateSwatchAppearance(swatch: HTMLElement, color?: string): void {
  if (color) {
    swatch.style.backgroundColor = color;
    swatch.style.borderColor = color;
    swatch.classList.remove("has-no-color");
    swatch.title = t("color.swatchSet", { color });
  } else {
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
  activeColorTarget = target;
  activeColorSwatchElement = swatchElement;

  const currentColor = target.color || "#3b82f6";
  popoverColorInput.value = currentColor;

  const rect = swatchElement.getBoundingClientRect();
  const popoverWidth = 200;
  let top = rect.bottom + window.scrollY + 6;
  let left = rect.left + window.scrollX - popoverWidth / 2 + rect.width / 2;

  if (left < 10) left = 10;
  if (left + popoverWidth > window.innerWidth - 10) {
    left = window.innerWidth - popoverWidth - 10;
  }

  colorPopover.style.position = "absolute";
  colorPopover.style.top = `${top}px`;
  colorPopover.style.left = `${left}px`;
  colorPopover.style.display = "flex";
}

function closeColorPopover(): void {
  colorPopover.style.display = "none";
  activeColorTarget = null;
  activeColorSwatchElement = null;
  if (activeSettingsMenuIndex < 0 && !activeItemSettings) {
    renderMenus();
  }
}

function initMenuSettingsPopover(): void {
  menuSettingsClose.addEventListener("click", () => closeMenuSettingsPopover());

  menuSettingOrientation.addEventListener("change", () => {
    const menu = menus[activeSettingsMenuIndex];
    if (menu) {
      menu.orientation = menuSettingOrientation.value as MenuOrientation;
      markDirty();
    }
  });

  menuSettingFontSize.addEventListener("input", () => {
    const menu = menus[activeSettingsMenuIndex];
    const val = parseInt(menuSettingFontSize.value, 10);
    if (menu && !isNaN(val)) {
      menu.fontSize = Math.max(8, Math.min(48, val));
      markDirty();
    }
  });

  menuSettingGap.addEventListener("input", () => {
    const menu = menus[activeSettingsMenuIndex];
    const val = parseInt(menuSettingGap.value, 10);
    if (menu && !isNaN(val)) {
      menu.gap = Math.max(0, Math.min(100, val));
      markDirty();
    }
  });

  menuSettingTabMode.addEventListener("change", () => {
    const menu = menus[activeSettingsMenuIndex];
    if (menu) {
      menu.tabMode = menuSettingTabMode.value === "newTab" ? "newTab" : "replace";
      renderMenus();
      markDirty();
    }
  });

  menuSettingColorSwatch.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = menus[activeSettingsMenuIndex];
    if (menu) {
      openColorPopover(menu, menuSettingColorSwatch);
    }
  });

  document.addEventListener("click", (e) => {
    if (menuSettingsPopover.style.display === "none") return;
    const target = e.target as Node | null;
    if (
      target &&
      !menuSettingsPopover.contains(target) &&
      !colorPopover.contains(target) &&
      activeSettingsBtn &&
      !activeSettingsBtn.contains(target)
    ) {
      closeMenuSettingsPopover();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuSettingsPopover.style.display !== "none") {
      closeMenuSettingsPopover();
    }
  });
}

function openMenuSettingsPopover(menuIndex: number, btnElement: HTMLElement): void {
  if (activeSettingsMenuIndex === menuIndex && menuSettingsPopover.style.display !== "none") {
    closeMenuSettingsPopover();
    return;
  }
  activeSettingsMenuIndex = menuIndex;
  activeSettingsBtn = btnElement;

  const menu = menus[menuIndex];
  if (!menu) return;

  const fs = menu.fontSize !== undefined ? normalizeFontSize(menu.fontSize) : DEFAULT_FONT_SIZE;
  const gapVal = menu.gap !== undefined ? menu.gap : DEFAULT_MENU_GAP_PERCENT;

  menuSettingsTitle.textContent = t("menuSettings.menuTitle", { n: menuIndex + 1 });
  menuSettingOrientation.value = menu.orientation;
  menuSettingFontSize.value = String(fs);
  menuSettingGap.value = String(gapVal);
  menuSettingTabMode.value = menu.tabMode ?? "replace";
  updateSwatchAppearance(menuSettingColorSwatch, menu.color);

  const rect = btnElement.getBoundingClientRect();
  const popoverWidth = 240;
  let top = rect.bottom + window.scrollY + 6;
  let left = rect.left + window.scrollX - popoverWidth / 2 + rect.width / 2;

  if (left < 10) left = 10;
  if (left + popoverWidth > window.innerWidth - 10) {
    left = window.innerWidth - popoverWidth - 10;
  }

  menuSettingsPopover.style.position = "absolute";
  menuSettingsPopover.style.top = `${top}px`;
  menuSettingsPopover.style.left = `${left}px`;
  menuSettingsPopover.style.display = "flex";
}

function closeMenuSettingsPopover(): void {
  menuSettingsPopover.style.display = "none";
  activeSettingsMenuIndex = -1;
  activeSettingsBtn = null;
  renderMenus();
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
      delete item.emoji;
    } else {
      delete item.rename;
      delete item.emoji;
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
    delete item.emoji;
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

    if (itemSettingFlatten.checked) {
      item.type = "flattenFolder";
      delete item.expandOnHover;
      itemSettingHoverExpand.checked = false;
      itemSettingHoverExpand.disabled = true;
    } else {
      item.type = "folder";
      item.expandOnHover = true;
      itemSettingHoverExpand.disabled = false;
      itemSettingHoverExpand.checked = true;
    }
    renderMenus();
    markDirty();
  });

  itemSettingHoverExpand.addEventListener("change", () => {
    if (!activeItemSettings) return;
    const menu = menus[activeItemSettings.menuIndex];
    const item = menu?.items[activeItemSettings.itemIndex];
    if (!item) return;

    if (itemSettingHoverExpand.checked) {
      item.type = "folder";
      item.expandOnHover = true;
      itemSettingFlatten.checked = false;
    } else {
      item.type = "folder";
      item.expandOnHover = false;
    }
    renderMenus();
    markDirty();
  });

  itemSettingChangeBtn.addEventListener("click", () => {
    if (!activeItemSettings) return;
    const { menuIndex, itemIndex } = activeItemSettings;
    closeItemSettingsPopover();
    openBookmarkPicker("editItem", menuIndex, itemIndex);
  });

  document.addEventListener("click", (e) => {
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

  const menu = menus[menuIndex];
  const item = menu?.items[itemIndex];
  if (!menu || !item) return;

  activeItemSettings = { menuIndex, itemIndex };
  activeItemSettingsBtn = anchorEl;

  const node = findBookmarkNode(item.bookmarkId, rawBookmarkTree);
  const isFolderNode = node?.children !== undefined || node?.url === undefined;
  const isFolder = item.type === "folder" || (!item.type && isFolderNode) || item.type === "flattenFolder";

  const rawLabel = bookmarkLabels.get(item.bookmarkId) ?? node?.title ?? item.bookmarkId;
  itemSettingsTitle.textContent = `${isFolder ? "📁" : "🔖"} ${rawLabel.trim()}`;
  itemSettingRename.value = item.rename ?? item.emoji ?? "";
  itemSettingTabMode.value = item.tabMode ?? "";

  if (isFolder) {
    itemSettingsFolderControls.style.display = "flex";
    const isFlatten = item.type === "flattenFolder";
    itemSettingFlatten.checked = isFlatten;
    if (isFlatten) {
      itemSettingHoverExpand.checked = false;
      itemSettingHoverExpand.disabled = true;
    } else {
      itemSettingHoverExpand.disabled = false;
      itemSettingHoverExpand.checked = item.expandOnHover !== false;
    }
  } else {
    itemSettingsFolderControls.style.display = "none";
  }

  const rect = anchorEl.getBoundingClientRect();
  const popoverWidth = 220;
  let top = rect.bottom + window.scrollY + 6;
  let left = rect.left + window.scrollX - popoverWidth / 2 + rect.width / 2;

  if (left < 10) left = 10;
  if (left + popoverWidth > window.innerWidth - 10) {
    left = window.innerWidth - popoverWidth - 10;
  }

  itemSettingsPopover.style.position = "absolute";
  itemSettingsPopover.style.top = `${top}px`;
  itemSettingsPopover.style.left = `${left}px`;
  itemSettingsPopover.style.display = "flex";
}

function closeItemSettingsPopover(): void {
  itemSettingsPopover.style.display = "none";
  activeItemSettings = null;
  activeItemSettingsBtn = null;
}

let draggingItem: { menuIndex: number; itemIndex: number } | null = null;

function renderMenus(): void {
  menusContainer.replaceChildren(
    ...menus.map((menu, menuIndex) => {
      const card = document.createElement("article");
      card.className = "menu-card";

      const header = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = t("menu.title", { n: menuIndex + 1 });

      const headerActions = document.createElement("div");
      headerActions.className = "menu-header-actions";

      const settingsBtn = document.createElement("button");
      settingsBtn.type = "button";
      settingsBtn.className = "action-btn menu-settings-btn";
      settingsBtn.textContent = t("menu.settings");
      settingsBtn.title = t("menu.settingsTitle");
      settingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openMenuSettingsPopover(menuIndex, settingsBtn);
      });

      // Menu default color swatch button
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

      const removeMenu = actionButton(t("menu.removeMenu"), () => {
        if (activeSettingsMenuIndex === menuIndex) {
          closeMenuSettingsPopover();
        }
        if (activeColorTarget === menu) {
          closeColorPopover();
        }
        menus.splice(menuIndex, 1);
        renderMenus();
        markDirty();
      });

      const addItem = actionButton(t("menu.addItem"), () => {
        openBookmarkPicker("addItem", menuIndex);
      });
      addItem.style.fontWeight = "600";
      addItem.style.color = "#2563eb";

      headerActions.append(settingsBtn, menuColorSwatch, removeMenu, addItem);
      header.append(title, headerActions);

      const items = document.createElement("ol");
      items.replaceChildren(
        ...menu.items.map((item, itemIndex) => {
          const row = document.createElement("li");
          row.className = "menu-item-row";

          const node = findBookmarkNode(item.bookmarkId, rawBookmarkTree);
          const isFolderNode = node?.children !== undefined || node?.url === undefined;
          const isFlatten = item.type === "flattenFolder";
          const isFolder = item.type === "folder" || (!item.type && isFolderNode);

          const label = document.createElement("span");
          label.className = "item-label";

          const rawLabel =
            bookmarkLabels.get(item.bookmarkId) ?? node?.title ?? item.bookmarkId;
          const detectedEmoji = node?.title ? extractLeadingEmoji(node.title) : null;
          const customRename = item.rename || item.emoji;
          const iconPrefix = detectedEmoji || (isFolderNode ? "📁" : "🔖");

          const titleSpan = document.createElement("span");
          titleSpan.className = "item-title";
          if (customRename) {
            titleSpan.textContent = `${customRename} (${rawLabel.trim()})`;
          } else {
            titleSpan.textContent = `${iconPrefix} ${rawLabel.trim()}`;
          }
          titleSpan.title = rawLabel.trim();
          label.appendChild(titleSpan);

          if (customRename) {
            const renameBadge = document.createElement("span");
            renameBadge.className = "item-tag item-tag-rename";
            renameBadge.textContent = t("item.renameBadge", { name: customRename });
            renameBadge.title = t("item.renameBadgeTitle", { name: customRename });
            renameBadge.addEventListener("click", (e) => {
              e.stopPropagation();
              openItemSettingsPopover(menuIndex, itemIndex, renameBadge);
            });
            label.appendChild(renameBadge);
          }

          if (item.tabMode) {
            const tabBadge = document.createElement("span");
            tabBadge.className = "item-tag item-tag-tab-mode";
            tabBadge.textContent =
              item.tabMode === "newTab" ? t("item.tabBadgeNew") : t("item.tabBadgeReplace");
            tabBadge.title = t("item.tabBadgeTitle", {
              mode: item.tabMode === "newTab" ? t("itemSettings.newTab") : t("itemSettings.replaceTab"),
            });
            tabBadge.addEventListener("click", (e) => {
              e.stopPropagation();
              openItemSettingsPopover(menuIndex, itemIndex, tabBadge);
            });
            label.appendChild(tabBadge);
          }

          if (isFlatten) {
            const badge = document.createElement("span");
            badge.className = "item-tag item-tag-flatten";
            const childCount = node?.children
              ? node.children.filter((c) => c.url !== undefined).length
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

            const isHover = item.expandOnHover !== false;
            const hoverBadge = document.createElement("span");
            hoverBadge.className = `item-tag ${isHover ? "item-tag-hover" : "item-tag-click"}`;
            hoverBadge.textContent = isHover ? t("item.hoverBadge") : t("item.clickBadge");
            hoverBadge.title = isHover ? t("item.hoverBadgeTitle") : t("item.clickBadgeTitle");
            hoverBadge.addEventListener("click", (e) => {
              e.stopPropagation();
              openItemSettingsPopover(menuIndex, itemIndex, hoverBadge);
            });
            label.appendChild(hoverBadge);
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
              menu.items.splice(targetIndex, 0, moved);
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
          settingsBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`;
          settingsBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openItemSettingsPopover(menuIndex, itemIndex, settingsBtn);
          });

          // Color swatch button
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
          return row;
        }),
      );

      card.append(header, items);
      return card;
    }),
  );
}

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

function actionButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function flattenBookmarks(
  nodes: browser.Bookmarks.BookmarkTreeNode[],
  depth = 0,
): BookmarkOption[] {
  return nodes.flatMap((node) => {
    const current = node.id === "0" ? [] : [{ id: node.id, label: `${"  ".repeat(depth)}${node.title || t("common.bookmarks")}` }];
    return [...current, ...flattenBookmarks(node.children ?? [], depth + 1)];
  });
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) {
    throw new Error(`Missing #${id}`);
  }
  return value as T;
}

function exportSettings(): void {
  if (isDirty) {
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
    enrichMenuItemPaths(menu.items, rawBookmarkTree);
  }

  const exportConfig: ExtensionConfig = {
    instanceLabel: instanceLabel.value,
    attachmentMode: attachmentMode.value as AttachmentMode,
    desktopWidget: {
      url: desktopUrl.value,
    },
    panel: {
      alwaysOnTop: alwaysOnTop.checked,
      menus,
    },
  };

  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    config: exportConfig,
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  a.href = downloadUrl;
  a.download = `browserail-settings-${dateStr}.json`;
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
    if (typeof parsed !== "object" || parsed === null) {
      status.value = t("import.invalidJson");
      return;
    }

    const configSource =
      "config" in parsed && typeof (parsed as { config: unknown }).config === "object"
        ? (parsed as { config: unknown }).config
        : parsed;

    const normalized = normalizeConfig(configSource, instanceLabel.value);

    // Cross-browser bookmark matching by path & URL
    if (rawBookmarkTree.length > 0) {
      for (const menu of normalized.panel.menus) {
        for (const item of menu.items) {
          let matched: BookmarkNode | undefined;
          if (item.path && item.path.length > 0) {
            matched = findBookmarkNodeByPath(rawBookmarkTree as BookmarkNode[], item.path, item.url);
          } else if (item.url) {
            matched = findBookmarkNodeByPath(rawBookmarkTree as BookmarkNode[], [], item.url);
          }
          if (matched) {
            item.bookmarkId = matched.id;
            const enriched = getItemPathAndUrl(matched.id, rawBookmarkTree);
            if (enriched.path) item.path = enriched.path;
            if (enriched.url) item.url = enriched.url;
          } else if (item.bookmarkId) {
            const existing = findBookmarkNode(item.bookmarkId, rawBookmarkTree);
            if (existing) {
              const enriched = getItemPathAndUrl(existing.id, rawBookmarkTree);
              if (enriched.path) item.path = enriched.path;
              if (enriched.url) item.url = enriched.url;
            }
          }
        }
      }
    }

    instanceLabel.value = normalized.instanceLabel;
    attachmentMode.value = normalized.attachmentMode;
    desktopUrl.value = normalized.desktopWidget.url;
    alwaysOnTop.checked = normalized.panel.alwaysOnTop;
    menus = normalized.panel.menus;
    updateDesktopControls();
    renderMenus();

    await persist();
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
    isDirty &&
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

// Debug & Diagnostics Card
const debugLoggingToggle = document.getElementById("debug-logging-toggle") as HTMLInputElement | null;
const copyDebugBtn = document.getElementById("copy-debug-btn") as HTMLButtonElement | null;
const copyDebugStatus = document.getElementById("copy-debug-status") as HTMLSpanElement | null;

void browser.storage.local.get("debugLoggingEnabled").then((res) => {
  if (debugLoggingToggle) {
    debugLoggingToggle.checked = Boolean(res.debugLoggingEnabled);
  }
}).catch(() => {});

debugLoggingToggle?.addEventListener("change", async () => {
  const enabled = Boolean(debugLoggingToggle.checked);
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
    if (copyDebugBtn) copyDebugBtn.disabled = false;
  }
});

