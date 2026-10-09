import {
  DEFAULT_DOCK_COLOR,
  DEFAULT_MENU_COLOR,
  type BrowserActionKind,
  type CustomBookmarkType,
  customBookmarkUid,
  customBookmarkReference,
  isCustomBookmarkType,
} from "@browserail/protocol";
import {
  createMenu,
  type StoredMenu,
  type StoredMenuItem,
} from "../../../lib/config";
import { formatSpecialRootForDisplay } from "../../../lib/bookmarks";
import { t } from "@browserail/i18n";
import { positionPopover } from "../components/popover-position";
import { DEFAULT_COLOR } from "../components/color-picker";
import { type ReadonlyData, type ColorId, type OptionsState } from "../state";
import { updateSwatchAppearance, type ColorPopover } from "../components/color-popover";
import { element } from "../dom";
import { createScope } from "../lifecycle";
import { type BookmarkLibrary } from "../bookmark-library";
import { type CustomBookmarkSource } from "../custom-bookmark-source";
import { type Persistence } from "../persistence";
import { type BookmarkPicker } from "../components/bookmark-picker";
import { type CustomBookmarkPicker } from "../components/custom-bookmark-picker";
import { createItemPicker } from "../components/item-picker";
import { actionChoices } from "../components/action-picker";
import { createCssEditor } from "../components/css-editor";
import { createItemIconPicker } from "../components/item-icon";
import { createMoveButtons } from "../components/move-buttons";

import { type Overlays } from "../components/overlays";
import { removeIcon, setIconContent, settingsIcon } from "../components/icons";
import { renderPreservingFocus } from "../components/render-focus";
import { browserActions } from "../browser";

