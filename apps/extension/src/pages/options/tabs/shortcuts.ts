import {
  type TabMode,
  type CustomBookmarkType,
  customBookmarkUid,
  isCustomBookmarkType,
} from "@browserail/protocol";
import browser from "webextension-polyfill";
import { type StoredShortcut, type StoredNativeShortcut } from "../../../config";
import { type BookmarkNode, combineRootAndItemPath, findBookmarkNodeByPath } from "../../../bookmarks";
import { t } from "@browserail/i18n";
import { positionPopover } from "../components/popover-position";
import { type ReadonlyData, type OptionsState } from "../state";
import { element } from "../dom";
import { createScope } from "../lifecycle";
import { type BookmarkLibrary } from "../bookmark-library";
import { type CustomBookmarkSource } from "../custom-bookmark-source";
import { type BookmarkPicker } from "../components/bookmark-picker";
import { type CustomBookmarkPicker } from "../components/custom-bookmark-picker";
import { type Overlays } from "../components/overlays";
import { removeIcon, setIconContent, settingsIcon } from "../components/icons";
import { browserActions } from "../browser";

export function mountShortcutsTab(
  state: OptionsState,
  library: BookmarkLibrary,
  source: CustomBookmarkSource,
  bookmarkPicker: BookmarkPicker,
  customBookmarkPicker: CustomBookmarkPicker,
  overlays: Overlays,
  showStatus: (message: string) => void,
) {
  const scope = createScope();
  const shortcutsList = element<HTMLDivElement>("shortcuts-list");
  const configureBrowserShortcutsBtn = element<HTMLButtonElement>(
    "configure-browser-shortcuts-btn",
  );
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
  const shortcutPickPopover = element<HTMLDivElement>("shortcut-pick-popover");
  const shortcutPickBookmarkBtn = element<HTMLButtonElement>("shortcut-pick-bookmark-btn");
  shortcutPickBookmarkBtn.disabled = !library.available;
  const shortcutPickDynamicBtn = element<HTMLButtonElement>("shortcut-pick-dynamic-btn");
  const shortcutPickStaticBtn = element<HTMLButtonElement>("shortcut-pick-static-btn");
  const shortcutPickTemporaryBtn = element<HTMLButtonElement>("shortcut-pick-temporary-btn");
  let activeRecordingKeyId: string | null = null;
  let activeShortcutSettingsTarget: ReadonlyData<StoredShortcut | StoredNativeShortcut> | null =
    null;
  let activeShortcutSettingsBtn: HTMLElement | null = null;

  type ShortcutPickTarget = { kind: "slot"; slot: string } | { kind: "native"; id: string };

  let activeShortcutPickTarget: ShortcutPickTarget | null = null;
  let activeShortcutPickBtn: HTMLElement | null = null;
  let browserCommandsMap: Record<string, string> = {};

  async function refreshBrowserCommands(): Promise<void> {
    try {
      if (browser.commands && typeof browser.commands.getAll === "function") {
        const commands = await browserActions.commands();
        if (scope.signal.aborted) return;
        browserCommandsMap = {};
        for (const cmd of commands) {
          if (cmd.name) {
            browserCommandsMap[cmd.name] = cmd.shortcut || "";
          }
        }
        renderShortcuts();
      }
    } catch (err) {
      console.error("Failed to query browser commands:", err);
    }
  }

  function openShortcutSettingsPopover(
    target: ReadonlyData<StoredShortcut | StoredNativeShortcut>,
    titleText: string,
    anchorEl: HTMLElement,
  ): void {
    if (
      activeShortcutSettingsBtn === anchorEl &&
      shortcutSettingsPopover.style.display !== "none"
    ) {
      closeShortcutSettingsPopover();
      return;
    }

    overlays.close("color");
    overlays.close("itemSettings");
    overlays.close("addItem");
    closeShortcutPickPopover();

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

  function openShortcutPickPopover(target: ShortcutPickTarget, anchorEl: HTMLElement): void {
    if (activeShortcutPickBtn === anchorEl && shortcutPickPopover.style.display !== "none") {
      closeShortcutPickPopover();
      return;
    }
    overlays.close("color");
    overlays.close("itemSettings");
    overlays.close("addItem");
    closeShortcutSettingsPopover();

    activeShortcutPickTarget = target;
    activeShortcutPickBtn = anchorEl;
    shortcutPickDynamicBtn.hidden = state.settings.dynamicBookmarks.length === 0;
    shortcutPickStaticBtn.hidden = state.settings.staticBookmarks.length === 0;
    shortcutPickTemporaryBtn.hidden = state.settings.temporaryBookmarks.length === 0;

    positionPopover(shortcutPickPopover, anchorEl.getBoundingClientRect(), 180, "right");
  }

  function closeShortcutPickPopover(): void {
    shortcutPickPopover.style.display = "none";
    activeShortcutPickTarget = null;
    activeShortcutPickBtn = null;
  }

  function buildChangeBookmarkButton(target: ShortcutPickTarget): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-btn shortcut-change-btn";
    btn.textContent = t("shortcuts.changeBookmark");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openShortcutPickPopover(target, btn);
    });
    return btn;
  }

  function initShortcutsPanel(): void {
    shortcutsSubtabBrowser.addEventListener(
      "click",
      () => {
        shortcutsSubtabBrowser.classList.add("is-active");
        shortcutsSubtabNative.classList.remove("is-active");
        shortcutsBrowserPanel.hidden = false;
        shortcutsNativePanel.hidden = true;
      },
      { signal: scope.signal },
    );

    shortcutsSubtabNative.addEventListener(
      "click",
      () => {
        shortcutsSubtabNative.classList.add("is-active");
        shortcutsSubtabBrowser.classList.remove("is-active");
        shortcutsNativePanel.hidden = false;
        shortcutsBrowserPanel.hidden = true;
      },
      { signal: scope.signal },
    );

    addNativeShortcutBtn.addEventListener(
      "click",
      () => {
        const newId = crypto.randomUUID();
        state.addNativeShortcut({
          id: newId,
          key: "",
          tabMode: "replace",
        });
        activeRecordingKeyId = newId;
        renderNativeShortcuts();
      },
      { signal: scope.signal },
    );

    window.addEventListener(
      "keydown",
      (e) => {
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
        const target = state.settings.nativeShortcuts.find((s) => s.id === activeRecordingKeyId);
        if (target) {
          state.setNativeKey(target.id, recorded);
        }
        activeRecordingKeyId = null;
        renderNativeShortcuts();
      },
      { signal: scope.signal },
    );

    configureBrowserShortcutsBtn.addEventListener(
      "click",
      () => {
        void browserActions.openShortcutSettings().catch(error => {
          if (!scope.signal.aborted) showStatus(t("shortcuts.openSettingsFailed", { error: String(error) }));
        });
      },
      { signal: scope.signal },
    );

    document.getElementById("shortcuts-tab")?.addEventListener(
      "click",
      () => {
        void refreshBrowserCommands();
      },
      { signal: scope.signal },
    );

    shortcutSettingsClose.addEventListener("click", closeShortcutSettingsPopover, {
      signal: scope.signal,
    });
    shortcutSettingTabMode.addEventListener(
      "change",
      () => {
        if (activeShortcutSettingsTarget) {
          state.setShortcutTabMode(
            "slot" in activeShortcutSettingsTarget
              ? { kind: "slot", slot: activeShortcutSettingsTarget.slot }
              : { kind: "native", id: activeShortcutSettingsTarget.id },
            shortcutSettingTabMode.value as TabMode,
          );
        }
      },
      { signal: scope.signal },
    );

    shortcutPickBookmarkBtn.addEventListener(
      "click",
      () => {
        const target = activeShortcutPickTarget;
        closeShortcutPickPopover();
        if (!target) return;
        void pickShortcut(target);
      },
      { signal: scope.signal },
    );

    for (const [button, type] of [
      [shortcutPickStaticBtn, "static"],
      [shortcutPickTemporaryBtn, "temporary"],
      [shortcutPickDynamicBtn, "dynamic"],
    ] as const) {
      button.addEventListener(
        "click",
        () => {
          const target = activeShortcutPickTarget;
          closeShortcutPickPopover();
          if (!target) return;
          void pickCustomForShortcut(type, target);
        },
        { signal: scope.signal },
      );
    }

    document.addEventListener(
      "pointerdown",
      (e) => {
        const target = e.target as Node;
        if (
          shortcutSettingsPopover.style.display !== "none" &&
          !shortcutSettingsPopover.contains(target) &&
          !(activeShortcutSettingsBtn && activeShortcutSettingsBtn.contains(target))
        ) {
          closeShortcutSettingsPopover();
        }
        if (
          shortcutPickPopover.style.display !== "none" &&
          !shortcutPickPopover.contains(target) &&
          !(activeShortcutPickBtn && activeShortcutPickBtn.contains(target))
        ) {
          closeShortcutPickPopover();
        }
      },
      { signal: scope.signal },
    );

    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && shortcutPickPopover.style.display !== "none") {
          closeShortcutPickPopover();
        }
      },
      { signal: scope.signal },
    );
  }

  function renderNativeShortcuts(): void {
    nativeShortcutsList.replaceChildren();

    if (state.settings.nativeShortcuts.length === 0) {
      const emptyRow = document.createElement("div");
      emptyRow.className = "shortcut-row";
      const emptyLabel = document.createElement("span");
      emptyLabel.className = "shortcut-empty-label";
      emptyLabel.textContent = t("shortcuts.emptyNative");
      emptyRow.append(emptyLabel);
      nativeShortcutsList.append(emptyRow);
      return;
    }

    for (const item of state.settings.nativeShortcuts) {
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

      const hasTarget = isCustomBookmarkType(item.type)
        ? Boolean(customBookmarkUid(item))
        : Boolean(item.path || item.url);

      if (hasTarget) {
        const icon = document.createElement("span");
        icon.className = "shortcut-target-icon";

        const title = document.createElement("span");
        title.className = "shortcut-target-title";

        if (isCustomBookmarkType(item.type)) {
          icon.textContent = source.icon(item.type);
          title.textContent = source.name(item);
        } else {
          icon.textContent = "🔖";
          let displayTitle = item.title || "";
          if (item.path) {
            const rootPrefix = [...state.instance.rootPrefix];
            const effectivePath = combineRootAndItemPath(rootPrefix, [...item.path]);
            const node = findBookmarkNodeByPath(
              library.tree as BookmarkNode[],
              [...effectivePath],
              item.url,
            );
            if (node?.title) displayTitle = node.title;
          }
          title.textContent =
            displayTitle ||
            (item.path ? item.path[item.path.length - 1] || "Bookmark" : "Bookmark");
        }

        targetCol.append(icon, title);
      } else {
        const emptyLabel = document.createElement("span");
        emptyLabel.className = "shortcut-empty-label";
        emptyLabel.textContent = t("shortcuts.emptyTarget");
        targetCol.append(emptyLabel);
      }

      // Delete button (matches menu item remove-item-btn)
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "remove-item-btn";
      deleteBtn.title = t("common.delete");
      setIconContent(deleteBtn, removeIcon());
      deleteBtn.addEventListener("click", () => {
        const idx = state.settings.nativeShortcuts.findIndex((s) => s.id === item.id);
        if (idx !== -1) {
          state.removeShortcut({ kind: "native", id: item.id });
          if (activeRecordingKeyId === item.id) activeRecordingKeyId = null;
          if (activeShortcutSettingsTarget === item) closeShortcutSettingsPopover();
          renderNativeShortcuts();
        }
      });

      // Actions left→right: delete, settings (only when a target is set), change bookmark (always rightmost).
      actionsCol.append(deleteBtn);
      if (hasTarget) {
        const settingsBtn = document.createElement("button");
        settingsBtn.type = "button";
        settingsBtn.className = "item-settings-btn";
        settingsBtn.title = t("itemSettings.title");
        setIconContent(settingsBtn, settingsIcon());
        settingsBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openShortcutSettingsPopover(item, item.key || t("itemSettings.title"), settingsBtn);
        });
        actionsCol.append(settingsBtn);
      }
      actionsCol.append(buildChangeBookmarkButton({ kind: "native", id: item.id }));

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

      const target = state.settings.shortcuts.find((s) => s.slot === slotKey);
      const actionsCol = document.createElement("div");
      actionsCol.className = "shortcut-actions-col";

      if (
        target &&
        (isCustomBookmarkType(target.type)
          ? Boolean(customBookmarkUid(target))
          : Boolean(target.path || target.url))
      ) {
        const icon = document.createElement("span");
        icon.className = "shortcut-target-icon";

        const title = document.createElement("span");
        title.className = "shortcut-target-title";

        if (isCustomBookmarkType(target.type)) {
          icon.textContent = source.icon(target.type);
          title.textContent = source.name(target);
        } else {
          icon.textContent = "🔖";
          let displayTitle = target.title || "";
          if (target.path) {
            const rootPrefix = [...state.instance.rootPrefix];
            const effectivePath = combineRootAndItemPath(rootPrefix, [...target.path]);
            const node = findBookmarkNodeByPath(
              library.tree as BookmarkNode[],
              [...effectivePath],
              target.url,
            );
            if (node?.title) displayTitle = node.title;
          }
          title.textContent =
            displayTitle ||
            (target.path ? target.path[target.path.length - 1] || "Bookmark" : "Bookmark");
        }

        targetCol.append(icon, title);

        // Settings button
        const settingsBtn = document.createElement("button");
        settingsBtn.type = "button";
        settingsBtn.className = "item-settings-btn";
        settingsBtn.title = t("menu.settings");
        setIconContent(settingsBtn, settingsIcon());
        settingsBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openShortcutSettingsPopover(
            target,
            t("shortcuts.slotTitle", { n: String(i) }),
            settingsBtn,
          );
        });

        // Clear button (minus icon, matching remove-item-btn)
        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "remove-item-btn";
        clearBtn.title = t("shortcuts.clearTarget");
        setIconContent(clearBtn, removeIcon());
        clearBtn.addEventListener("click", () => {
          const idx = state.settings.shortcuts.findIndex((s) => s.slot === slotKey);
          if (idx !== -1) {
            if (activeShortcutSettingsTarget === state.settings.shortcuts[idx]) {
              closeShortcutSettingsPopover();
            }
            state.removeShortcut({ kind: "slot", slot: slotKey });
          }
        });

        // Actions left→right: clear, settings, change bookmark.
        actionsCol.append(clearBtn, settingsBtn);
      } else {
        const emptyLabel = document.createElement("span");
        emptyLabel.className = "shortcut-empty-label";
        emptyLabel.textContent = t("shortcuts.emptyTarget");
        targetCol.append(emptyLabel);
      }
      // "Change bookmark" is always present and stays rightmost.
      actionsCol.append(buildChangeBookmarkButton({ kind: "slot", slot: slotKey }));

      row.append(slotCol, targetCol, actionsCol);
      shortcutsList.append(row);
    }
  }

  async function pickShortcut(target: ShortcutPickTarget): Promise<void> {
    const existing =
      target.kind === "slot"
        ? state.settings.shortcuts.find((item) => item.slot === target.slot)
        : state.settings.nativeShortcuts.find((item) => item.id === target.id);
    const node = existing?.path
      ? findBookmarkNodeByPath(
          library.tree as BookmarkNode[],
          combineRootAndItemPath([...state.instance.rootPrefix], [...existing.path]),
          existing.url,
        )
      : undefined;
    const result = await bookmarkPicker.pick({
      mode: "bookmark",
      title:
        target.kind === "slot"
          ? t("shortcuts.pickDialogTitle", { n: target.slot.replace("slot_", "") })
          : t("shortcuts.pickNativeDialogTitle", {
              key: existing && "key" in existing ? existing.key : "",
            }),
      confirmLabel: t("picker.apply"),
      ...(node ? { selectedId: node.id } : {}),
      rootPrefix: state.instance.rootPrefix,
    });
    if (result?.node.url !== undefined)
      state.setShortcutTarget(target, {
        type: "bookmark",
        ...(result.relativePath !== undefined ? { path: result.relativePath } : {}),
        url: result.node.url,
        title: result.node.title,
      });
  }

  async function pickCustomForShortcut(
    type: CustomBookmarkType,
    target: ShortcutPickTarget,
  ): Promise<void> {
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
    if (uid) state.setShortcutTarget(target, { type, uid });
  }
  const render = () => {
    renderShortcuts();
    renderNativeShortcuts();
  };
  scope.add(overlays.register("shortcutSettings", closeShortcutSettingsPopover));
  scope.add(overlays.register("shortcutPick", closeShortcutPickPopover));
  scope.add(
    state.subscribe(["shortcuts", "bookmarks", "instance"], (change) => {
      if (change.structural) {
        closeShortcutSettingsPopover();
        closeShortcutPickPopover();
        if (
          activeRecordingKeyId &&
          !state.settings.nativeShortcuts.some((item) => item.id === activeRecordingKeyId)
        )
          activeRecordingKeyId = null;
      }
      render();
    }),
  );
  window.addEventListener("focus", () => void refreshBrowserCommands(), { signal: scope.signal });
  initShortcutsPanel();
  render();
  void refreshBrowserCommands();
  return {
    render,
    destroy(): void {
      activeRecordingKeyId = null;
      closeShortcutSettingsPopover();
      closeShortcutPickPopover();
      scope.destroy();
      shortcutsList.replaceChildren();
      nativeShortcutsList.replaceChildren();
    },
  };
}
