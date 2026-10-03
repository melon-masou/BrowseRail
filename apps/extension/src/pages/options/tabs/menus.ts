import {
  type AttachmentMode,
  AUTO_FONT_SIZE,
  DEFAULT_DOCK_COLOR,
  type BrowserActionKind,
  isAutoFontSize,
  type MenuOrientation,
  type OnTopMode,
  type CustomBookmarkType,
  customBookmarkUid,
  customBookmarkReference,
  isCustomBookmarkType,
} from "@browserail/protocol";
import {
  createMenu,
  DEFAULT_FONT_SIZE,
  normalizeFontSize,
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

import { type Overlays } from "../components/overlays";
import { SETTINGS_ICON_SVG } from "../components/icons";
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
  const menuSettingsTabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".menu-settings-tab"),
  );
  const menuSettingOrientation = element<HTMLSelectElement>("menu-setting-orientation");
  const menuSettingExpandDirection = element<HTMLSelectElement>("menu-setting-expand-direction");
  const menuSettingExpandAlignment = element<HTMLSelectElement>("menu-setting-expand-alignment");
  const menuSettingFontSize = element<HTMLInputElement>("menu-setting-font-size");
  const menuSettingFontSizeAuto = element<HTMLInputElement>("menu-setting-font-size-auto");
  const menuSettingPopupFontSize = element<HTMLInputElement>("menu-setting-popup-font-size");
  const menuSettingDefaultColor = element<HTMLButtonElement>("menu-setting-default-color");
  const menuSettingDockColor = element<HTMLButtonElement>("menu-setting-dock-color");
  const menuSettingAttachmentMode = element<HTMLSelectElement>("menu-setting-attachment-mode");
  const menuSettingOnTopMode = element<HTMLSelectElement>("menu-setting-on-top-mode");
  const menuSettingTabMode = element<HTMLSelectElement>("menu-setting-tab-mode");
  const itemSettingsPopover = element<HTMLDivElement>("item-settings-popover");
  const itemSettingsTitle = element<HTMLSpanElement>("item-settings-title");
  const itemSettingsClose = element<HTMLButtonElement>("item-settings-close");
  const itemSettingsFolderControls = element<HTMLDivElement>("item-settings-folder-controls");
  const itemSettingsBookmarkControls = element<HTMLDivElement>("item-settings-bookmark-controls");
  const itemSettingRename = element<HTMLInputElement>("item-setting-rename");
  const itemSettingClearRename = element<HTMLButtonElement>("item-setting-clear-rename");
  const itemSettingTabMode = element<HTMLSelectElement>("item-setting-tab-mode");
  const itemSettingFlatten = element<HTMLInputElement>("item-setting-flatten");
  const itemSettingHoverExpand = element<HTMLInputElement>("item-setting-hover-expand");
  const itemSettingIncludeFoldersLabel = element<HTMLLabelElement>(
    "item-setting-include-folders-label",
  );
  const itemSettingIncludeFolders = element<HTMLInputElement>("item-setting-include-folders");
  const itemSettingsDynamicControls = element<HTMLDivElement>("item-settings-dynamic-controls");
  const itemSettingDynamicShowPageTitle = element<HTMLInputElement>(
    "item-setting-dynamic-show-page-title",
  );
  const itemSettingChangeBtn = element<HTMLButtonElement>("item-setting-change-btn");
  const addItemPopover = element<HTMLDivElement>("add-item-popover");
  const addPopoverBookmarkBtn = element<HTMLButtonElement>("add-popover-bookmark-btn");
  const addPopoverActionBtn = element<HTMLButtonElement>("add-popover-action-btn");
  const addActionDialog = element<HTMLDialogElement>("add-action-dialog");
  const addActionForm = element<HTMLFormElement>("add-action-form");
  const addActionKind = element<HTMLSelectElement>("add-action-kind");
  const addActionTargets = element<HTMLDivElement>("add-action-targets");
  const addActionClose = element<HTMLButtonElement>("add-action-close");
  const addActionError = element<HTMLOutputElement>("add-action-error");
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

  function updateMenuSettingColorControls(menu: ReadonlyData<StoredMenu>): void {
    updateSwatchAppearance(menuSettingDefaultColor, menu.color);
    menuSettingDefaultColor.title = menu.color
      ? t("menu.colorSwatchSet", { color: menu.color })
      : t("menu.colorSwatchEmpty");
    menuSettingDefaultColor.setAttribute("aria-label", menuSettingDefaultColor.title);

    updateSwatchAppearance(menuSettingDockColor, menu.dockColor);
    menuSettingDockColor.title = menu.dockColor
      ? t("menu.dockColorSwatchSet", { color: menu.dockColor })
      : t("menu.dockColorSwatchEmpty");
    menuSettingDockColor.setAttribute("aria-label", menuSettingDockColor.title);
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

    menuSettingsTabs.forEach((tab) => {
      tab.addEventListener(
        "click",
        () => {
          const panel = document.getElementById(tab.getAttribute("aria-controls") || "");
          if (!panel) return;
          menuSettingsTabs.forEach((candidate) => {
            const candidatePanel = document.getElementById(
              candidate.getAttribute("aria-controls") || "",
            );
            const selected = candidate === tab;
            candidate.classList.toggle("is-active", selected);
            candidate.setAttribute("aria-selected", String(selected));
            if (candidatePanel) candidatePanel.hidden = !selected;
          });
        },
        { signal: scope.signal },
      );
    });

    menuSettingDefaultColor.addEventListener(
      "click",
      () => {
        const menu = state.settings.menus[activeMenuSettingsIndex];
        if (menu) openMenuColor(menu, menuSettingDefaultColor, "color");
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

    menuSettingOrientation.addEventListener(
      "change",
      () => {
        const menu = state.settings.menus[activeMenuSettingsIndex];
        if (menu) {
          state.editMenuAppearance(menu.uid, {
            orientation: menuSettingOrientation.value as MenuOrientation,
          });
        }
      },
      { signal: scope.signal },
    );

    menuSettingExpandDirection.addEventListener(
      "change",
      () => {
        const menu = state.settings.menus[activeMenuSettingsIndex];
        if (menu) {
          const val = menuSettingExpandDirection.value;
          if (val === "down" || val === "up" || val === "right" || val === "left") {
            state.editMenuAppearance(menu.uid, { expandDirection: val });
          } else {
            state.editMenuAppearance(menu.uid, { expandDirection: undefined });
          }
        }
      },
      { signal: scope.signal },
    );

    menuSettingExpandAlignment.addEventListener(
      "change",
      () => {
        const menu = state.settings.menus[activeMenuSettingsIndex];
        if (menu) {
          state.editMenuAppearance(menu.uid, {
            expandAlignment: menuSettingExpandAlignment.value === "center" ? "center" : "edge",
          });
        }
      },
      { signal: scope.signal },
    );

    menuSettingFontSize.addEventListener(
      "input",
      () => {
        const menu = state.settings.menus[activeMenuSettingsIndex];
        const val = parseInt(menuSettingFontSize.value, 10);
        if (menu && !menuSettingFontSizeAuto.checked && !isNaN(val)) {
          state.editMenuAppearance(menu.uid, { buttonFontSize: val });
        }
      },
      { signal: scope.signal },
    );

    menuSettingFontSizeAuto.addEventListener(
      "change",
      () => {
        const menu = state.settings.menus[activeMenuSettingsIndex];
        if (!menu) return;
        if (menuSettingFontSizeAuto.checked) {
          state.editMenuAppearance(menu.uid, { buttonFontSize: AUTO_FONT_SIZE });
          menuSettingFontSize.disabled = true;
        } else {
          const val = parseInt(menuSettingFontSize.value, 10);
          state.editMenuAppearance(menu.uid, {
            buttonFontSize: !isNaN(val) ? val : DEFAULT_FONT_SIZE,
          });
          menuSettingFontSize.disabled = false;
        }
      },
      { signal: scope.signal },
    );

    menuSettingPopupFontSize.addEventListener(
      "input",
      () => {
        const menu = state.settings.menus[activeMenuSettingsIndex];
        const val = parseInt(menuSettingPopupFontSize.value, 10);
        if (menu && !isNaN(val)) {
          state.editMenuAppearance(menu.uid, { popupFontSize: val });
        }
      },
      { signal: scope.signal },
    );

    menuSettingAttachmentMode.addEventListener(
      "change",
      () => {
        const menu = state.settings.menus[activeMenuSettingsIndex];
        if (menu) {
          state.editMenuBehavior(menu.uid, {
            attachmentMode: menuSettingAttachmentMode.value as AttachmentMode,
          });
          if (menuSettingAttachmentMode.value === "free") {
            menuSettingOnTopMode.value = "alwaysOnTop";
          }
          menuSettingOnTopMode.disabled = menuSettingAttachmentMode.value === "free";
        }
      },
      { signal: scope.signal },
    );

    menuSettingOnTopMode.addEventListener(
      "change",
      () => {
        const menu = state.settings.menus[activeMenuSettingsIndex];
        if (menu && menu.attachmentMode !== "free") {
          state.editMenuBehavior(menu.uid, { onTopMode: menuSettingOnTopMode.value as OnTopMode });
        }
      },
      { signal: scope.signal },
    );

    menuSettingTabMode.addEventListener(
      "change",
      () => {
        const menu = state.settings.menus[activeMenuSettingsIndex];
        if (menu) {
          state.editMenuBehavior(menu.uid, {
            tabMode: menuSettingTabMode.value === "newTab" ? "newTab" : "replace",
          });
        }
      },
      { signal: scope.signal },
    );
  }

  function openMenuSettingsDialog(menuIndex: number, tab = 0): void {
    closeAddItemDropdown();
    colorPopoverController.close();
    closeItemSettingsPopover();

    activeMenuSettingsIndex = menuIndex;
    const menu = state.settings.menus[menuIndex];
    if (!menu) return;

    const barFontAuto = isAutoFontSize(menu.buttonFontSize);
    // Auto has no px value, so show the default in the (disabled) number field.
    const barFs =
      menu.buttonFontSize !== undefined && !barFontAuto
        ? normalizeFontSize(menu.buttonFontSize)
        : DEFAULT_FONT_SIZE;
    const popupFs =
      menu.popupFontSize !== undefined ? normalizeFontSize(menu.popupFontSize) : DEFAULT_FONT_SIZE;
    menuSettingsDialogTitle.textContent = t("menu.settingsTitle");
    menuSettingOrientation.value = menu.orientation;
    menuSettingExpandDirection.value = menu.expandDirection ?? "";
    menuSettingExpandAlignment.value = menu.expandAlignment ?? "edge";
    menuSettingFontSize.value = String(barFs);
    menuSettingFontSizeAuto.checked = barFontAuto;
    menuSettingFontSize.disabled = barFontAuto;
    menuSettingPopupFontSize.value = String(popupFs);
    updateMenuSettingColorControls(menu);
    menuSettingAttachmentMode.value = menu.attachmentMode ?? "lastFocused";
    const isFree = menuSettingAttachmentMode.value === "free";
    menuSettingOnTopMode.value = isFree ? "alwaysOnTop" : (menu.onTopMode ?? "aboveBrowser");
    menuSettingOnTopMode.disabled = isFree;
    menuSettingTabMode.value = menu.tabMode ?? "replace";
    renderMenuUrlRulesContent(menu);

    const tabButton = menuSettingsTabs[tab];
    if (tabButton) tabButton.click();
    menuSettingsDialog.style.marginTop = "";
    menuSettingsDialog.style.maxHeight = "";
    menuSettingsDialog.showModal();
    const top = menuSettingsDialog.getBoundingClientRect().top;
    menuSettingsDialog.style.marginTop = `${top}px`;
    menuSettingsDialog.style.maxHeight = `min(620px, 85vh, calc(100dvh - ${top}px - 16px))`;
  }

  function closeMenuSettingsDialog(): void {
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

    itemSettingTabMode.addEventListener(
      "change",
      () => {
        if (!activeItemSettings) return;
        const menu = state.settings.menus[activeItemSettings.menuIndex];
        const item = menu?.items[activeItemSettings.itemIndex];
        if (!item) return;

        const val = itemSettingTabMode.value;
        if (val === "newTab" || val === "replace") {
          state.editItemBehavior(menu!.uid, item.uid, { tabMode: val });
        } else {
          state.editItemBehavior(menu!.uid, item.uid, { tabMode: undefined });
        }
        renderMenus();
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

    itemSettingDynamicShowPageTitle.addEventListener(
      "change",
      () => {
        if (!activeItemSettings) return;
        const menu = state.settings.menus[activeItemSettings.menuIndex];
        const item = menu?.items[activeItemSettings.itemIndex];
        if (!item || item.type !== "dynamic") return;

        if (itemSettingDynamicShowPageTitle.checked) {
          state.editItemBehavior(menu!.uid, item.uid, { showPageTitle: true });
        } else {
          state.editItemBehavior(menu!.uid, item.uid, { showPageTitle: undefined });
        }
        renderMenus();
      },
      { signal: scope.signal },
    );

    itemSettingChangeBtn.addEventListener(
      "click",
      () => {
        if (!activeItemSettings) return;
        const { menuIndex, itemIndex } = activeItemSettings;
        closeItemSettingsPopover();
        void pickMenuBookmark(menuIndex, itemIndex);
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
    const isAction = isMenuFold || item.type === "menusToggle" || item.type === "browserAction";
    const isDynamic = item.type === "dynamic";
    const tabModeField = itemSettingTabMode.parentElement;
    const changeActions = itemSettingChangeBtn.parentElement;
    if (tabModeField) tabModeField.style.display = isAction ? "none" : "";
    if (changeActions)
      changeActions.style.display = isAction || isCustomBookmarkType(item.type) ? "none" : "";
    itemSettingsActionTargets.style.display = "none";

    if (isMenuFold) {
      itemSettingsTitle.textContent = `⇕ ${item.rename || t("menu.foldButton")}`;
      itemSettingRename.value = item.rename ?? "";
      itemSettingsFolderControls.style.display = "none";
      itemSettingsDynamicControls.style.display = "none";
      positionPopover(itemSettingsPopover, rect, 250);
      return;
    }

    if (item.type === "menusToggle" || item.type === "browserAction") {
      const actionLabel =
        item.type === "menusToggle"
          ? t("menuAction.menusToggle")
          : browserActionLabel(item.browserAction);
      itemSettingsTitle.textContent = item.rename || actionLabel;
      itemSettingRename.value = item.rename ?? "";
      itemSettingsFolderControls.style.display = "none";
      itemSettingsDynamicControls.style.display = "none";
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
      itemSettingTabMode.value = item.tabMode ?? "";
      itemSettingsFolderControls.style.display = "none";
      itemSettingsDynamicControls.style.display = "block";
      itemSettingDynamicShowPageTitle.checked = item.showPageTitle === true;
      positionPopover(itemSettingsPopover, rect, 250);
      return;
    }

    if (item.type === "temporary" || item.type === "static") {
      itemSettingsTitle.textContent = `${source.icon(item.type === "static" ? "static" : "temporary")} ${item.rename || source.name(item)}`;
      itemSettingRename.value = item.rename ?? "";
      itemSettingTabMode.value = item.tabMode ?? "";
      itemSettingsFolderControls.style.display = "none";
      itemSettingsDynamicControls.style.display = "none";
      positionPopover(itemSettingsPopover, rect, 250);
      return;
    }

    itemSettingsDynamicControls.style.display = "none";

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
    let actionMenuIndex = -1;
    const selectedTargets = new Set<string>();
    addActionClose.addEventListener("click", () => addActionDialog.close(), {
      signal: scope.signal,
    });
    addActionKind.addEventListener(
      "change",
      () => {
        addActionTargets.style.display = addActionKind.value === "menusToggle" ? "flex" : "none";
        addActionError.value = "";
      },
      { signal: scope.signal },
    );
    addActionForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const menu = state.settings.menus[actionMenuIndex];
        if (!menu) return;
        const kind = addActionKind.value;
        if (kind === "menuFold" && menu.items.some((item) => item.type === "menuFold")) {
          addActionError.value = t("menu.menuFoldAlreadyExists");
          return;
        }
        const item: StoredMenuItem =
          kind === "menuFold"
            ? { uid: crypto.randomUUID(), type: "menuFold" }
            : kind === "menusToggle"
              ? {
                  uid: crypto.randomUUID(),
                  type: "menusToggle",
                  targetMenuUids: [...selectedTargets],
                }
              : {
                  uid: crypto.randomUUID(),
                  type: "browserAction",
                  browserAction: kind as BrowserActionKind,
                };
        state.addMenuItem(menu.uid, item);
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
      () => {
        actionMenuIndex = activeAddMenuIndex;
        closeAddItemDropdown();
        if (actionMenuIndex < 0 || actionMenuIndex >= state.settings.menus.length) return;
        selectedTargets.clear();
        addActionError.value = "";
        addActionKind.value = "back";
        addActionTargets.style.display = "none";
        renderActionTargetChoices(addActionTargets, actionMenuIndex, selectedTargets, () => {
          addActionError.value = "";
        });
        addActionDialog.showModal();
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
        removeMenu.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg><span>${t("menu.remove")}</span>`;
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

        headerActions.append(settingsBtn, removeMenu, addBtn);
        header.append(titleRow, headerActions);

        const items = document.createElement("ol");
        items.replaceChildren(
          ...menu.items.map((item, itemIndex) => {
            const row = document.createElement("li");
            row.className = "menu-item-row";

            if (
              item.type === "menuFold" ||
              item.type === "menusToggle" ||
              item.type === "browserAction"
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
              settingsBtn.innerHTML = SETTINGS_ICON_SVG;
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

            if (isCustomBookmarkType(item.type)) {
              const rawLabel = source.name(item);
              const customRename = item.rename;
              const label = document.createElement("span");
              label.className = "item-label";

              const titleSpan = document.createElement("span");
              titleSpan.className = "item-title";
              if (customRename) {
                titleSpan.textContent = `${customRename} (${rawLabel.trim()})`;
              } else {
                titleSpan.textContent = `${source.icon(item.type)} ${rawLabel.trim()}`;
              }
              const targetUid = customBookmarkUid(item);
              const liveUrl = targetUid ? source.url(item.type, targetUid) : undefined;
              titleSpan.title = liveUrl ? `${rawLabel.trim()}\n${liveUrl}` : rawLabel.trim();
              label.appendChild(titleSpan);

              const dynamicTag = document.createElement("span");
              dynamicTag.className = "item-tag item-tag-dynamic";
              dynamicTag.textContent = t(
                item.type === "static"
                  ? "menu.addStatic"
                  : item.type === "temporary"
                    ? "menu.addTemporary"
                    : "section.dynamic",
              );
              label.appendChild(dynamicTag);

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
            : DEFAULT_COLOR,
        title:
          field === "dockColor"
            ? t("menuSettings.dockColor")
            : "items" in target
              ? t("menuSettings.defaultColor")
              : t("color.title"),
        onChange: () => {
          const menu = state.settings.menus[activeMenuSettingsIndex];
          if (menu) updateMenuSettingColorControls(menu);
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
    const uid = await customBookmarkPicker.pick(
      type,
      definitions.map((value) => ({
        uid: value.uid,
        name: value.name,
        ...(source.url(type, value.uid) ? { url: source.url(type, value.uid)! } : {}),
      })),
    );
    if (uid) {
      state.addMenuItem(menu.uid, {
        uid: crypto.randomUUID(),
        ...customBookmarkReference(type, uid),
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