export function mountMenusTab(
  state: OptionsState,
  library: BookmarkLibrary,
  source: CustomBookmarkSource,
  bookmarkPicker: BookmarkPicker,
  customBookmarkPicker: CustomBookmarkPicker,
  colorPopoverController: ColorPopover,
  overlays: Overlays,
  persistence: Pick<Persistence, "saveMenuEnabled">,
  showStatus: (message: string) => void,
) {
  const scope = createScope();
  let colorOpen = false;
  const menusContainer = element<HTMLDivElement>("menus");
  const addMenu = element<HTMLButtonElement>("add-menu");
  const cssEditor = createCssEditor(() => renderMenus());
  scope.add(() => cssEditor.destroy());
  element<HTMLButtonElement>("global-css-button").addEventListener("click", () => {
    closeMenuSettingsDialog(); closeItemSettingsPopover(); closeAddItemDropdown(); colorPopoverController.close();
    cssEditor.openGlobal({
      read: () => state.settings.globalCss ?? {},
      add: name => state.addGlobalCss(name),
      update: (key, css) => state.setGlobalCss(key, css),
      remove: key => state.removeGlobalCss(key),
    });
  }, { signal: scope.signal });
  const menuSettingsDialog = element<HTMLDialogElement>("menu-settings-dialog");
  const menuSettingsDialogTitle = element<HTMLSpanElement>("menu-settings-dialog-title");
  const menuSettingsClose = element<HTMLButtonElement>("menu-settings-close");
  const menuSettingName = element<HTMLInputElement>("menu-setting-name");
  menuSettingName.addEventListener("input", () => {
    const menu = state.settings.menus[activeMenuSettingsIndex];
    if (menu) state.setMenuName(menu.uid, menuSettingName.value);
  }, { signal: scope.signal });
  const menuSettingCssClass = element<HTMLInputElement>("menu-setting-css-class");
  const menuSettingStyle = element<HTMLSelectElement>("menu-setting-style");
  menuSettingStyle.addEventListener("change", () => {
    const menu = state.settings.menus[activeMenuSettingsIndex];
    if (menu) state.setMenuStyle(menu.uid, menuSettingStyle.value as NonNullable<StoredMenu["style"]>);
  }, { signal: scope.signal });
  menuSettingCssClass.addEventListener("input", () => {
    const menu = state.settings.menus[activeMenuSettingsIndex];
    if (menu) state.setMenuCssClass(menu.uid, menuSettingCssClass.value);
  }, { signal: scope.signal });
  const menuSettingDuplicateBtn = element<HTMLButtonElement>("menu-setting-duplicate-btn");
  menuSettingDuplicateBtn.addEventListener("click", () => {
    const menu = state.settings.menus[activeMenuSettingsIndex];
    if (menu) {
      const sourceUid = menu.uid;
      closeMenuSettingsDialog();
      const newUid = state.duplicateMenu(sourceUid);
      collapsedMenuUids.delete(newUid);
      renderMenus();
    }
  }, { signal: scope.signal });
  const menuSettingResetPositionBtn = element<HTMLButtonElement>("menu-setting-reset-position-btn");
  menuSettingResetPositionBtn.addEventListener("click", () => {
    const menu = state.settings.menus[activeMenuSettingsIndex];
    if (menu) void browserActions.resetMenuPosition(menu.uid);
  }, { signal: scope.signal });
  const itemSettingsPopover = element<HTMLDivElement>("item-settings-popover");
  const itemSettingsTitle = element<HTMLSpanElement>("item-settings-title");
  const itemSettingsClose = element<HTMLButtonElement>("item-settings-close");
  const itemSettingsFolderControls = element<HTMLDivElement>("item-settings-folder-controls");
  const itemSettingsBookmarkControls = element<HTMLDivElement>("item-settings-bookmark-controls");
  const itemSettingRename = element<HTMLInputElement>("item-setting-rename");
  const itemSettingCssClass = element<HTMLInputElement>("item-setting-css-class");
  const itemIconPicker = createItemIconPicker(showStatus);
  scope.add(itemIconPicker.destroy);
  const itemSettingClearRename = element<HTMLButtonElement>("item-setting-clear-rename");
  const itemSettingFlatten = element<HTMLInputElement>("item-setting-flatten");
  const itemSettingHoverExpand = element<HTMLInputElement>("item-setting-hover-expand");
  const itemSettingHoverExpandLabel = element<HTMLLabelElement>("item-setting-hover-expand-label");
  const itemSettingIncludeFoldersLabel = element<HTMLLabelElement>(
    "item-setting-include-folders-label",
  );
  const itemSettingIncludeFolders = element<HTMLInputElement>("item-setting-include-folders");
  const itemSettingChangeBtn = element<HTMLButtonElement>("item-setting-change-btn");
  const itemSettingDuplicateBtn = element<HTMLButtonElement>("item-setting-duplicate-btn");
  itemSettingDuplicateBtn.addEventListener(
    "click",
    () => {
      if (!activeItemSettings) return;
      const { menuIndex, itemIndex } = activeItemSettings;
      const menu = state.settings.menus[menuIndex];
      const item = menu?.items[itemIndex];
      if (!menu || !item) return;
      closeItemSettingsPopover();
      state.duplicateMenuItem(menu.uid, item.uid);
      renderMenus();
    },
    { signal: scope.signal },
  );
  const addItemPopover = element<HTMLDivElement>("add-item-popover");
  const addPopoverBookmarkBtn = element<HTMLButtonElement>("add-popover-bookmark-btn");
  addPopoverBookmarkBtn.disabled = itemSettingChangeBtn.disabled = !library.available;
  const addPopoverActionBtn = element<HTMLButtonElement>("add-popover-action-btn");
  const addActionDialog = element<HTMLDialogElement>("add-action-dialog");
  const addActionForm = element<HTMLFormElement>("add-action-form");
  const actionPicker = createItemPicker();
  scope.add(() => actionPicker.destroy());
  const addActionTargets = element<HTMLDivElement>("add-action-targets");
  const addActionClose = element<HTMLButtonElement>("add-action-close");
  const itemSettingsActionTargets = element<HTMLDivElement>("item-settings-action-targets");
  const addPopoverDynamicBtn = element<HTMLButtonElement>("add-popover-dynamic-btn");
  const addPopoverStaticBtn = element<HTMLButtonElement>("add-popover-static-btn");
  const addPopoverTemporaryBtn = element<HTMLButtonElement>("add-popover-temporary-btn");
  const addPopoverExternalActionBtn = element<HTMLButtonElement>("add-popover-external-action-btn");
  const menuSettingUrlRulesList = element<HTMLDivElement>("menu-setting-url-rules-list");
  let activeMenuSettingsIndex = -1;
  let activeItemSettings: { menuIndex: number; itemIndex: number } | null = null;
  let activeItemSettingsBtn: HTMLElement | null = null;
  let activeAddMenuIndex = -1;
  let activeAddBtn: HTMLElement | null = null;

  addMenu.addEventListener(
    "click",
    () => {
      state.addMenu(createMenu());
    },
    { signal: scope.signal },
  );

  function updateMenuColorSwatch(swatch: HTMLElement, menu: ReadonlyData<StoredMenu>): void {
    const color = menu.color;
    updateSwatchAppearance(swatch, color);
    swatch.title = color ? t("menu.colorSwatchSet", { color }) : t("menu.colorSwatchEmpty");
    swatch.setAttribute("aria-label", swatch.title);
  }

  function initMenuSettingsDialog(): void {
    menuSettingsClose.addEventListener("click", () => closeMenuSettingsDialog(), {
      signal: scope.signal,
    });
    menuSettingsDialog.addEventListener(
      "cancel",
      (event) => {
        event.preventDefault();
        closeMenuSettingsDialog();
      },
      { signal: scope.signal },
    );
  }

  function openMenuSettingsDialog(menuIndex: number): void {
    closeAddItemDropdown();
    colorPopoverController.close();
    closeItemSettingsPopover();

    activeMenuSettingsIndex = menuIndex;
    const menu = state.settings.menus[menuIndex];
    if (!menu) return;

    menuSettingsDialogTitle.textContent = t("menu.settingsTitle");
    menuSettingName.value = menu.name ?? "";
    menuSettingName.placeholder = t("menu.title", { n: menuIndex + 1 });
    menuSettingCssClass.value = menu.cssClass ?? "";
    menuSettingStyle.value = menu.style ?? "text";
    renderMenuUrlRulesContent(menu);

    menuSettingsDialog.style.marginTop = "";
    menuSettingsDialog.style.maxHeight = "";
    menuSettingsDialog.showModal();
    const top = menuSettingsDialog.getBoundingClientRect().top;
    menuSettingsDialog.style.marginTop = `${top}px`;
    menuSettingsDialog.style.maxHeight = `min(620px, 85vh, calc(100dvh - ${top}px - 16px))`;
  }

  function closeMenuSettingsDialog(): void {
    if (!menuSettingsDialog.open && activeMenuSettingsIndex < 0) return;
    colorPopoverController.close();
    menuSettingsDialog.close();
    activeMenuSettingsIndex = -1;
    renderMenus();
  }

  function renderMenuUrlRulesContent(menu: ReadonlyData<StoredMenu>): void {
    menuSettingUrlRulesList.replaceChildren();

    const allRow = document.createElement("label");
    allRow.className = "menu-setting-url-rule-item";
    const allRadio = document.createElement("input");
    allRadio.type = "checkbox";
    const hasSpecificSets = Array.isArray(menu.urlRuleUids) && menu.urlRuleUids.length > 0;
    allRadio.checked = !hasSpecificSets;

    const allSpan = document.createElement("span");
    allSpan.textContent = t("urlRules.default");
    allRow.append(allRadio, allSpan);
    menuSettingUrlRulesList.appendChild(allRow);

    allRadio.addEventListener("change", () => {
      state.setMenuRules(
        menu.uid,
        allRadio.checked ? [] : state.settings.urlRules[0] ? [state.settings.urlRules[0].uid] : [],
      );
      renderMenuUrlRulesContent(state.settings.menus.find((value) => value.uid === menu.uid)!);
    });

    if (state.settings.urlRules.length === 0) {
      const hint = document.createElement("div");
      hint.className = "url-rule-empty-hint";
      hint.style.fontSize = "11px";
      hint.style.padding = "6px";
      hint.textContent = t("menuBehavior.noUrlRules");
      menuSettingUrlRulesList.appendChild(hint);
    } else {
      state.settings.urlRules.forEach((ws) => {
        const row = document.createElement("label");
        row.className = "menu-setting-url-rule-item";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = Array.isArray(menu.urlRuleUids) && menu.urlRuleUids.includes(ws.uid);
        cb.addEventListener("change", () => {
          const current =
            state.settings.menus.find((value) => value.uid === menu.uid)!.urlRuleUids ?? [];
          state.setMenuRules(
            menu.uid,
            cb.checked ? [...current, ws.uid] : current.filter((uid) => uid !== ws.uid),
          );
          renderMenuUrlRulesContent(state.settings.menus.find((value) => value.uid === menu.uid)!);
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
    itemSettingsClose.addEventListener("click", () => closeItemSettingsPopover(), {
      signal: scope.signal,
    });
    itemSettingCssClass.addEventListener("input", () => {
      if (!activeItemSettings) return;
      const menu = state.settings.menus[activeItemSettings.menuIndex];
      const item = menu?.items[activeItemSettings.itemIndex];
      if (menu && item) state.setItemCssClass(menu.uid, item.uid, itemSettingCssClass.value);
    }, { signal: scope.signal });

    itemSettingRename.addEventListener(
      "input",
      () => {
        if (!activeItemSettings) return;
        const menu = state.settings.menus[activeItemSettings.menuIndex];
        const item = menu?.items[activeItemSettings.itemIndex];
        if (!item) return;

        const val = itemSettingRename.value.trim();
        if (val) {
          state.editItemBehavior(menu!.uid, item.uid, { rename: val });
        } else {
          state.editItemBehavior(menu!.uid, item.uid, { rename: undefined });
        }
        renderMenus();
      },
      { signal: scope.signal },
    );

    itemSettingClearRename.addEventListener(
      "click",
      () => {
        if (!activeItemSettings) return;
        const menu = state.settings.menus[activeItemSettings.menuIndex];
        const item = menu?.items[activeItemSettings.itemIndex];
        if (!item) return;

        itemSettingRename.value = "";
        state.editItemBehavior(menu!.uid, item.uid, { rename: undefined });
      },
      { signal: scope.signal },
    );

    itemSettingFlatten.addEventListener(
      "change",
      () => {
        if (!activeItemSettings) return;
        const menu = state.settings.menus[activeItemSettings.menuIndex];
        const item = menu?.items[activeItemSettings.itemIndex];
        if (!item) return;

        if (item.type === "staticTag" || item.type === "flattenStaticTag") {
          state.setFolderFlattened(menu!.uid, item.uid, itemSettingFlatten.checked);
          itemSettingHoverExpandLabel.style.display = itemSettingFlatten.checked ? "none" : "inline-flex";
          renderMenus();
          return;
        }

        // Flatten and expand-on-hover are independent: expand-on-hover applies to the
        // sub-folders emitted when "include folders" is on, so toggling flatten must
        // not change the hover checkbox.
        if (itemSettingFlatten.checked) {
          state.setFolderFlattened(menu!.uid, item.uid, true);
          itemSettingIncludeFoldersLabel.style.display = "inline-flex";
          itemSettingIncludeFolders.checked = item.includeFolders === true;
        } else {
          state.setFolderFlattened(menu!.uid, item.uid, false);
          itemSettingIncludeFoldersLabel.style.display = "none";
          itemSettingIncludeFolders.checked = false;
        }
        renderMenus();
      },
      { signal: scope.signal },
    );

    itemSettingIncludeFolders.addEventListener(
      "change",
      () => {
        if (!activeItemSettings) return;
        const menu = state.settings.menus[activeItemSettings.menuIndex];
        const item = menu?.items[activeItemSettings.itemIndex];
        if (!item) return;

        if (itemSettingIncludeFolders.checked) {
          state.editItemBehavior(menu!.uid, item.uid, { includeFolders: true });
        } else {
          state.editItemBehavior(menu!.uid, item.uid, { includeFolders: undefined });
        }
        renderMenus();
      },
      { signal: scope.signal },
    );

    itemSettingHoverExpand.addEventListener(
      "change",
      () => {
        if (!activeItemSettings) return;
        const menu = state.settings.menus[activeItemSettings.menuIndex];
        const item = menu?.items[activeItemSettings.itemIndex];
        if (!item) return;

        // Only controls expand-on-hover; leaves the flatten/include-folders state alone.
        state.editItemBehavior(menu!.uid, item.uid, {
          expandOnHover: itemSettingHoverExpand.checked,
        });
      },
      { signal: scope.signal },
    );

    itemSettingChangeBtn.addEventListener(
      "click",
      () => {
        if (!activeItemSettings) return;
        const { menuIndex, itemIndex } = activeItemSettings;
        const menu = state.settings.menus[menuIndex];
        const item = menu?.items[itemIndex];
        closeItemSettingsPopover();
        if (menu && item && (item.type === "staticTag" || item.type === "flattenStaticTag")) {
          void customBookmarkPicker.pickStaticTag(state.settings.staticBookmarks).then(tag => {
            if (tag !== null && !scope.signal.aborted
              && state.settings.menus.some(value => value.uid === menu.uid && value.items.some(value => value.uid === item.uid)))
              state.setStaticTagSource(menu.uid, item.uid, tag);
          }).catch(error => { if (!scope.signal.aborted) showStatus(String(error)); });
        } else void pickMenuBookmark(menuIndex, itemIndex);
      },
      { signal: scope.signal },
    );

    document.addEventListener(
      "pointerdown",
      (e) => {
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
      },
      { signal: scope.signal },
    );

    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && itemSettingsPopover.style.display !== "none") {
          closeItemSettingsPopover();
        }
      },
      { signal: scope.signal },
    );
  }

  function openItemSettingsPopover(
    menuIndex: number,
    itemIndex: number,
    anchorEl: HTMLElement,
  ): void {
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

    const menu = state.settings.menus[menuIndex];
    const item = menu?.items[itemIndex];
    if (!menu || !item) return;

    activeItemSettings = { menuIndex, itemIndex };
    activeItemSettingsBtn = anchorEl;
    itemSettingCssClass.value = item.cssClass ?? "";

    itemSettingsBookmarkControls.style.display = "block";

    const isMenuFold = item.type === "menuFold";
    const isAction = isMenuFold || item.type === "menusToggle" || item.type === "browserAction" || item.type === "shortcutsToggle" || item.type === "autoHideToggle";
    itemSettingRename.placeholder = t(item.type === "shortcutsToggle" ? "menuAction.shortcutsToggleLabel" : item.type === "autoHideToggle" ? "menuAction.autoHideToggleLabel" : "itemSettings.renamePlaceholder");
    const isDynamic = item.type === "dynamic";
    itemSettingChangeBtn.style.display = isAction || isCustomBookmarkType(item.type) ? "none" : "";
    itemSettingDuplicateBtn.style.display = isMenuFold ? "none" : "";
    const changeActions = itemSettingChangeBtn.parentElement;
    if (changeActions)
      changeActions.style.display = itemSettingChangeBtn.style.display === "none" && itemSettingDuplicateBtn.style.display === "none" ? "none" : "";
    const isTagGroup = item.type === "staticTag" || item.type === "flattenStaticTag";
    itemSettingChangeBtn.disabled = !isTagGroup && !library.available;
    const changeLabel = isTagGroup ? "itemSettings.changeTag" : "itemSettings.change";
    itemSettingChangeBtn.dataset.i18n = changeLabel;
    itemSettingChangeBtn.textContent = t(changeLabel);
    itemSettingsActionTargets.style.display = "none";
    itemSettingHoverExpandLabel.style.display = "inline-flex";

    if (isMenuFold) {
      itemSettingsTitle.textContent = `⇕ ${item.rename || t("menu.foldButton")}`;
      itemSettingRename.value = item.rename ?? "";
      itemSettingsFolderControls.style.display = "none";
      positionPopover(itemSettingsPopover, rect, 250);
      return;
    }

    if (item.type === "menusToggle" || item.type === "browserAction" || item.type === "shortcutsToggle" || item.type === "autoHideToggle") {
      const actionLabel =
        item.type === "menusToggle"
          ? t("menuAction.menusToggle")
          : item.type === "shortcutsToggle"
            ? t("menuAction.shortcutsToggle")
            : item.type === "autoHideToggle"
              ? t("menuAction.autoHideToggle")
              : browserActionLabel(item.browserAction);
      itemSettingsTitle.textContent = item.rename || actionLabel;
      itemSettingRename.value = item.rename ?? "";
      itemSettingsFolderControls.style.display = "none";
      if (item.type === "menusToggle") {
        itemSettingsActionTargets.style.display = "flex";
        renderActionTargetChoices(
          itemSettingsActionTargets,
          menuIndex,
          new Set(item.targetMenuUids ?? []),
          (uids) => {
            state.editItemBehavior(menu.uid, item.uid, { targetMenuUids: uids });
          },
        );
      }
      positionPopover(itemSettingsPopover, rect, 250);
      return;
    }

    if (isDynamic) {
      const db = state.settings.dynamicBookmarks.find((d) => d.uid === item.dynamicUid);
      itemSettingsTitle.textContent = `🜂 ${db?.name || t("dynamic.defaultName")}`;
      itemSettingRename.value = item.rename ?? "";
      itemSettingsFolderControls.style.display = "none";
      positionPopover(itemSettingsPopover, rect, 250);
      return;
    }

    if (item.type === "staticTag" || item.type === "flattenStaticTag") {
      itemSettingsTitle.textContent = `# ${item.staticTag}`;
      itemSettingRename.value = item.rename ?? "";
      itemSettingsFolderControls.style.display = "flex";
      itemSettingFlatten.checked = item.type === "flattenStaticTag";
      itemSettingHoverExpandLabel.style.display = itemSettingFlatten.checked ? "none" : "inline-flex";
      itemSettingHoverExpand.disabled = false;
      itemSettingHoverExpand.checked = item.expandOnHover !== false;
      itemSettingIncludeFoldersLabel.style.display = "none";
      itemSettingIncludeFolders.checked = false;
      positionPopover(itemSettingsPopover, rect, 250);
      return;
    }

    if (item.type === "temporary" || item.type === "static" || item.type === "externalAction") {
      itemSettingsTitle.textContent = `${source.icon(item.type === "static" ? "static" : item.type === "temporary" ? "temporary" : "externalAction")} ${item.rename || source.name(item)}`;
      itemSettingRename.value = item.rename ?? "";
      itemSettingsFolderControls.style.display = "none";
      positionPopover(itemSettingsPopover, rect, 250);
      return;
    }

    const node = library.item(item);
    const isFolderNode = node
      ? node.children !== undefined || node.url === undefined
      : item.type === "folder" || item.type === "flattenFolder";
    const isFolder =
      item.type === "folder" || (!item.type && isFolderNode) || item.type === "flattenFolder";
    const lastSeg =
      item.path && item.path.length > 0 ? item.path[item.path.length - 1] : undefined;
    const rawLabel =
      node?.title ?? (lastSeg ? formatSpecialRootForDisplay(lastSeg, library.tree) : "");
    itemSettingsTitle.textContent = `${isFolder ? "📁" : "🔖"} ${rawLabel.trim()}`;
    itemSettingRename.value = item.rename ?? "";

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

    positionPopover(itemSettingsPopover, rect, 250);
  }

  function closeItemSettingsPopover(): void {
    itemSettingsPopover.style.display = "none";
    activeItemSettings = null;
    activeItemSettingsBtn = null;
  }

  function browserActionLabel(kind: BrowserActionKind | undefined): string {
    const labels = {
      back: "menuAction.back",
      forward: "menuAction.forward",
      reload: "menuAction.reload",
    } as const;
    return kind ? t(labels[kind]) : "";
  }

  function renderActionTargetChoices(
    container: HTMLElement,
    sourceMenuIndex: number,
    selected: Set<string>,
    onChange: (uids: string[]) => void,
  ): void {
    container.replaceChildren();
    const heading = document.createElement("span");
    heading.className = "item-setting-field-title";
    heading.textContent = t("menuAction.targets");
    container.appendChild(heading);
    if (state.settings.menus.length <= 1) {
      const hint = document.createElement("span");
      hint.textContent = t("menuAction.noTargets");
      container.appendChild(hint);
    }
    state.settings.menus.forEach((menu, index) => {
      if (index === sourceMenuIndex) return;
      const label = document.createElement("label");
      label.className = "item-setting-check-label";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(menu.uid);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(menu.uid);
        else selected.delete(menu.uid);
        onChange([...selected]);
      });
      const name = document.createElement("span");
      name.textContent = menu.name ?? t("menu.title", { n: index + 1 });
      label.append(checkbox, name);
      container.appendChild(label);
    });
  }

  function initAddItemPopover(): void {
    let actionMenuUid: string | undefined;
    const selectedTargets = new Set<string>();
    addActionClose.addEventListener("click", () => addActionDialog.close(), {
      signal: scope.signal,
    });
    addActionForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const menu = state.settings.menus.find(menu => menu.uid === actionMenuUid);
        if (!menu) return;
        state.addMenuItem(menu.uid, {
          uid: crypto.randomUUID(), type: "menusToggle", targetMenuUids: [...selectedTargets],
        });
        addActionDialog.close();
        renderMenus();
      },
      { signal: scope.signal },
    );
    addPopoverBookmarkBtn.addEventListener(
      "click",
      () => {
        const menuIdx = activeAddMenuIndex;
        closeAddItemDropdown();
        if (menuIdx >= 0 && menuIdx < state.settings.menus.length) {
          void pickMenuBookmark(menuIdx);
        }
      },
      { signal: scope.signal },
    );

    addPopoverActionBtn.addEventListener(
      "click",
      async () => {
        const sourceMenuUid = state.settings.menus[activeAddMenuIndex]?.uid;
        closeAddItemDropdown();
        if (!sourceMenuUid) return;
        const kind = await actionPicker.pick(t("menu.addAction"), actionChoices());
        if (!kind) return;
        const menuIndex = state.settings.menus.findIndex(menu => menu.uid === sourceMenuUid);
        const menu = state.settings.menus[menuIndex];
        if (!menu) return;
        if (kind === "menusToggle") {
          actionMenuUid = menu.uid;
          selectedTargets.clear();
          renderActionTargetChoices(addActionTargets, menuIndex, selectedTargets, () => {});
          addActionDialog.showModal();
          return;
        }
        if (kind === "menuFold" && menu.items.some(item => item.type === "menuFold")) {
          showStatus(t("menu.menuFoldAlreadyExists"));
          return;
        }
        state.addMenuItem(menu.uid, kind === "menuFold" || kind === "shortcutsToggle" || kind === "autoHideToggle" ? {
          uid: crypto.randomUUID(), type: kind,
        } : {
          uid: crypto.randomUUID(), type: "browserAction", browserAction: kind as BrowserActionKind,
        });
      },
      { signal: scope.signal },
    );

    for (const [button, type] of [
      [addPopoverStaticBtn, "static"],
      [addPopoverTemporaryBtn, "temporary"],
      [addPopoverDynamicBtn, "dynamic"],
      [addPopoverExternalActionBtn, "externalAction"],
    ] as const) {
      button.addEventListener(
        "click",
        () => {
          const menuIdx = activeAddMenuIndex;
          closeAddItemDropdown();
          if (menuIdx < 0 || menuIdx >= state.settings.menus.length) return;
          void pickCustomForMenu(type, menuIdx);
        },
        { signal: scope.signal },
      );
    }

    document.addEventListener(
      "pointerdown",
      (e) => {
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
      },
      { signal: scope.signal },
    );

    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && addItemPopover.style.display !== "none") {
          closeAddItemDropdown();
        }
      },
      { signal: scope.signal },
    );
  }

  function openAddItemDropdown(menuIndex: number, btnElement: HTMLElement): void {
    if (activeAddMenuIndex === menuIndex && addItemPopover.style.display !== "none") {
      closeAddItemDropdown();
      return;
    }
    const rect = btnElement.getBoundingClientRect();
    closeMenuSettingsDialog();
    colorPopoverController.close();
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

  const collapsedMenuUids = new Set<string>();

  function renderMenus(): void {
    menusContainer.replaceChildren(
      ...state.settings.menus.map((menu, menuIndex) => {
        const isCollapsed = collapsedMenuUids.has(menu.uid);
        const card = document.createElement("article");
        card.className = `menu-card${isCollapsed ? " is-collapsed" : ""}`;
        card.dataset.recordId = menu.uid;
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
            colorPopoverController.close();
            if (activeAddMenuIndex === menuIndex) closeAddItemDropdown();
          }
          renderMenus();
        });

        const title = document.createElement("strong");
        title.textContent = menu.name ?? t("menu.title", { n: menuIndex + 1 });

        const toggleLabel = document.createElement("label");
        toggleLabel.className = "switch-toggle";
        toggleLabel.title = isMenuEnabled ? t("menu.disable") : t("menu.enable");
        toggleLabel.setAttribute("aria-label", toggleLabel.title);

        const toggleInput = document.createElement("input");
        toggleInput.type = "checkbox";
        toggleInput.checked = isMenuEnabled;
        toggleInput.addEventListener("change", () => {
          const enabled = toggleInput.checked;
          state.setMenuEnabled(menu.uid, enabled, "immediate");
          card.dataset.enabled = String(enabled);
          toggleLabel.title = enabled ? t("menu.disable") : t("menu.enable");
          toggleLabel.setAttribute("aria-label", toggleLabel.title);
          void persistence
            .saveMenuEnabled(menu.uid, enabled)
            .then((saved) => {
              if (!saved) state.setMenuEnabled(menu.uid, enabled, "withSettings");
            })
            .catch((error: unknown) => {
              state.setMenuEnabled(menu.uid, enabled, "withSettings");
              showStatus(t("status.saveFailed", { error: String(error) }));
            });
        });

        const toggleSlider = document.createElement("span");
        toggleSlider.className = "switch-slider";

        toggleLabel.append(toggleInput, toggleSlider);

        const settingsBtn = document.createElement("button");
        settingsBtn.type = "button";
        settingsBtn.className = "action-btn menu-header-btn";
        setIconContent(settingsBtn, settingsIcon());
        settingsBtn.title = settingsBtn.ariaLabel = t("menu.settingsTitle");
        settingsBtn.addEventListener("click", () => {
          openMenuSettingsDialog(menuIndex);
        });

        const defaultColorBtn = document.createElement("button");
        defaultColorBtn.type = "button";
        defaultColorBtn.className = "item-color-swatch";
        updateMenuColorSwatch(defaultColorBtn, menu);
        defaultColorBtn.addEventListener("click", () => {
          openMenuColor(menu, defaultColorBtn);
        });

        titleRow.append(collapseBtn, title, toggleLabel);

        const headerActions = document.createElement("div");
        headerActions.className = "menu-header-actions";

        const removeMenu = document.createElement("button");
        removeMenu.type = "button";
        removeMenu.className = "remove-item-btn";
        removeMenu.title = t("menu.removeMenu");
        removeMenu.setAttribute("aria-label", t("menu.removeMenu"));
        setIconContent(removeMenu, removeIcon());
        removeMenu.addEventListener("click", () => {
          if (activeMenuSettingsIndex === menuIndex) {
            closeMenuSettingsDialog();
          }
          colorPopoverController.close();
          if (activeAddMenuIndex === menuIndex) {
            closeAddItemDropdown();
          }
          state.removeMenu(menu.uid);
          collapsedMenuUids.delete(menu.uid);
          renderMenus();
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "action-btn menu-header-btn menu-add-btn";
        addBtn.textContent = t("menu.add");
        addBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openAddItemDropdown(menuIndex, addBtn);
        });

        headerActions.append(addBtn, settingsBtn, defaultColorBtn, removeMenu);
        header.append(titleRow, headerActions);

        const items = document.createElement("ol");
        items.replaceChildren(
          ...menu.items.map((item, itemIndex) => {
            const row = document.createElement("li");
            row.className = "menu-item-row";
            row.dataset.recordId = item.uid;

            if (
              item.type === "menuFold" ||
              item.type === "menusToggle" ||
              item.type === "browserAction" ||
              item.type === "shortcutsToggle" ||
              item.type === "autoHideToggle"
            ) {
              const label = document.createElement("span");
              label.className = "item-label";

              const titleSpan = document.createElement("span");
              titleSpan.className = "item-title";
              const actionLabel =
                item.type === "menuFold"
                  ? t("menu.addMenuFold")
                  : item.type === "menusToggle"
                    ? t("menuAction.menusToggle")
                    : item.type === "shortcutsToggle"
                      ? t("menuAction.shortcutsToggle")
                      : item.type === "autoHideToggle"
                        ? t("menuAction.autoHideToggle")
                        : browserActionLabel(item.browserAction);
              titleSpan.textContent = item.rename ? `${item.rename} (${actionLabel})` : actionLabel;
              titleSpan.title = actionLabel;
              label.appendChild(titleSpan);

              const controls = document.createElement("div");
              controls.className = "item-color-controls";

              const moveButtons = createMoveButtons(itemIndex, menu.items.length, step => {
                state.moveMenuItem(menu.uid, itemIndex, itemIndex + step);
              });

              const settingsBtn = document.createElement("button");
              settingsBtn.type = "button";
              settingsBtn.className = "item-settings-btn";
              settingsBtn.title = settingsBtn.ariaLabel = t("itemSettings.title");
              setIconContent(settingsBtn, settingsIcon());
              settingsBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                openItemSettingsPopover(menuIndex, itemIndex, settingsBtn);
              });

              const swatch = document.createElement("button");
              swatch.type = "button";
              swatch.className = `item-color-swatch ${!item.color ? "has-no-color" : ""}`;
              updateSwatchAppearance(swatch, item.color);
              if (!item.color && menu.color) {
                swatch.title = t("item.followMenuColor", { color: menu.color });
              }
              swatch.addEventListener("click", (event) => {
                event.stopPropagation();
                openMenuColor(item, swatch);
              });

              const removeBtn = document.createElement("button");
              removeBtn.type = "button";
              removeBtn.className = "remove-item-btn";
              removeBtn.title = removeBtn.ariaLabel = t("menu.removeItem");
              setIconContent(removeBtn, removeIcon());
              removeBtn.addEventListener("click", () => {
                state.removeMenuItem(menu.uid, item.uid);
              });

              const iconBtn = itemIconPicker.button(item.icon, item.rename || (item.type === "menuFold" ? t("menu.foldButton") : actionLabel),
                icon => state.setItemIcon(menu.uid, item.uid, icon), () => overlays.closeExcept());
              label.prepend(iconBtn);
              controls.append(moveButtons, settingsBtn, swatch, removeBtn);
              row.append(label, controls);
              return row;
            }

            if (isCustomBookmarkType(item.type) || item.type === "staticTag" || item.type === "flattenStaticTag") {
              const isTagGroup = item.type === "staticTag" || item.type === "flattenStaticTag";
              const bookmarkType = isCustomBookmarkType(item.type) ? item.type : "static";
              const rawLabel = isTagGroup ? item.staticTag ?? "" : source.name(item);
              const customRename = item.rename;
              const label = document.createElement("span");
              label.className = "item-label";

              const titleSpan = document.createElement("span");
              titleSpan.className = "item-title";
              if (customRename) {
                titleSpan.textContent = `${customRename} (${rawLabel.trim()})`;
              } else {
                titleSpan.textContent = rawLabel.trim();
              }
              const targetUid = customBookmarkUid(item);
              const liveUrl = targetUid ? source.url(bookmarkType, targetUid) : undefined;
              titleSpan.title = liveUrl ? `${rawLabel.trim()}\n${liveUrl}` : rawLabel.trim();
              const typeIcon = document.createElement("span");
              typeIcon.className = "item-type-icon";
              typeIcon.ariaHidden = "true";
              typeIcon.textContent = isTagGroup ? "#" : source.icon(bookmarkType);
              label.append(titleSpan, typeIcon);

              const dynamicTag = document.createElement("span");
              if (isTagGroup) {
                const flattened = item.type === "flattenStaticTag";
                dynamicTag.className = `item-tag ${flattened ? "item-tag-flatten" : "item-tag-folder"}`;
                dynamicTag.textContent = flattened
                  ? t("item.flattenBadge", { count: state.settings.staticBookmarks.filter(bookmark => bookmark.tags?.includes(rawLabel)).length })
                  : t("item.folderBadge");
              } else {
                dynamicTag.className = "item-tag item-tag-dynamic";
                dynamicTag.textContent = t(
                  item.type === "static"
                    ? "menu.addStatic"
                    : item.type === "temporary"
                      ? "menu.addTemporary"
                      : item.type === "externalAction"
                        ? "section.externalActions"
                        : "section.dynamic",
                );
              }
              label.appendChild(dynamicTag);
              if (isTagGroup) {
                const warning = document.createElement("span");
                warning.className = "reference-warning";
                if (!state.settings.staticBookmarks.some(bookmark => bookmark.tags?.includes(rawLabel))) {
                  warning.textContent = "!";
                  warning.title = warning.ariaLabel = t("static.tagMissing", { tag: rawLabel });
                }
                label.append(warning);
              }

              const controls = document.createElement("div");
              controls.className = "item-color-controls";

              const moveButtons = createMoveButtons(itemIndex, menu.items.length, step => {
                state.moveMenuItem(menu.uid, itemIndex, itemIndex + step);
              });

              const settingsBtn = document.createElement("button");
              settingsBtn.type = "button";
              settingsBtn.className = "item-settings-btn";
              settingsBtn.title = settingsBtn.ariaLabel = t("itemSettings.title");
              setIconContent(settingsBtn, settingsIcon());
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
                openMenuColor(item, swatch);
              });

              const removeBtn = document.createElement("button");
              removeBtn.type = "button";
              removeBtn.className = "remove-item-btn";
              removeBtn.title = removeBtn.ariaLabel = t("menu.removeItem");
              setIconContent(removeBtn, removeIcon());
              removeBtn.addEventListener("click", () => {
                colorPopoverController.close();
                if (
                  activeItemSettings &&
                  activeItemSettings.menuIndex === menuIndex &&
                  activeItemSettings.itemIndex === itemIndex
                ) {
                  closeItemSettingsPopover();
                }
                state.removeMenuItem(menu.uid, item.uid);
              });

              const iconBtn = itemIconPicker.button(item.icon, item.rename || rawLabel,
                icon => state.setItemIcon(menu.uid, item.uid, icon), () => overlays.closeExcept());
              label.prepend(iconBtn);
              controls.append(moveButtons, settingsBtn, swatch, removeBtn);
              row.append(label, controls);
              return row;
            }

            const pathResolution = library.resolve(item);
            const node = pathResolution.node;
            const isFolderNode = node
              ? node.children !== undefined || node.url === undefined
              : item.type === "folder" || item.type === "flattenFolder";
            const isFlatten = item.type === "flattenFolder";
            const isFolder = item.type === "folder" || (!item.type && isFolderNode);
            const label = document.createElement("span");
            label.className = "item-label";

            const lastSeg =
              item.path && item.path.length > 0 ? item.path[item.path.length - 1] : undefined;
            const rawLabel =
              node?.title ?? (lastSeg ? formatSpecialRootForDisplay(lastSeg, library.tree) : "");
            const customRename = item.rename;
            const iconPrefix = isFolderNode ? "📁" : "🔖";
            const titleSpan = document.createElement("span");
            titleSpan.className = "item-title";
            if (customRename) {
              titleSpan.textContent = `${customRename} (${rawLabel.trim()})`;
            } else {
              titleSpan.textContent = rawLabel.trim();
            }
            titleSpan.title = rawLabel.trim();
            const typeIcon = document.createElement("span");
            typeIcon.className = "item-type-icon";
            typeIcon.ariaHidden = "true";
            typeIcon.textContent = iconPrefix;
            label.append(titleSpan, typeIcon);

            if (isFlatten) {
              const badge = document.createElement("span");
              badge.className = "item-tag item-tag-flatten";
              const childCount = node?.children
                ? item.includeFolders
                  ? node.children.length
                  : node.children.filter((c) => c.url !== undefined).length
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

            const controls = document.createElement("div");
            controls.className = "item-color-controls";

            const moveButtons = createMoveButtons(itemIndex, menu.items.length, step => {
              state.moveMenuItem(menu.uid, itemIndex, itemIndex + step);
            });

            // Settings button for item
            const settingsBtn = document.createElement("button");
            settingsBtn.type = "button";
            settingsBtn.className = "item-settings-btn";
            settingsBtn.title = settingsBtn.ariaLabel = t("item.settingsTitle");
            setIconContent(settingsBtn, settingsIcon());
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
              openMenuColor(item, swatch);
            });

            // Centered minus button for remove item
            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "remove-item-btn";
            removeBtn.title = removeBtn.ariaLabel = t("menu.removeItem");
            setIconContent(removeBtn, removeIcon());
            removeBtn.addEventListener("click", () => {
              colorPopoverController.close();
              if (
                activeItemSettings &&
                activeItemSettings.menuIndex === menuIndex &&
                activeItemSettings.itemIndex === itemIndex
              ) {
                closeItemSettingsPopover();
              }
              state.removeMenuItem(menu.uid, item.uid);
            });

            const iconBtn = itemIconPicker.button(item.icon, item.rename || rawLabel,
              icon => state.setItemIcon(menu.uid, item.uid, icon), () => overlays.closeExcept());
            label.prepend(iconBtn);
            controls.append(moveButtons, settingsBtn, swatch, removeBtn);
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

  function openMenuColor(
    target: ReadonlyData<StoredMenu | StoredMenuItem>,
    swatch: HTMLElement,
  ): void {
    const menuUid =
      "items" in target
        ? target.uid
        : state.settings.menus.find((menu) => menu.items.some((item) => item.uid === target.uid))!
            .uid;
    const isMenu = "items" in target;
    const colorId = (field: "color" | "dockColor"): ColorId =>
      isMenu
        ? { kind: "menu", uid: target.uid, field }
        : { kind: "item", menuUid, uid: target.uid };
    const read = () =>
      isMenu
        ? state.settings.menus.find((menu) => menu.uid === target.uid)!
        : state.settings.menus
            .find((menu) => menu.uid === menuUid)!
            .items.find((item) => item.uid === target.uid)!;
    colorPopoverController.open(
      {
        read,
        setColor: (field, color) => state.setColor(colorId(field), color),
        setCycleColors: (colors) => {
          const id = colorId("color");
          if (id.kind !== "item") throw new Error("Not a folder color");
          state.setCycleColors(id, colors);
        },
        field: "color",
        defaultColor: isMenu ? DEFAULT_MENU_COLOR : DEFAULT_COLOR,
        title: isMenu ? t("menuSettings.defaultColor") : t("color.title"),
        ...(isMenu
          ? {
              fields: [
                { field: "color", label: t("menuSettings.defaultColor"), defaultColor: DEFAULT_MENU_COLOR },
                { field: "dockColor", label: t("menuSettings.dockColor"), defaultColor: DEFAULT_DOCK_COLOR },
              ],
            }
          : {}),
        onChange: () => {
          const current = read();
          if ("items" in current) updateMenuColorSwatch(swatch, current);
        },
        onClose: () => {
          colorOpen = false;
          if (activeMenuSettingsIndex < 0 && !activeItemSettings) renderMenus();
        },
      },
      swatch,
    );
    colorOpen = colorPopoverController.isOpen;
  }

  async function pickMenuBookmark(menuIndex: number, itemIndex?: number): Promise<void> {
    const menu = state.settings.menus[menuIndex];
    if (!menu) return;
    const existing = itemIndex === undefined ? undefined : menu.items[itemIndex];
    const node = existing ? library.item(existing) : undefined;
    const result = await bookmarkPicker.pick({
      mode: "item",
      title: existing ? t("picker.changeTitle") : t("picker.addItemTitle", { n: menuIndex + 1 }),
      confirmLabel: existing ? t("picker.apply") : t("picker.addToMenu"),
      ...(node ? { selectedId: node.id } : {}),
      flatten: existing?.type === "flattenFolder",
      expandOnHover: existing?.expandOnHover !== false,
      includeFolders: existing?.includeFolders === true,
      rootPrefix: state.instance.rootPrefix,
    });
    if (!result) return;
    const folder = result.node.url === undefined;
    const source = {
      type: folder ? (result.flattened ? "flattenFolder" : "folder") : "bookmark",
      ...(folder ? { expandOnHover: result.expandOnHover } : {}),
      ...(folder && result.flattened && result.includeFolders ? { includeFolders: true } : {}),
      ...(result.relativePath !== undefined ? { path: result.relativePath } : {}),
      ...(result.node.url ? { url: result.node.url } : {}),
    };
    if (existing) state.replaceBookmarkSource(menu.uid, existing.uid, source);
    else state.addMenuItem(menu.uid, { uid: crypto.randomUUID(), ...source });
  }

  async function pickCustomForMenu(type: CustomBookmarkType, menuIndex: number): Promise<void> {
    const menu = state.settings.menus[menuIndex];
    if (!menu) return;
    const definitions = source.definitions(type);
    if (!definitions.length) {
      showStatus(t("customBookmarks.noneCreated"));
      return;
    }
    const choices = definitions.map((value) => ({
      uid: value.uid,
      name: value.name,
      ...(source.url(type, value.uid) ? { url: source.url(type, value.uid)! } : {}),
      ...(type === "static" && "tags" in value ? { tags: value.tags } : {}),
    }));
    const reference = type === "static" ? await customBookmarkPicker.pickStaticForMenu(choices) :
      await customBookmarkPicker.pick(type, choices).then(uid => uid ? customBookmarkReference(type, uid) : null);
    if (reference) {
      state.addMenuItem(menu.uid, {
        uid: crypto.randomUUID(),
        ...reference,
      });
      showStatus(t("dynamic.addedToMenu", { menu: menu.name ?? t("menu.title", { n: menuIndex + 1 }) }));
    }
  }
  scope.add(overlays.register("menuSettings", closeMenuSettingsDialog));
  scope.add(overlays.register("itemSettings", closeItemSettingsPopover));
  scope.add(overlays.register("itemIcon", itemIconPicker.close));
  scope.add(overlays.register("addItem", closeAddItemDropdown));
  const render = () => renderPreservingFocus(menusContainer, renderMenus);
  scope.add(
    state.subscribe(["menus", "rules", "bookmarks", "instance"], (change) => {
      if (!colorOpen && !menuSettingsDialog.open && !cssEditor.isOpen) render();
      if (change.structural) {
        closeItemSettingsPopover();
        closeAddItemDropdown();
      }
    }),
  );
  initMenuSettingsDialog();
  initItemSettingsPopover();
  initAddItemPopover();
  render();
  return {
    render,
    destroy(): void {
      closeMenuSettingsDialog();
      closeItemSettingsPopover();
      closeAddItemDropdown();
      addActionDialog.close();
      scope.destroy();
      menusContainer.replaceChildren();
      menuSettingUrlRulesList.replaceChildren();
      itemSettingsActionTargets.replaceChildren();
      addActionTargets.replaceChildren();
    },
  };
}
