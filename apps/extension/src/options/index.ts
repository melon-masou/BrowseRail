import {
  type AttachmentMode,
  EXPORT_SCHEMA_VERSION,
  type ExportedMenuItem,
  type ExportedSettingsData,
  type ExpandDirection,
  isExportedSettingsData,
  type MenuFontSize,
  type MenuOrientation,
  type OnTopMode,
} from "@browserail/protocol";
import browser from "webextension-polyfill";

import {
  createMenu,
  DEFAULT_FONT_SIZE,
  DEFAULT_MENU_GAP,
  DEFAULT_MENU_GAP_PERCENT,
  type ExtensionConfig,
  getItemDimensions,
  loadBookmarkRootPrefix,
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
  type UrlRule,
} from "../config";
import {
  type BookmarkNode,
  combineRootAndItemPath,
  findBookmarkNodeByPath,
  formatSpecialRootForDisplay,
  getFolderPath,
  getItemRelativePath,
  getSpecialRootTypeFromNode,
  getSpecialRootTypeFromTitle,
  SPECIAL_ROOT_PLACEHOLDERS,
} from "../bookmarks";
import { DEFAULT_DESKTOP_URL, isLocalDesktopUrl, probeDesktopConnection } from "../desktop-connection";
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
const itemSettingHoverExpandLabel = element<HTMLLabelElement>("item-setting-hover-expand-label");
const itemSettingHoverExpand = element<HTMLInputElement>("item-setting-hover-expand");
const itemSettingIncludeFoldersLabel = element<HTMLLabelElement>("item-setting-include-folders-label");
const itemSettingIncludeFolders = element<HTMLInputElement>("item-setting-include-folders");
const colorPopoverCycleRow = element<HTMLDivElement>("color-popover-cycle-row");
const colorPopoverCycleToggle = element<HTMLInputElement>("color-popover-cycle-toggle");
const colorPopoverCycleSection = element<HTMLDivElement>("color-popover-cycle-section");
const colorPopoverCycleList = element<HTMLDivElement>("color-popover-cycle-list");
const itemSettingChangeBtn = element<HTMLButtonElement>("item-setting-change-btn");
const flattenSpaceHelp = element<HTMLButtonElement>("flatten-space-help");
const flattenSpacePopover = element<HTMLDivElement>("flatten-space-popover");
const flattenSpaceClose = element<HTMLButtonElement>("flatten-space-close");
const addItemPopover = element<HTMLDivElement>("add-item-popover");
const addPopoverBookmarkBtn = element<HTMLButtonElement>("add-popover-bookmark-btn");
const addPopoverSpaceBtn = element<HTMLButtonElement>("add-popover-space-btn");
const menusCardTabs = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".menus-card-tab"),
);
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
let rawBookmarkTree: browser.Bookmarks.BookmarkTreeNode[] = [];
let bookmarkOptions: BookmarkOption[] = [];
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
let pickerMode: "addItem" | "editItem" | "selectRoot" = "addItem";
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
    const rootNode = pickerMode === "selectRoot" ? undefined : getRootNode();
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
    bookmarkId: pickerSelectedId,
    type: itemType,
    ...(expandOnHover !== undefined ? { expandOnHover } : {}),
    ...(includeFolders ? { includeFolders } : {}),
    ...(relativePath !== undefined ? { path: relativePath } : {}),
    ...(selectedNode?.url ? { url: selectedNode.url } : {}),
  };

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
    if (menu && menu.items[pickerTargetItemIndex]) {
      const existing = menu.items[pickerTargetItemIndex];
      existing.bookmarkId = newItem.bookmarkId;
      existing.type = newItem.type;
      existing.expandOnHover = newItem.expandOnHover;
      if (newItem.includeFolders) {
        existing.includeFolders = true;
      } else {
        delete existing.includeFolders;
      }
      existing.path = newItem.path;
      existing.url = newItem.url;
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
    bookmarkOptions = flattenBookmarks(tree);
  } catch {
    // Keep the previous cache if the read fails.
  }
}

