import { mountTemporaryConfirmation } from "@browserail/menu-ui";
import "@browserail/menu-ui/temporary-confirm.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { showWindowWhenReady } from "./window-ready";

export function initializeTemporaryConfirmation(root: HTMLElement): void {
  document.body.dataset.view = "temporary-confirm";
  const query = new URLSearchParams(location.search);
  const instanceUid = query.get("instanceUid") ?? "";
  const menuUid = query.get("menuUid") ?? "";
  const windowUid = query.get("windowUid") ?? "";
  const uid = query.get("uid") ?? "";
  const confirmation = mountTemporaryConfirmation(root, {
    async save(note) {
      if (!instanceUid || !menuUid || !uid) throw new Error("Temporary bookmark is unavailable");
      const params = new URLSearchParams({ confirmed: "1", note });
      const actionUid = `temporarySave:${encodeURIComponent(uid)}?${params}`;
      const command = windowUid ? "invoke_action" : "invoke_free_action";
      const args = windowUid
        ? { actionUid, instanceUid, windowUid, menuUid }
        : { actionUid, instanceUid, menuUid };
      await invoke(command, args);
    },
    close: () => getCurrentWindow().close(),
  });
  void showWindowWhenReady().then(() => confirmation.focus());
}
