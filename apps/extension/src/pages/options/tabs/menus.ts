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
} from "../../../config";
import { formatSpecialRootForDisplay } from "../../../bookmarks";
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
  const menuSettingsDialog = element<HTMLDialogElement>("menu-settings-dialog");
  const menuSettingsDialogTitle = element<HTMLSpanElement>("menu-settings-dialog-title");
  const menuSettingsClose = element<HTMLButtonElement>("menu-settings-close");
  const menuSettingDockColor = element<HTMLButtonElement>("menu-setting-dock-color");
  const itemSettingsPopover = element<HTMLDivElement>("item-settings-popover");
  const itemSettingsTitle = element<HTMLSpanElement>("item-settings-title");
  const itemSettingsClose = element<HTMLButtonElement>("item-settings-close");
  const itemSettingsFolderControls = element<HTMLDivElement>("item-settings-folder-controls");
  const itemSettingsBookmarkControls = element<HTMLDivElement>("item-settings-bookmark-controls");
  const itemSettingRename = element<HTMLInputElement>("item-setting-rename");
  const itemSettingClearRename = element<HTMLButtonElement>("item-setting-clear-rename");
  const itemSettingFlatten = element<HTMLInputElement>("item-setting-flatten");
  const itemSettingHoverExpand = element<HTMLInputElement>("item-setting-hover-expand");
  const itemSettingHoverExpandLabel = element<HTMLLabelElement>("item-setting-hover-expand-label");
  const itemSettingIncludeFoldersLabel = element<HTMLLabelElement>(
    "item-setting-include-folders-label",
  );
  const itemSettingIncludeFolders = element<HTMLInputElement>("item-setting-include-folders");
  const itemSettingChangeBtn = element<HTMLButtonElement>("item-setting-change-btn");
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

  function updateMenuColorSwatch(swatch: HTMLElement, menu: ReadonlyData<StoredMenu>, field: "color" | "dockColor"): void {
    const color = menu[field];
    updateSwatchAppearance(swatch, color);
    swatch.title = field === "dockColor"
      ? color ? t("menu.dockColorSwatchSet", { color }) : t("menu.dockColorSwatchEmpty")
      : color ? t("menu.colorSwatchSet", { color }) : t("menu.colorSwatchEmpty");
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

    menuSettingDockColor.addEventListener(
      "click",
      () => {
        const menu = state.settings.menus[activeMenuSettingsIndex];
        if (menu) openMenuColor(menu, menuSettingDockColor, "dockColor");
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
    updateMenuColorSwatch(menuSettingDockColor, menu, "dockColor");
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

    itemSettingsBookmarkControls.style.display = "block";

    const isMenuFold = item.type === "menuFold";
    const isAction = isMenuFold || item.type === "menusToggle" || item.type === "browserAction" || item.type === "shortcutsToggle";
    itemSettingRename.placeholder = t(item.type === "shortcutsToggle" ? "menuAction.shortcutsToggleLabel" : "itemSettings.renamePlaceholder");
    const isDynamic = item.type === "dynamic";
    const changeActions = itemSettingChangeBtn.parentElement;
    if (changeActions)
      changeActions.style.display = isAction || isCustomBookmarkType(item.type) ? "none" : "";
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

    if (item.type === "menusToggle" || item.type === "browserAction" || item.type === "shortcutsToggle") {
      const actionLabel =
        item.type === "menusToggle"
          ? t("menuAction.menusToggle")
          : item.type === "shortcutsToggle"
            ? t("menuAction.shortcutsToggle")
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

    if (item.type === "temporary" || item.type === "static") {
      itemSettingsTitle.textContent = `${source.icon(item.type === "static" ? "static" : "temporary")} ${item.rename || source.name(item)}`;
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
      name.textContent = t("menu.title", { n: index + 1 });
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
        state.addMenuItem(menu.uid, kind === "menuFold" || kind === "shortcutsToggle" ? {
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

  let draggingItem: { menuIndex: number; itemIndex: number } | null = null;
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
        setIconContent(settingsBtn, settingsIcon(), t("menu.settings"));
        settingsBtn.title = t("menu.settingsTitle");
        settingsBtn.addEventListener("click", () => {
          openMenuSettingsDialog(menuIndex);
        });

        const defaultColorBtn = document.createElement("button");
        defaultColorBtn.type = "button";
        defaultColorBtn.className = "item-color-swatch";
        updateMenuColorSwatch(defaultColorBtn, menu, "color");
        defaultColorBtn.addEventListener("click", () => {
          openMenuColor(menu, defaultColorBtn, "color");
        });

        const resetPositionBtn = document.createElement("button");
        resetPositionBtn.type = "button";
        resetPositionBtn.className = "action-btn menu-header-btn";
        resetPositionBtn.textContent = t("menu.resetPosition");
        resetPositionBtn.title = t("menu.resetPositionTitle");
        resetPositionBtn.addEventListener("click", () => {
          void browserActions.resetMenuPosition(menu.uid);
        });

        titleRow.append(collapseBtn, title, toggleLabel, resetPositionBtn);

        const headerActions = document.createElement("div");
        headerActions.className = "menu-header-actions";

        const removeMenu = document.createElement("button");
        removeMenu.type = "button";
        removeMenu.className = "remove-item-btn menu-remove-btn";
        removeMenu.title = t("menu.removeMenu");
        removeMenu.setAttribute("aria-label", t("menu.removeMenu"));
        setIconContent(removeMenu, removeIcon(), t("menu.remove"));
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

        headerActions.append(defaultColorBtn, settingsBtn, removeMenu, addBtn);
        header.append(titleRow, headerActions);

        const items = document.createElement("ol");
        items.replaceChildren(
          ...menu.items.map((item, itemIndex) => {
            const row = document.createElement("li");
            row.className = "menu-item-row";

            if (
              item.type === "menuFold" ||
              item.type === "menusToggle" ||
              item.type === "browserAction" ||
              item.type === "shortcutsToggle"
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
                      : browserActionLabel(item.browserAction);
              titleSpan.textContent = item.rename ? `${item.rename} (${actionLabel})` : actionLabel;
              titleSpan.title = actionLabel;
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
                  state.moveMenuItem(menu.uid, sourceIndex, targetIndex);
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
              removeBtn.title = t("menu.removeItem");
              removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg>`;
              removeBtn.addEventListener("click", () => {
                state.removeMenuItem(menu.uid, item.uid);
              });

              controls.append(dragHandleBtn, settingsBtn, swatch, removeBtn);
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
                titleSpan.textContent = `${isTagGroup ? "#" : source.icon(bookmarkType)} ${rawLabel.trim()}`;
              }
              const targetUid = customBookmarkUid(item);
              const liveUrl = targetUid ? source.url(bookmarkType, targetUid) : undefined;
              titleSpan.title = liveUrl ? `${rawLabel.trim()}\n${liveUrl}` : rawLabel.trim();
              label.appendChild(titleSpan);

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
                  state.moveMenuItem(menu.uid, sourceIndex, targetIndex);
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
              removeBtn.title = t("menu.removeItem");
              removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg>`;
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

              controls.append(dragHandleBtn, settingsBtn, swatch, removeBtn);
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
              titleSpan.textContent = `${iconPrefix} ${rawLabel.trim()}`;
            }
            titleSpan.title = rawLabel.trim();
            label.appendChild(titleSpan);

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
                state.moveMenuItem(menu.uid, sourceIndex, targetIndex);
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
            removeBtn.title = t("menu.removeItem");
            removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg>`;
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

  function openMenuColor(
    target: ReadonlyData<StoredMenu | StoredMenuItem>,
    swatch: HTMLElement,
    field: "color" | "dockColor" = "color",
  ): void {
    const menuUid =
      "items" in target
        ? target.uid
        : state.settings.menus.find((menu) => menu.items.some((item) => item.uid === target.uid))!
            .uid;
    const id: ColorId =
      "items" in target
        ? { kind: "menu", uid: target.uid, field }
        : { kind: "item", menuUid, uid: target.uid };
    const read = () =>
      id.kind === "menu"
        ? state.settings.menus.find((menu) => menu.uid === id.uid)!
        : state.settings.menus
            .find((menu) => menu.uid === id.menuUid)!
            .items.find((item) => item.uid === id.uid)!;
    colorPopoverController.open(
      {
        read,
        setColor: (color) => state.setColor(id, color),
        setCycleColors: (colors) => {
          if (id.kind !== "item") throw new Error("Not a folder color");
          state.setCycleColors(id, colors);
        },
        field,
        defaultColor:
          field === "dockColor"
            ? DEFAULT_DOCK_COLOR
            : "items" in target
              ? DEFAULT_MENU_COLOR
              : DEFAULT_COLOR,
        title:
          field === "dockColor"
            ? t("menuSettings.dockColor")
            : "items" in target
              ? t("menuSettings.defaultColor")
              : t("color.title"),
        onChange: () => {
          const current = read();
          if ("items" in current) updateMenuColorSwatch(swatch, current, field);
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
      showStatus(t("dynamic.addedToMenu", { menu: t("menu.title", { n: menuIndex + 1 }) }));
    }
  }
  scope.add(overlays.register("menuSettings", closeMenuSettingsDialog));
  scope.add(overlays.register("itemSettings", closeItemSettingsPopover));
  scope.add(overlays.register("addItem", closeAddItemDropdown));
  const render = () => renderPreservingFocus(menusContainer, renderMenus);
  scope.add(
    state.subscribe(["menus", "rules", "bookmarks", "instance"], (change) => {
      if (!colorOpen && !menuSettingsDialog.open) render();
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