async function openBookmarkPicker(
  mode: "addItem" | "editItem" | "selectRoot",
  menuIndex = -1,
  itemIndex = -1,
): Promise<void> {
  // Pick up bookmarks added in the browser since the page (or last picker) loaded.
  await refreshBookmarkTree();

  pickerMode = mode;
  pickerTargetMenuIndex = menuIndex;
  pickerTargetItemIndex = itemIndex;

  const rootNode = mode === "selectRoot" ? undefined : getRootNode();
  pickerCurrentFolderId = rootNode?.id ?? "0";

  let initialFlatten = false;
  let initialHover = true;
  let initialIncludeFolders = false;

  if (mode === "editItem") {
    const existing = menus[menuIndex]?.items[itemIndex];
    if (existing) {
      const node = getItemNode(existing) ?? (existing.bookmarkId ? findBookmarkNode(existing.bookmarkId, rawBookmarkTree) : undefined);
      pickerSelectedId = node?.id ?? existing.bookmarkId ?? null;
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
  } else if (mode === "editItem") {
    pickerTitle.textContent = t("picker.changeTitle");
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
  const effectivePath = combineRootAndItemPath(bookmarkRootPrefix, item.path);
  if (effectivePath.length > 0 || item.url) {
    return findBookmarkNodeByPath(rawBookmarkTree as BookmarkNode[], effectivePath, item.url) as
      | browser.Bookmarks.BookmarkTreeNode
      | undefined;
  }
  return undefined;
}

function getItemPathAndUrl(
  bookmarkId: string,
  nodes: browser.Bookmarks.BookmarkTreeNode[],
  rootPrefix?: string[],
): { path?: string[]; url?: string } {
  const node = findBookmarkNode(bookmarkId, nodes);
  const path = getItemRelativePath(bookmarkId, nodes as BookmarkNode[], rootPrefix);
  return {
    path,
    url: node?.url,
  };
}

function enrichMenuItemPaths(
  items: StoredMenuItem[],
  nodes: browser.Bookmarks.BookmarkTreeNode[],
  rootPrefix?: string[],
): void {
  if (nodes.length === 0) return;
  for (const item of items) {
    if (item.path === undefined) {
      if (item.bookmarkId && !item.bookmarkId.startsWith("space-")) {
        const { path } = getItemPathAndUrl(item.bookmarkId, nodes, rootPrefix);
        if (path !== undefined) {
          item.path = path;
        }
      }
    } else if (item.path.length > 0) {
      const firstSeg = item.path[0];
      if (firstSeg) {
        const special = getSpecialRootTypeFromTitle(firstSeg);
        if (special) {
          item.path[0] = SPECIAL_ROOT_PLACEHOLDERS[special];
        }
      }
    }
    if (!item.type) {
      const node = item.bookmarkId ? findBookmarkNode(item.bookmarkId, nodes) : undefined;
      if (node) {
        item.type = node.children !== undefined || node.url === undefined ? "folder" : "bookmark";
      }
    }
  }
}

function renderPicker(): void {
  const rootNode = pickerMode === "selectRoot" ? undefined : getRootNode();
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
    (rawBookmarkTree.length > 0 ? rawBookmarkTree[0].children ?? rawBookmarkTree : []);

  const items = pickerMode === "selectRoot"
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
  if (pickerMode === "selectRoot") {
    pickerFlattenLabel.style.display = "none";
    pickerHoverExpandLabel.style.display = "none";
    pickerIncludeFoldersLabel.style.display = "none";
    const selectedTargetId = pickerSelectedId || (pickerCurrentFolderId !== "0" ? pickerCurrentFolderId : null);
    pickerConfirmBtn.disabled = !selectedTargetId;
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
  closeAddItemDropdown();
  applyStaticI18n();
  for (const opt of languageSelect.options) {
    opt.textContent = opt.value === "zh-CN" ? t("language.zhCN") : t("language.en");
  }
  languageSelect.value = getLanguage();
  renderMenus();
  renderUrlRules();
  updateDesktopControls();
  renderDesktopState(stateCard.dataset.state ?? "disconnected");
  if (pickerDialog.open) {
    updateSelectedInfo();
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
initFlattenSpacePopover();
  initAddItemPopover();
  void refreshDesktopState();
  const [config, enabled, tree, rootPrefix] = await Promise.all([
    loadConfig(),
    loadWidgetEnabled(),
    browser.bookmarks.getTree(),
    loadBookmarkRootPrefix(),
  ]);
  rawBookmarkTree = tree;
  bookmarkOptions = flattenBookmarks(tree);

  instanceLabel.value = config.instanceLabel;
  widgetEnabled = enabled;
  desktopUrl.value = config.desktopWidget.url;
  bookmarkRootPrefix = rootPrefix;
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
  updateDesktopControls();
  renderMenus();
  renderUrlRules();
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
    enrichMenuItemPaths(menu.items, rawBookmarkTree, bookmarkRootPrefix);
  }

  const currentConfig = await loadConfig();
  await saveConfig({
    ...currentConfig,
    panel: {
      menus,
    },
    urlRules,
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
        item.cycleColors = ["#3b82f6", "#10b981"];
      }
      delete item.color;
      colorPopoverCycleSection.style.display = "block";
      selectedCycleIndex = 0;
      renderPopoverCycleList();
      popoverColorInput.value = item.cycleColors[0];
      popoverColorHex.value = item.cycleColors[0].toUpperCase();
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
          const curColor = item.cycleColors[selectedCycleIndex];
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
        const curColor = item.cycleColors![selectedCycleIndex];
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
        activeColorSwatchElement.style.background = "";
        activeColorSwatchElement.style.backgroundColor = colors[0];
        activeColorSwatchElement.style.borderColor = colors[0];
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
      popoverColorInput.value = target.cycleColors![0];
      popoverColorHex.value = target.cycleColors![0].toUpperCase();
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
      menu.expandDirection = val === "down" || val === "right" ? val : undefined;
      markDirty();
    }
  });

  menuSettingFontSize.addEventListener("input", () => {
    const menu = menus[activeMenuSettingsIndex];
    const val = parseInt(menuSettingFontSize.value, 10);
    if (menu && !isNaN(val)) {
      menu.fontSize = Math.max(8, Math.min(48, val));
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
      markDirty();
    }
  });

  menuSettingOnTopMode.addEventListener("change", () => {
    const menu = menus[activeMenuSettingsIndex];
    if (menu) {
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

  const fs = menu.fontSize !== undefined ? normalizeFontSize(menu.fontSize) : DEFAULT_FONT_SIZE;
  const gapVal = menu.gap !== undefined ? menu.gap : DEFAULT_MENU_GAP_PERCENT;
  menuSettingsDialogTitle.textContent = t("menu.settingsTitle");
  menuSettingOrientation.value = menu.orientation;
  menuSettingExpandDirection.value = menu.expandDirection ?? "";
  menuSettingFontSize.value = String(fs);
  menuSettingGap.value = String(gapVal);
  menuSettingAttachmentMode.value = menu.attachmentMode ?? "lastFocused";
  menuSettingOnTopMode.value = menu.onTopMode ?? "aboveBrowser";
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
        menu.urlRuleUids = [urlRules[0].uid];
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
    itemSettingSpaceUnits.value = String(item.units ?? 1);
    itemSettingTransparent.checked = item.transparent !== false;
  } else {
    itemSettingsSpaceControls.style.display = "none";
    itemSettingsBookmarkControls.style.display = "block";

    const node = getItemNode(item);
    const isFolderNode = node ? (node.children !== undefined || node.url === undefined) : (item.type === "folder" || item.type === "flattenFolder");
    const isFolder = item.type === "folder" || (!item.type && isFolderNode) || item.type === "flattenFolder";

    const lastSeg = item.path && item.path.length > 0 ? item.path[item.path.length - 1] : undefined;
    const rawLabel =
      node?.title ??
      (lastSeg
        ? formatSpecialRootForDisplay(lastSeg, rawBookmarkTree)
        : (item.bookmarkId || ""));
    itemSettingsTitle.textContent = `${isFolder ? "📁" : "🔖"} ${rawLabel.trim()}`;
    itemSettingRename.value = item.rename ?? item.emoji ?? "";
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
  closeFlattenSpacePopover();
  activeItemSettings = null;
  activeItemSettingsBtn = null;
}

function initFlattenSpacePopover(): void {
  flattenSpaceHelp.addEventListener("click", (e) => {
    e.stopPropagation();
    if (flattenSpacePopover.style.display !== "none") {
      closeFlattenSpacePopover();
      return;
    }
    const rect = flattenSpaceHelp.getBoundingClientRect();
    positionPopover(flattenSpacePopover, rect, 260);
  });

  flattenSpaceClose.addEventListener("click", () => closeFlattenSpacePopover());

  document.addEventListener("pointerdown", (e) => {
    if (flattenSpacePopover.style.display === "none") return;
    const target = e.target as Node | null;
    if (
      target &&
      !flattenSpacePopover.contains(target) &&
      !flattenSpaceHelp.contains(target)
    ) {
      closeFlattenSpacePopover();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && flattenSpacePopover.style.display !== "none") {
      closeFlattenSpacePopover();
    }
  });
}

function closeFlattenSpacePopover(): void {
  flattenSpacePopover.style.display = "none";
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
          bookmarkId: `space-${crypto.randomUUID()}`,
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
        menu.enabled = toggleInput.checked;
        card.dataset.enabled = String(menu.enabled);
        toggleLabel.title = menu.enabled ? t("menu.disable") : t("menu.enable");
        toggleLabel.setAttribute("aria-label", toggleLabel.title);
        markDirty();
      });

      const toggleSlider = document.createElement("span");
      toggleSlider.className = "switch-slider";

      toggleLabel.append(toggleInput, toggleSlider);

      const settingsBtn = document.createElement("button");
      settingsBtn.type = "button";
      settingsBtn.className = "action-btn menu-header-btn";
      settingsBtn.textContent = t("menu.settings");
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

          if (item.type === "space") {
            const units = item.units ?? 1;
            const isTransparent = item.transparent !== false;

            const label = document.createElement("span");
            label.className = "item-label";

            const titleSpan = document.createElement("span");
            titleSpan.className = "item-title";
            titleSpan.textContent = `␣ ${t("item.spaceBadge")} (${units}x)`;
            titleSpan.title = `${t("item.spaceBadge")} (${units}x)`;
            label.appendChild(titleSpan);

            const spaceBadge = document.createElement("span");
            spaceBadge.className = "item-tag item-tag-space";
            spaceBadge.textContent = `${units}x`;
            spaceBadge.addEventListener("click", (e) => {
              e.stopPropagation();
              openItemSettingsPopover(menuIndex, itemIndex, spaceBadge);
            });
            label.appendChild(spaceBadge);

            if (!isTransparent) {
              const solidBadge = document.createElement("span");
              solidBadge.className = "item-tag item-tag-space-solid";
              solidBadge.textContent = t("itemSettings.transparent") === "透明" ? "实体" : "Solid";
              solidBadge.addEventListener("click", (e) => {
                e.stopPropagation();
                openItemSettingsPopover(menuIndex, itemIndex, solidBadge);
              });
              label.appendChild(solidBadge);
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

            const settingsBtn = document.createElement("button");
            settingsBtn.type = "button";
            settingsBtn.className = "item-settings-btn";
            settingsBtn.title = t("itemSettings.title");
            settingsBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`;
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

          const node = getItemNode(item);
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
              : (item.bookmarkId || ""));
          const customRename = item.rename || item.emoji;
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
          if (isFlatten) {
            swatch.className = "item-color-swatch";
            const colors = item.cycleColors;
            if (colors && colors.length > 0) {
              if (colors.length === 1) {
                swatch.style.background = "";
                swatch.style.backgroundColor = colors[0];
                swatch.style.borderColor = colors[0];
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
    deleteBtn.className = "action-btn url-rule-remove-btn";
    deleteBtn.textContent = t("urlRules.deleteSet");
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
    enrichMenuItemPaths(menu.items, rawBookmarkTree, bookmarkRootPrefix);
  }

  // Export only the menus, in a portable shape: each item is identified by its
  // bookmark path and keeps its type + user settings. Browser-specific bookmarkId
  // and the re-derivable url are omitted; so are instance label, desktop address,
  // attachment mode, always-on-top, and language (per-install / per-environment).
  const exportData: ExportedSettingsData = {
    version: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    ...(urlRules.length > 0 ? { urlRules: structuredClone(urlRules) } : {}),
    menus: menus.map((menu) => ({
      uid: menu.uid,
      orientation: menu.orientation,
      ...(menu.urlRuleUids && menu.urlRuleUids.length > 0 ? { urlRuleUids: menu.urlRuleUids } : {}),
      ...(menu.enabled !== undefined ? { enabled: menu.enabled } : {}),
      ...(menu.fontSize !== undefined ? { fontSize: menu.fontSize } : {}),
      ...(menu.gap !== undefined ? { gap: menu.gap } : {}),
      ...(menu.color ? { color: menu.color } : {}),
      ...(menu.expandDirection ? { expandDirection: menu.expandDirection } : {}),
      ...(menu.attachmentMode ? { attachmentMode: menu.attachmentMode } : {}),
      ...(menu.onTopMode ? { onTopMode: menu.onTopMode } : {}),
      ...(menu.tabMode ? { tabMode: menu.tabMode } : {}),
      items: menu.items.map((item) => {
        let path = item.path;
        if (!path || path.length === 0) {
          if (item.bookmarkId && !item.bookmarkId.startsWith("space-")) {
            const { path: resolvedPath } = getItemPathAndUrl(item.bookmarkId, rawBookmarkTree, bookmarkRootPrefix);
            path = resolvedPath;
          }
        }
        const node = item.bookmarkId ? findBookmarkNode(item.bookmarkId, rawBookmarkTree) : undefined;
        const isFolder = node ? (node.children !== undefined || node.url === undefined) : false;
        const itemType: string = item.type ?? (isFolder ? "folder" : "bookmark");

        const exportedItem: ExportedMenuItem = {
          type: itemType,
          ...(path && path.length > 0 ? { path } : {}),
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

    // Rebuild each item from its portable fields: match the bookmark by path to
    // recover the browser-specific bookmarkId; omit url; keep type + settings.
    const importedMenus: StoredMenu[] = [];
    for (const rawMenu of menusSource) {
      if (typeof rawMenu !== "object" || rawMenu === null) continue;
      const menuRecord = rawMenu as Record<string, unknown>;
      const rawItems = Array.isArray(menuRecord.items) ? menuRecord.items : [];

      const items: StoredMenuItem[] = [];
      for (const rawItem of rawItems) {
        if (typeof rawItem !== "object" || rawItem === null) continue;
        const itemRecord = rawItem as Record<string, unknown>;

        const path = Array.isArray(itemRecord.path)
          ? itemRecord.path.filter((p): p is string => typeof p === "string")
          : [];
        const type: StoredMenuItemType = typeof itemRecord.type === "string" && itemRecord.type
          ? itemRecord.type
          : "bookmark";

        let bookmarkId = "";
        let resolvedPath: string[] | undefined = path.length > 0 ? path : undefined;
        if (rawBookmarkTree.length > 0 && path.length > 0) {
          const effectivePath = combineRootAndItemPath(bookmarkRootPrefix, path);
          const matched = findBookmarkNodeByPath(rawBookmarkTree as BookmarkNode[], effectivePath, undefined);
          if (matched) {
            bookmarkId = matched.id;
          }
        } else if (typeof itemRecord.bookmarkId === "string") {
          bookmarkId = itemRecord.bookmarkId;
        }

        const rename = typeof itemRecord.rename === "string" && itemRecord.rename
          ? itemRecord.rename
          : typeof itemRecord.emoji === "string" && itemRecord.emoji
            ? itemRecord.emoji
            : undefined;

        const expandDirection =
          itemRecord.expandDirection === "down" ||
          itemRecord.expandDirection === "right"
            ? (itemRecord.expandDirection as ExpandDirection)
            : undefined;

        const cycleColors = Array.isArray(itemRecord.cycleColors)
          ? itemRecord.cycleColors.filter((c): c is string => typeof c === "string" && Boolean(c))
          : undefined;

        items.push({
          bookmarkId,
          type,
          ...(resolvedPath ? { path: resolvedPath } : {}),
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
        });
      }

      const normalizedMenu = normalizeMenu({
        ...menuRecord,
        uid: typeof menuRecord.uid === "string" && menuRecord.uid ? menuRecord.uid : crypto.randomUUID(),
        items,
      });
      if (normalizedMenu) importedMenus.push(normalizedMenu);
    }

    // Only the menus and URL rules are imported; instance label, desktop address, attachment
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
