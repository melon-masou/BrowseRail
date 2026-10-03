import type browser from "webextension-polyfill";
import { t } from "@browserail/i18n";
import {
  getFolderPath,
  getItemRelativePath,
  getSpecialRootTypeFromNode,
  SPECIAL_ROOT_PLACEHOLDERS,
  type BookmarkNode,
} from "../../bookmarks";
import { type BookmarkLibrary } from "../bookmark-library";
import { element } from "../dom";
import { createScope } from "../lifecycle";
export interface BookmarkPickOptions {
  mode: "item" | "root" | "folder" | "bookmark";
  title: string;
  confirmLabel: string;
  selectedId?: string;
  flatten?: boolean;
  expandOnHover?: boolean;
  includeFolders?: boolean;
  rootPrefix: readonly string[];
}
export interface BookmarkPickResult {
  node: browser.Bookmarks.BookmarkTreeNode;
  rootPrefix: string[];
  relativePath: string[] | undefined;
  flattened: boolean;
  expandOnHover: boolean;
  includeFolders: boolean;
}
export function createBookmarkPicker(library: BookmarkLibrary) {
  const scope = createScope();
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
  let pickerCurrentFolderId = "0";
  let pickerSelectedId: string | null = null;
  let options: BookmarkPickOptions;
  let finish: ((value: BookmarkPickResult | null) => void) | undefined;
  pickerCloseBtn.addEventListener("click", () => pickerDialog.close(), { signal: scope.signal });
  pickerDialog.addEventListener(
    "close",
    () => {
      if (pickerDialog.open) return;
      finish?.(null);
      finish = undefined;
    },
    { signal: scope.signal },
  );
  for (const input of [
    pickerFlattenCheckbox,
    pickerIncludeFoldersCheckbox,
    pickerHoverExpandCheckbox,
  ])
    input.addEventListener(
      "change",
      () => {
        if (!pickerFlattenCheckbox.checked) pickerIncludeFoldersCheckbox.checked = false;
        updateSelectedInfo();
      },
      { signal: scope.signal },
    );
  pickerUpBtn.addEventListener(
    "click",
    () => {
      const path = getFolderPath(pickerCurrentFolderId, library.tree as BookmarkNode[]);
      const root =
        options.mode === "root" || options.mode === "folder" ? undefined : library.root();
      if (root?.id === pickerCurrentFolderId) return;
      const parent = path[path.length - 2];
      if (parent) {
        pickerCurrentFolderId = parent.id;
        pickerSelectedId = null;
        renderPicker();
      }
    },
    { signal: scope.signal },
  );
  pickerSelectCurrentBtn.addEventListener(
    "click",
    () => {
      pickerSelectedId = pickerCurrentFolderId;
      renderPicker();
    },
    { signal: scope.signal },
  );
  pickerConfirmBtn.addEventListener(
    "click",
    () => {
      const id =
        pickerSelectedId ||
        (options.mode === "root" || options.mode === "folder" ? pickerCurrentFolderId : null);
      const node = id ? library.find(id) : undefined;
      if (!node) return;
      const path = getFolderPath(node.id, library.tree as BookmarkNode[]);
      const rootPrefix = path
        .filter((node) => node.id !== "0" && Boolean(node.title.trim()))
        .map((node, index) => {
          const special = index === 0 ? getSpecialRootTypeFromNode(node) : undefined;
          return special ? SPECIAL_ROOT_PLACEHOLDERS[special] : node.title.trim();
        });
      finish?.({
        node,
        rootPrefix,
        relativePath: getItemRelativePath(node.id, library.tree as BookmarkNode[], [
          ...options.rootPrefix,
        ]),
        flattened: pickerFlattenCheckbox.checked,
        expandOnHover: pickerHoverExpandCheckbox.checked,
        includeFolders: pickerIncludeFoldersCheckbox.checked,
      });
      finish = undefined;
      pickerDialog.close();
    },
    { signal: scope.signal },
  );
  function renderPicker(): void {
    const rootNode =
      options.mode === "root" || options.mode === "folder" ? undefined : library.root();
    let currentPath = getFolderPath(pickerCurrentFolderId, library.tree as BookmarkNode[]);
    if (rootNode && !currentPath.some((node) => node.id === rootNode.id)) {
      pickerCurrentFolderId = rootNode.id;
      currentPath = getFolderPath(rootNode.id, library.tree as BookmarkNode[]);
    }
    const currentFolder = library.find(pickerCurrentFolderId);
    let displayPath = currentPath;
    if (rootNode) {
      const rootIndex = currentPath.findIndex((n) => n.id === rootNode.id);
      if (rootIndex !== -1) {
        displayPath = currentPath.slice(rootIndex);
        pickerUpBtn.disabled = displayPath.length <= 1;
      }
    } else {
      pickerUpBtn.disabled = currentPath.length <= 1;
    }

    // Update select current folder button
    const currentFolderName =
      currentFolder?.title ||
      (currentFolder?.id === "0" ? t("common.bookmarks") : t("common.folder"));
    pickerSelectCurrentBtn.textContent = `${t("picker.selectCurrent")}: ${currentFolderName}`;
    pickerSelectCurrentBtn.dataset.selected = String(pickerSelectedId === pickerCurrentFolderId);

    // Render Breadcrumbs
    pickerBreadcrumbs.replaceChildren(
      ...displayPath.map((node, index) => {
        const isCurrent = index === displayPath.length - 1;
        const isSelected = pickerSelectedId === node.id;
        const span = document.createElement("span");
        span.className = `picker-crumb ${isCurrent ? "current" : ""} ${isSelected ? "selected" : ""}`;
        span.textContent =
          node.title || (node.id === "0" ? t("common.bookmarks") : t("common.folder"));
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
    const allItems = currentFolder?.children ?? library.tree[0]?.children ?? library.tree;
    const items =
      options.mode === "root" || options.mode === "folder"
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
        titleSpan.textContent =
          node.title || (isFolder ? t("common.folder") : node.url || t("common.untitled"));
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
    if (options.mode === "folder") {
      pickerFlattenLabel.style.display = "none";
      pickerHoverExpandLabel.style.display = "none";
      pickerIncludeFoldersLabel.style.display = "none";
      // Mirror the select-root flow: an explicitly selected folder wins, otherwise
      // the folder currently open can be confirmed directly.
      const targetId =
        pickerSelectedId || (pickerCurrentFolderId !== "0" ? pickerCurrentFolderId : null);
      const targetNode = targetId ? library.find(targetId) : undefined;
      const isFolder = targetNode !== undefined && targetNode.url === undefined;
      pickerConfirmBtn.disabled = !(targetId && targetId !== "0" && isFolder);
      return;
    }

    if (options.mode === "root") {
      pickerFlattenLabel.style.display = "none";
      pickerHoverExpandLabel.style.display = "none";
      pickerIncludeFoldersLabel.style.display = "none";
      const selectedTargetId =
        pickerSelectedId || (pickerCurrentFolderId !== "0" ? pickerCurrentFolderId : null);
      pickerConfirmBtn.disabled = !selectedTargetId;
      return;
    }

    if (options.mode === "bookmark") {
      pickerFlattenLabel.style.display = "none";
      pickerHoverExpandLabel.style.display = "none";
      pickerIncludeFoldersLabel.style.display = "none";
      const selectedNode = pickerSelectedId ? library.find(pickerSelectedId) : undefined;
      const isBookmark = Boolean(selectedNode && selectedNode.url !== undefined);
      pickerConfirmBtn.disabled = !isBookmark;
      return;
    }

    if (pickerSelectedId) {
      const selectedNode = library.find(pickerSelectedId);
      const isFolder = selectedNode?.children !== undefined || selectedNode?.url === undefined;
      if (isFolder) {
        pickerFlattenLabel.style.display = "inline-flex";
        pickerHoverExpandLabel.style.display = "inline-flex";
        pickerIncludeFoldersLabel.style.display = pickerFlattenCheckbox.checked
          ? "inline-flex"
          : "none";
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

  return {
    async pick(next: BookmarkPickOptions): Promise<BookmarkPickResult | null> {
      await library.refresh();
      if (scope.signal.aborted) return null;
      if (pickerDialog.open) pickerDialog.close();
      finish?.(null);
      options = next;
      pickerSelectedId = next.selectedId ?? null;
      pickerFlattenCheckbox.checked = next.flatten ?? false;
      pickerHoverExpandCheckbox.checked = next.expandOnHover !== false;
      pickerHoverExpandCheckbox.disabled = false;
      pickerIncludeFoldersCheckbox.checked = next.flatten === true && next.includeFolders === true;
      pickerTitle.textContent = next.title;
      pickerConfirmBtn.textContent = next.confirmLabel;
      renderPicker();
      pickerDialog.showModal();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    refresh(): void {
      if (pickerDialog.open) renderPicker();
    },
    destroy(): void {
      finish?.(null);
      finish = undefined;
      pickerDialog.close();
      scope.destroy();
      pickerContent.replaceChildren();
      pickerBreadcrumbs.replaceChildren();
    },
  };
}
export type BookmarkPicker = ReturnType<typeof createBookmarkPicker>;
