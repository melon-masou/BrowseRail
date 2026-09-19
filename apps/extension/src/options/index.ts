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
const colorPopoverClose = element<HTMLButtonElement>("color-popover-close");
const popoverColorInput = element<HTMLInputElement>("popover-color-input");
const popoverColorHex = element<HTMLInputElement>("popover-color-hex");
const colorPopoverPresets = element<HTMLDivElement>("color-popover-presets");
const popoverRandomBtn = element<HTMLButtonElement>("popover-random-btn");
const popoverDefaultBtn = element<HTMLButtonElement>("popover-default-btn");

// Menu Style popover elements
const menuStylePopover = element<HTMLDivElement>("menu-style-popover");
const menuStyleTitle = element<HTMLSpanElement>("menu-style-title");
const menuStyleClose = element<HTMLButtonElement>("menu-style-close");
const menuSettingOrientation = element<HTMLSelectElement>("menu-setting-orientation");
const menuSettingExpandDirection = element<HTMLSelectElement>("menu-setting-expand-direction");
const menuSettingFontSize = element<HTMLInputElement>("menu-setting-font-size");
const menuSettingGap = element<HTMLInputElement>("menu-setting-gap");

// Menu Behavior popover elements
const menuBehaviorPopover = element<HTMLDivElement>("menu-behavior-popover");
const menuBehaviorTitle = element<HTMLSpanElement>("menu-behavior-title");
const menuBehaviorClose = element<HTMLButtonElement>("menu-behavior-close");
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
const itemSettingChangeBtn = element<HTMLButtonElement>("item-setting-change-btn");
const addItemPopover = element<HTMLDivElement>("add-item-popover");
const addPopoverBookmarkBtn = element<HTMLButtonElement>("add-popover-bookmark-btn");
const addPopoverSpaceBtn = element<HTMLButtonElement>("add-popover-space-btn");
const syncEnabledToggle = document.getElementById("sync-enabled-toggle") as HTMLInputElement | null;
const bookmarkRootInput = document.getElementById("bookmark-root-input") as HTMLInputElement | null;
const pickBookmarkRootBtn = document.getElementById("pick-bookmark-root-btn") as HTMLButtonElement | null;

let widgetEnabled = true;
let isConnectionDirty = false;
let isMenusDirty = false;
let bookmarkRootPrefix: string[] = [];
let menus: StoredMenu[] = [];
let rawBookmarkTree: browser.Bookmarks.BookmarkTreeNode[] = [];
let bookmarkOptions: BookmarkOption[] = [];
let desktopTestGeneration = 0;

// Popover state
let activeColorTarget: StoredMenu | StoredMenuItem | null = null;
let activeColorSwatchElement: HTMLElement | null = null;

let activeStyleMenuIndex = -1;
let activeStyleBtn: HTMLElement | null = null;

let activeBehaviorMenuIndex = -1;
let activeBehaviorBtn: HTMLElement | null = null;

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
  initColorPopover();
  initMenuStylePopover();
  initMenuBehaviorPopover();
  initItemSettingsPopover();
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
  updateDesktopControls();
  renderMenus();
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
    delete activeColorTarget.color;
    popoverColorInput.value = "#3b82f6";
    popoverColorHex.value = "";
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
  popoverColorHex.value = color.toUpperCase();
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
  closeAddItemDropdown();
  activeColorTarget = target;
  activeColorSwatchElement = swatchElement;

  const currentColor = target.color || "#3b82f6";
  popoverColorInput.value = currentColor;
  popoverColorHex.value = target.color ? target.color.toUpperCase() : "";

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
  if (activeStyleMenuIndex < 0 && activeBehaviorMenuIndex < 0 && !activeItemSettings) {
    renderMenus();
  }
}

