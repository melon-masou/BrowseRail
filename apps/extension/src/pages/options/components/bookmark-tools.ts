import { type DynamicBookmark } from "../../../config";
import {
  buildTemporaryDirectiveUrl,
  type BookmarkNode,
  findBookmarkNodeByPath,
  SPECIAL_ROOT_PLACEHOLDERS,
} from "../../../bookmarks";
import { t } from "@browserail/i18n";
import { type ReadonlyData, type OptionsState } from "../state";
import { element } from "../dom";
import { createScope } from "../lifecycle";
import { type BookmarkLibrary } from "../bookmark-library";
import { type BookmarkPicker } from "../components/bookmark-picker";

export function createBookmarkTools(
  state: OptionsState,
  library: BookmarkLibrary,
  bookmarkPicker: BookmarkPicker,
) {
  const scope = createScope();
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
  const temporaryBookmarkFolderBtn = element<HTMLButtonElement>("temporary-bookmark-folder-btn");
  const temporaryBookmarkFolderDisplay = element<HTMLSpanElement>(
    "temporary-bookmark-folder-display",
  );
  const temporaryBookmarkResult = element<HTMLOutputElement>("temporary-bookmark-result");
  let temporaryMarkerUid: string | undefined;
  let toolFolderId: string | undefined;
  let activeDynamicMarkerDb: ReadonlyData<DynamicBookmark> | null = null;

  function bookmarkDestination(): string {
    const node = toolFolderId ? library.find(toolFolderId) : undefined;
    if (!node || node.url !== undefined || node.id === "0")
      throw new Error(t("toolkit.noDestination"));
    return node.id;
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
    const node = toolFolderId ? library.find(toolFolderId) : undefined;
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
    temporaryBookmarkResult.textContent = "";
    delete temporaryBookmarkResult.dataset.state;
    updateTemporaryBookmarkFolderDisplay();
    temporaryBookmarkDialog.showModal();
  }

  function buildDynamicMarkerUrl(uid: string): string {
    return `https://browserail.local/#Dynamic:${uid}`;
  }

  function updateDynamicMarkerFolderDisplay(): void {
    const node = toolFolderId ? library.find(toolFolderId) : undefined;
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
      ...(toolFolderId ? { selectedId: toolFolderId } : {}),
      rootPrefix: state.instance.rootPrefix,
    });
    if (result) {
      toolFolderId = result.node.id;
      updateDynamicMarkerFolderDisplay();
      updateTemporaryBookmarkFolderDisplay();
    }
  }
  toolFolderId = findBookmarkNodeByPath(library.tree as BookmarkNode[], [
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
  initTemporaryBookmarkDialog();
  return {
    openTemporary: openTemporaryMarkerDialog,
    openDynamic: openDynamicMarkerDialog,
    render(): void {
      if (dynamicMarkerDialog.open) updateDynamicMarkerFolderDisplay();
      if (temporaryBookmarkDialog.open) updateTemporaryBookmarkFolderDisplay();
    },
    destroy(): void {
      dynamicMarkerDialog.close();
      temporaryBookmarkDialog.close();
      scope.destroy();
    },
  };
}
export type BookmarkTools = ReturnType<typeof createBookmarkTools>;
