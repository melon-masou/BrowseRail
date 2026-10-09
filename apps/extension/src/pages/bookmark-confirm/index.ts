import browser from "webextension-polyfill";
import { t } from "@browserail/i18n";
import { mountBookmarkConfirmation, mountTemporaryConfirmation } from "@browserail/menu-ui";
import { loadConfig } from "../../config";
import { normalizeStaticBookmarkTags } from "../../config/static-bookmark-tags";
import "@browserail/menu-ui/temporary-confirm.css";

const query = new URLSearchParams(location.search);
const isStatic = query.get("kind") === "static";
document.title = t(isStatic ? "static.confirmTitle" : "temporary.confirmTitle");
const root = document.getElementById("app")!;
const close = async (): Promise<void> => { window.close(); };
async function save(message: { type: "temporarySaveConfirmed"; note: string } | { type: "staticSaveConfirmed"; name: string; url: string; tags: string[] }): Promise<void> {
  const result = await browser.runtime.sendMessage(message) as { error?: string; saved?: boolean } | undefined;
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
    save: values => save({ type: "staticSaveConfirmed", name: values.name!, url: values.url!, tags: normalizeStaticBookmarkTags(values.tags!.split(/[,，]/)) }),
    close,
  }) : mountTemporaryConfirmation(root, {
    save: note => save({ type: "temporarySaveConfirmed", note }),
    close,
  });
  confirmation.focus();
}
void init().catch(error => { root.textContent = t("status.saveFailed", { error: String(error) }); });