function initMenuStylePopover(): void {
  menuStyleClose.addEventListener("click", () => closeMenuStylePopover());

  menuSettingOrientation.addEventListener("change", () => {
    const menu = menus[activeStyleMenuIndex];
    if (menu) {
      menu.orientation = menuSettingOrientation.value as MenuOrientation;
      markDirty();
    }
  });

  menuSettingExpandDirection.addEventListener("change", () => {
    const menu = menus[activeStyleMenuIndex];
    if (menu) {
      menu.expandDirection = menuSettingExpandDirection.value as ExpandDirection;
      markDirty();
    }
  });

  menuSettingFontSize.addEventListener("input", () => {
    const menu = menus[activeStyleMenuIndex];
    const val = parseInt(menuSettingFontSize.value, 10);
    if (menu && !isNaN(val)) {
      menu.fontSize = Math.max(8, Math.min(48, val));
      markDirty();
    }
  });

  menuSettingGap.addEventListener("input", () => {
    const menu = menus[activeStyleMenuIndex];
    const val = parseInt(menuSettingGap.value, 10);
    if (menu && !isNaN(val)) {
      menu.gap = Math.max(0, Math.min(100, val));
      markDirty();
    }
  });

  document.addEventListener("click", (e) => {
    if (menuStylePopover.style.display === "none") return;
    const target = e.target as Node | null;
    if (
      target &&
      !menuStylePopover.contains(target) &&
      !colorPopover.contains(target) &&
      activeStyleBtn &&
      !activeStyleBtn.contains(target)
    ) {
      closeMenuStylePopover();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuStylePopover.style.display !== "none") {
      closeMenuStylePopover();
    }
  });
}

function openMenuStylePopover(menuIndex: number, btnElement: HTMLElement): void {
  if (activeStyleMenuIndex === menuIndex && menuStylePopover.style.display !== "none") {
    closeMenuStylePopover();
    return;
  }
  // Measure the anchor before the close calls below, which re-render the menu list
  // and detach this button — a detached node reports a 0,0 rect (top-left popup).
  const rect = btnElement.getBoundingClientRect();
  closeAddItemDropdown();
  closeMenuBehaviorPopover();
  closeColorPopover();
  closeItemSettingsPopover();

  activeStyleMenuIndex = menuIndex;
  activeStyleBtn = btnElement;

  const menu = menus[menuIndex];
  if (!menu) return;

  const fs = menu.fontSize !== undefined ? normalizeFontSize(menu.fontSize) : DEFAULT_FONT_SIZE;
  const gapVal = menu.gap !== undefined ? menu.gap : DEFAULT_MENU_GAP_PERCENT;

  menuStyleTitle.textContent = t("menuStyle.title", { n: menuIndex + 1 });
  menuSettingOrientation.value = menu.orientation;
  menuSettingExpandDirection.value = menu.expandDirection ?? "down";
  menuSettingFontSize.value = String(fs);
  menuSettingGap.value = String(gapVal);

  const popoverWidth = 320;
  let top = rect.bottom + window.scrollY + 6;
  let left = rect.left + window.scrollX - popoverWidth / 2 + rect.width / 2;

  if (left < 10) left = 10;
  if (left + popoverWidth > window.innerWidth - 10) {
    left = window.innerWidth - popoverWidth - 10;
  }

  menuStylePopover.style.position = "absolute";
  menuStylePopover.style.top = `${top}px`;
  menuStylePopover.style.left = `${left}px`;
  menuStylePopover.style.display = "flex";
}

function closeMenuStylePopover(): void {
  menuStylePopover.style.display = "none";
  activeStyleMenuIndex = -1;
  activeStyleBtn = null;
  renderMenus();
}

