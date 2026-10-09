import { t } from "@browserail/i18n";
import { mountBookmarkConfirmation, mountTemporaryConfirmation } from "@browserail/menu-ui";
import { loadConfig } from "../../lib/config";
import { normalizeStaticBookmarkTags } from "../../lib/config/static-bookmark-tags";
import "@browserail/menu-ui/temporary-confirm.css";
import { STATIC_SAVE_CONFIRMED, TEMPORARY_SAVE_CONFIRMED, type CaptureConfirmation, type CaptureResult } from "../../features/capture/messages";
import { request } from "../../lib/messaging";

const query = new URLSearchParams(location.search);
const isStatic = query.get("kind") === "static";
document.title = t(isStatic ? "static.confirmTitle" : "temporary.confirmTitle");
const root = document.getElementById("app")!;
const close = async (): Promise<void> => { window.close(); };
async function save(message: CaptureConfirmation): Promise<void> {
  const result = await request<CaptureResult | undefined>(message);
  if (result?.error) throw new Error(result.error);
  if (!result?.saved) throw new Error("Bookmark was not saved");
}
async function init(): Promise<void> {
  const tags = isStatic ? normalizeStaticBookmarkTags((await loadConfig()).staticBookmarks.flatMap(bookmark => bookmark.tags ?? []))
    .sort((a, b) => a.localeCompare(b)) : [];
  const confirmation = isStatic ? mountBookmarkConfirmation(root, {
    title: t("static.confirmTitle"),
    fields: [
      { key: "name", label: t("customBookmarks.name"), value: query.get("name") ?? "" },
      { key: "url", label: t("customBookmarks.url"), value: query.get("url") ?? "", required: true, inputMode: "url" },
      { key: "tags", label: t("static.tags"), placeholder: t("static.importTags"), suggestions: tags, multiple: true },
    ],
    save: values => save({ type: STATIC_SAVE_CONFIRMED, name: values.name!, url: values.url!, tags: normalizeStaticBookmarkTags(values.tags!.split(/[,，]/)) }),
    close,
  }) : mountTemporaryConfirmation(root, {
    save: note => save({ type: TEMPORARY_SAVE_CONFIRMED, note }),
    close,
  });
  confirmation.focus();
}
void init().catch(error => { root.textContent = t("status.saveFailed", { error: String(error) }); });
