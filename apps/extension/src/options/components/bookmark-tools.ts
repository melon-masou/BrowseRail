import { type DynamicBookmark } from "../../config";
import {
  buildSpaceDirectiveUrl,
  buildTemporaryDirectiveUrl,
  type BookmarkNode,
  findBookmarkNodeByPath,
  SPECIAL_ROOT_PLACEHOLDERS,
} from "../../bookmarks";
import { t } from "@browserail/i18n";
import { type ReadonlyData, type OptionsState } from "../state";
import { updateSwatchAppearance, type ColorPopover } from "../components/color-popover";
import { element } from "../dom";
import { createScope } from "../lifecycle";
import { type BookmarkLibrary } from "../bookmark-library";
import { type BookmarkPicker } from "../components/bookmark-picker";

export function createBookmarkTools(
  state: OptionsState,
  library: BookmarkLibrary,
  bookmarkPicker: BookmarkPicker,
  colorPopoverController: ColorPopover,
) {
  const scope = createScope();
  const addSpaceBookmarkBtn = element<HTMLButtonElement>("add-space-bookmark-btn");
  const spaceBookmarkDialog = element<HTMLDialogElement>("space-bookmark-dialog");
  const spaceBookmarkClose = element<HTMLButtonElement>("space-bookmark-close");
  const spaceBookmarkCloseBtn = element<HTMLButtonElement>("space-bookmark-close-btn");
  const spaceBookmarkForm = element<HTMLFormElement>("space-bookmark-form");
  const spaceBookmarkUnits = element<HTMLInputElement>("space-bookmark-units");
  const spaceBookmarkColor = element<HTMLButtonElement>("space-bookmark-color");
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
  const temporaryBookmarkDialog = element<HTMLDialogElement>("temporary-bookmark-dialog");
  const temporaryBookmarkClose = element<HTMLButtonElement>("temporary-bookmark-close");
  const temporaryBookmarkCloseBtn = element<HTMLButtonElement>("temporary-bookmark-close-btn");
  const temporaryBookmarkForm = element<HTMLFormElement>("temporary-bookmark-form");
  const temporaryBookmarkDefinition = element<HTMLSpanElement>("temporary-bookmark-definition");
  const temporaryBookmarkFolderBtn = element<HTMLButtonElement>("temporary-bookmark-folder-btn");
  const temporaryBookmarkFolderDisplay = element<HTMLSpanElement>(
    "temporary-bookmark-folder-display",
  );
  const temporaryBookmarkResult = element<HTMLOutputElement>("temporary-bookmark-result");
  let temporaryMarkerUid: string | undefined;
  const spaceBookmarkColors: { color?: string } = {};
  let gapBookmarkFolderId: string | undefined;
  let activeDynamicMarkerDb: ReadonlyData<DynamicBookmark> | null = null;

  function initSpaceBookmarkDialog(): void {
    addSpaceBookmarkBtn.addEventListener(
      "click",
      () => {
        spaceBookmarkResult.textContent = "";
        delete spaceBookmarkResult.dataset.state;
        updateGapBookmarkFolderDisplay();
        spaceBookmarkDialog.showModal();
      },
      { signal: scope.signal },
    );
    function closeSpaceBookmarkDialog(): void {
      colorPopoverController.close();
      spaceBookmarkDialog.close();
    }
    spaceBookmarkClose.addEventListener("click", closeSpaceBookmarkDialog, {
      signal: scope.signal,
    });
    spaceBookmarkCloseBtn.addEventListener("click", closeSpaceBookmarkDialog, {
      signal: scope.signal,
    });
    spaceBookmarkDialog.addEventListener(
      "cancel",
      (event) => {
        event.preventDefault();
        closeSpaceBookmarkDialog();
      },
      { signal: scope.signal },
    );
    spaceBookmarkColor.addEventListener(
      "click",
      () =>
        colorPopoverController.open(
          {
            read: () => spaceBookmarkColors,
            field: "color",
            defaultColor: "#3b82f600",
            title: t("color.title"),
            setColor: (color) => {
              if (color === undefined) delete spaceBookmarkColors.color;
              else spaceBookmarkColors.color = color;
            },
            setCycleColors: () => {
              throw new Error("Not a folder color");
            },
            onChange: () => {},
            onClose: () => {},
          },
          spaceBookmarkColor,
        ),
      { signal: scope.signal },
    );
    updateSwatchAppearance(spaceBookmarkColor, spaceBookmarkColors.color);
    spaceBookmarkFolderBtn.addEventListener(
      "click",
      () => {
        void pickToolFolder();
      },
      { signal: scope.signal },
    );

    spaceBookmarkForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        void addSpaceBookmark();
      },
      { signal: scope.signal },
    );
  }

  function updateGapBookmarkFolderDisplay(): void {
    const node = gapBookmarkFolderId ? library.find(gapBookmarkFolderId) : undefined;
    spaceBookmarkFolderDisplay.textContent = node?.title || t("toolkit.noDestination");
  }

  function bookmarkDestination(): string {
    const node = gapBookmarkFolderId ? library.find(gapBookmarkFolderId) : undefined;
    if (!node || node.url !== undefined || node.id === "0")
      throw new Error(t("toolkit.noDestination"));
    return node.id;
  }

  async function addSpaceBookmark(): Promise<void> {
    const url = buildSpaceDirectiveUrl({
      units: Number(spaceBookmarkUnits.value),
      ...(spaceBookmarkColors.color ? { color: spaceBookmarkColors.color } : {}),
    });
    try {
      await library.createBookmark({
        title: "Space",
        url,
        parentId: bookmarkDestination(),
      });
      if (scope.signal.aborted) return;
      spaceBookmarkResult.textContent = t("toolkit.added");
      spaceBookmarkResult.dataset.state = "success";
    } catch (error) {
      if (scope.signal.aborted) return;
      spaceBookmarkResult.textContent = t("toolkit.addFailed", {
        error: error instanceof Error ? error.message : String(error),
      });
      spaceBookmarkResult.dataset.state = "error";
    }
  }

  function initTemporaryBookmarkDialog(): void {
    temporaryBookmarkDialog.addEventListener(
      "close",
      () => {
        temporaryMarkerUid = undefined;
      },
      { signal: scope.signal },
    );
    temporaryBookmarkClose.addEventListener("click", () => temporaryBookmarkDialog.close(), {
      signal: scope.signal,
    });
    temporaryBookmarkCloseBtn.addEventListener("click", () => temporaryBookmarkDialog.close(), {
      signal: scope.signal,
    });
    temporaryBookmarkDialog.addEventListener(
      "click",
      (e) => {
        if (e.target === temporaryBookmarkDialog) temporaryBookmarkDialog.close();
      },
      { signal: scope.signal },
    );
    temporaryBookmarkFolderBtn.addEventListener(
      "click",
      () => {
        void pickToolFolder();
      },
      { signal: scope.signal },
    );

    temporaryBookmarkForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        void addTemporaryBookmark();
      },
      { signal: scope.signal },
    );
  }

  function updateTemporaryBookmarkFolderDisplay(): void {
    const node = gapBookmarkFolderId ? library.find(gapBookmarkFolderId) : undefined;
    temporaryBookmarkFolderDisplay.textContent = node?.title || t("toolkit.noDestination");
  }

  async function addTemporaryBookmark(): Promise<void> {
    const definition = state.settings.temporaryBookmarks.find(
      (entry) => entry.uid === temporaryMarkerUid,
    );
    if (!definition) return;
    const url = buildTemporaryDirectiveUrl({ id: definition.uid });
    const title = definition.name || t("temporary.defaultName");
    try {
      await library.createBookmark({
        title,
        url,
        parentId: bookmarkDestination(),
      });
      if (scope.signal.aborted) return;
      temporaryBookmarkResult.textContent = t("toolkit.added");
      temporaryBookmarkResult.dataset.state = "success";
    } catch (error) {
      if (scope.signal.aborted) return;
      temporaryBookmarkResult.textContent = t("toolkit.addFailed", {
        error: error instanceof Error ? error.message : String(error),
      });
      temporaryBookmarkResult.dataset.state = "error";
    }
  }

  function openTemporaryMarkerDialog(uid: string): void {
    const definition = state.settings.temporaryBookmarks.find((entry) => entry.uid === uid);
    if (!definition) return;
    temporaryMarkerUid = uid;
    temporaryBookmarkDefinition.textContent = definition.name || t("temporary.defaultName");
    temporaryBookmarkResult.textContent = "";
    delete temporaryBookmarkResult.dataset.state;
    updateTemporaryBookmarkFolderDisplay();
    temporaryBookmarkDialog.showModal();
  }

  function buildDynamicMarkerUrl(uid: string): string {
    return `https://browserail.local/#Dynamic:${uid}`;
  }

  function updateDynamicMarkerFolderDisplay(): void {
    const node = gapBookmarkFolderId ? library.find(gapBookmarkFolderId) : undefined;
    dynamicMarkerFolderDisplay.textContent = node?.title || t("toolkit.noDestination");
  }

  function openDynamicMarkerDialog(uid: string): void {
    activeDynamicMarkerDb =
      state.settings.dynamicBookmarks.find((value) => value.uid === uid) ?? null;
    if (!activeDynamicMarkerDb) return;
    dynamicMarkerResult.textContent = "";
    delete dynamicMarkerResult.dataset.state;
    updateDynamicMarkerFolderDisplay();
    dynamicMarkerDialog.showModal();
  }

  async function addDynamicMarkerBookmark(): Promise<void> {
    if (!activeDynamicMarkerDb) return;
    try {
      await library.createBookmark({
        title: activeDynamicMarkerDb.name || t("dynamic.defaultName"),
        url: buildDynamicMarkerUrl(activeDynamicMarkerDb.uid),
        parentId: bookmarkDestination(),
      });
      if (scope.signal.aborted) return;
      dynamicMarkerResult.textContent = t("toolkit.added");
      dynamicMarkerResult.dataset.state = "success";
    } catch (error) {
      if (scope.signal.aborted) return;
      dynamicMarkerResult.textContent = t("toolkit.addFailed", {
        error: error instanceof Error ? error.message : String(error),
      });
      dynamicMarkerResult.dataset.state = "error";
    }
  }

  async function pickToolFolder(): Promise<void> {
    const result = await bookmarkPicker.pick({
      mode: "folder",
      title: t("picker.pickFolderTitle"),
      confirmLabel: t("picker.pickFolderConfirm"),
      ...(gapBookmarkFolderId ? { selectedId: gapBookmarkFolderId } : {}),
      rootPrefix: state.instance.rootPrefix,
    });
    if (result) {
      gapBookmarkFolderId = result.node.id;
      updateGapBookmarkFolderDisplay();
      updateDynamicMarkerFolderDisplay();
      updateTemporaryBookmarkFolderDisplay();
    }
  }
  gapBookmarkFolderId = findBookmarkNodeByPath(library.tree as BookmarkNode[], [
    SPECIAL_ROOT_PLACEHOLDERS["bookmarks-bar"],
  ])?.id;
  dynamicMarkerFolderBtn.addEventListener("click", () => void pickToolFolder(), {
    signal: scope.signal,
  });
  dynamicMarkerClose.addEventListener("click", () => dynamicMarkerDialog.close(), {
    signal: scope.signal,
  });
  dynamicMarkerCloseBtn.addEventListener("click", () => dynamicMarkerDialog.close(), {
    signal: scope.signal,
  });
  dynamicMarkerDialog.addEventListener(
    "click",
    (event) => {
      if (event.target === dynamicMarkerDialog) dynamicMarkerDialog.close();
    },
    { signal: scope.signal },
  );
  dynamicMarkerForm.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      void addDynamicMarkerBookmark();
    },
    { signal: scope.signal },
  );
  initSpaceBookmarkDialog();
  initTemporaryBookmarkDialog();
  return {
    openTemporary: openTemporaryMarkerDialog,
    openDynamic: openDynamicMarkerDialog,
    render(): void {
      if (spaceBookmarkDialog.open) updateGapBookmarkFolderDisplay();
      if (dynamicMarkerDialog.open) updateDynamicMarkerFolderDisplay();
      if (temporaryBookmarkDialog.open) updateTemporaryBookmarkFolderDisplay();
    },
    destroy(): void {
      spaceBookmarkDialog.close();
      dynamicMarkerDialog.close();
      temporaryBookmarkDialog.close();
      scope.destroy();
    },
  };
}
export type BookmarkTools = ReturnType<typeof createBookmarkTools>;