function initMenuBehaviorPopover(): void {
  menuBehaviorClose.addEventListener("click", () => closeMenuBehaviorPopover());

  menuSettingAttachmentMode.addEventListener("change", () => {
    const menu = menus[activeBehaviorMenuIndex];
    if (menu) {
      menu.attachmentMode = menuSettingAttachmentMode.value as AttachmentMode;
      markDirty();
    }
  });

  menuSettingOnTopMode.addEventListener("change", () => {
    const menu = menus[activeBehaviorMenuIndex];
    if (menu) {
      menu.onTopMode = menuSettingOnTopMode.value as OnTopMode;
      markDirty();
    }
  });

  menuSettingTabMode.addEventListener("change", () => {
    const menu = menus[activeBehaviorMenuIndex];
    if (menu) {
      menu.tabMode = menuSettingTabMode.value === "newTab" ? "newTab" : "replace";
      renderMenus();
      markDirty();
    }
  });

  document.addEventListener("click", (e) => {
    if (menuBehaviorPopover.style.display === "none") return;
    const target = e.target as Node | null;
    if (
      target &&
      !menuBehaviorPopover.contains(target) &&
      !colorPopover.contains(target) &&
      activeBehaviorBtn &&
      !activeBehaviorBtn.contains(target)
    ) {
      closeMenuBehaviorPopover();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuBehaviorPopover.style.display !== "none") {
      closeMenuBehaviorPopover();
    }
  });
}

function openMenuBehaviorPopover(menuIndex: number, btnElement: HTMLElement): void {
  if (activeBehaviorMenuIndex === menuIndex && menuBehaviorPopover.style.display !== "none") {
    closeMenuBehaviorPopover();
    return;
  }
  // Measure the anchor before the close calls below, which re-render the menu list
  // and detach this button — a detached node reports a 0,0 rect (top-left popup).
  const rect = btnElement.getBoundingClientRect();
  closeAddItemDropdown();
  closeMenuStylePopover();
  closeColorPopover();
  closeItemSettingsPopover();

  activeBehaviorMenuIndex = menuIndex;
  activeBehaviorBtn = btnElement;

  const menu = menus[menuIndex];
  if (!menu) return;

  menuBehaviorTitle.textContent = t("menuBehavior.title", { n: menuIndex + 1 });
  menuSettingAttachmentMode.value = menu.attachmentMode ?? "lastFocused";
  menuSettingOnTopMode.value = menu.onTopMode ?? "aboveBrowser";
  menuSettingTabMode.value = menu.tabMode ?? "replace";

  const popoverWidth = 320;
  let top = rect.bottom + window.scrollY + 6;
  let left = rect.left + window.scrollX - popoverWidth / 2 + rect.width / 2;

  if (left < 10) left = 10;
  if (left + popoverWidth > window.innerWidth - 10) {
    left = window.innerWidth - popoverWidth - 10;
  }

  menuBehaviorPopover.style.position = "absolute";
  menuBehaviorPopover.style.top = `${top}px`;
  menuBehaviorPopover.style.left = `${left}px`;
  menuBehaviorPopover.style.display = "flex";
}

function closeMenuBehaviorPopover(): void {
  menuBehaviorPopover.style.display = "none";
  activeBehaviorMenuIndex = -1;
  activeBehaviorBtn = null;
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

    // Flatten and expand-on-hover are independent: expand-on-hover applies to the
    // sub-folders emitted when "include folders" is on, so toggling flatten must
    // not change the hover checkbox.
    if (itemSettingFlatten.checked) {
      item.type = "flattenFolder";
      itemSettingIncludeFoldersLabel.style.display = "inline-flex";
      itemSettingIncludeFolders.checked = item.includeFolders === true;
    } else {
      item.type = "folder";
      delete item.includeFolders;
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
  closeAddItemDropdown();

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

  document.addEventListener("click", (e) => {
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
  closeMenuStylePopover();
  closeMenuBehaviorPopover();
  closeColorPopover();
  closeItemSettingsPopover();

  activeAddMenuIndex = menuIndex;
  activeAddBtn = btnElement;

  const popoverWidth = 170;
  let top = rect.bottom + window.scrollY + 4;
  let left = rect.right + window.scrollX - popoverWidth;

  if (left < 10) left = 10;
  if (left + popoverWidth > window.innerWidth - 10) {
    left = window.innerWidth - popoverWidth - 10;
  }

  addItemPopover.style.position = "absolute";
  addItemPopover.style.top = `${top}px`;
  addItemPopover.style.left = `${left}px`;
  addItemPopover.style.display = "flex";
}

function closeAddItemDropdown(): void {
  addItemPopover.style.display = "none";
  activeAddMenuIndex = -1;
  activeAddBtn = null;
}

let draggingItem: { menuIndex: number; itemIndex: number } | null = null;

function renderMenus(): void {
  menusContainer.replaceChildren(
    ...menus.map((menu, menuIndex) => {
      const card = document.createElement("article");
      card.className = "menu-card";
      const isMenuEnabled = menu.enabled !== false;
      card.dataset.enabled = String(isMenuEnabled);

      const header = document.createElement("header");

      const titleRow = document.createElement("div");
      titleRow.className = "menu-title-row";

      const title = document.createElement("strong");
      title.textContent = t("menu.title", { n: menuIndex + 1 });

      const toggleLabel = document.createElement("label");
      toggleLabel.className = "switch-toggle menu-enable-toggle";
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
        disabledBadge.style.display = menu.enabled ? "none" : "";
        markDirty();
      });

      const toggleSlider = document.createElement("span");
      toggleSlider.className = "switch-slider";

      toggleLabel.append(toggleInput, toggleSlider);

      const disabledBadge = document.createElement("span");
      disabledBadge.className = "menu-disabled-badge";
      disabledBadge.textContent = t("menu.disabledBadge");
      disabledBadge.style.display = isMenuEnabled ? "none" : "";

      titleRow.append(title, toggleLabel, disabledBadge);

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

      const styleBtn = document.createElement("button");
      styleBtn.type = "button";
      styleBtn.className = "action-btn menu-header-btn";
      styleBtn.textContent = t("menu.style");
      styleBtn.title = t("menu.styleTitle");
      styleBtn.addEventListener("click", () => {
        openMenuStylePopover(menuIndex, styleBtn);
      });

      const behaviorBtn = document.createElement("button");
      behaviorBtn.type = "button";
      behaviorBtn.className = "action-btn menu-header-btn";
      behaviorBtn.textContent = t("menu.behavior");
      behaviorBtn.title = t("menu.behaviorTitle");
      behaviorBtn.addEventListener("click", () => {
        openMenuBehaviorPopover(menuIndex, behaviorBtn);
      });

      const removeMenu = document.createElement("button");
      removeMenu.type = "button";
      removeMenu.className = "action-btn menu-header-btn";
      removeMenu.textContent = t("menu.removeMenu");
      removeMenu.addEventListener("click", () => {
        if (activeStyleMenuIndex === menuIndex) {
          closeMenuStylePopover();
        }
        if (activeBehaviorMenuIndex === menuIndex) {
          closeMenuBehaviorPopover();
        }
        if (activeColorTarget === menu) {
          closeColorPopover();
        }
        if (activeAddMenuIndex === menuIndex) {
          closeAddItemDropdown();
        }
        menus.splice(menuIndex, 1);
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

      headerActions.append(menuColorSwatch, styleBtn, behaviorBtn, removeMenu, addBtn);
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
    menus: menus.map((menu) => ({
      uid: menu.uid,
      orientation: menu.orientation,
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
          ...(item.color ? { color: item.color } : {}),
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

        items.push({
          bookmarkId,
          type,
          ...(resolvedPath ? { path: resolvedPath } : {}),
          ...(typeof itemRecord.units === "number" ? { units: itemRecord.units } : {}),
          ...(typeof itemRecord.transparent === "boolean" ? { transparent: itemRecord.transparent } : {}),
          ...(rename ? { rename } : {}),
          ...(typeof itemRecord.color === "string" && itemRecord.color
            ? { color: itemRecord.color }
            : {}),
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

    // Only the menus are imported; instance label, desktop address, attachment
    // mode, always-on-top, and language keep their current values.
    menus = importedMenus;
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

