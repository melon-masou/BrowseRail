import browser from "webextension-polyfill";
import { t } from "@browserail/i18n";
import { mountBookmarkConfirmation, mountTemporaryConfirmation } from "@browserail/menu-ui";
import "@browserail/menu-ui/temporary-confirm.css";

const query = new URLSearchParams(location.search);
const isStatic = query.get("kind") === "static";
document.title = t(isStatic ? "static.confirmTitle" : "temporary.confirmTitle");
const root = document.getElementById("app")!;
const close = async (): Promise<void> => { window.close(); };
async function save(message: { type: "temporarySaveConfirmed"; note: string } | { type: "staticSaveConfirmed"; name: string; url: string }): Promise<void> {
  const result = await browser.runtime.sendMessage(message) as { error?: string; saved?: boolean } | undefined;
  if (result?.error) throw new Error(result.error);
  if (!result?.saved) throw new Error("Bookmark was not saved");
}
const confirmation = isStatic ? mountBookmarkConfirmation(root, {
  title: t("static.confirmTitle"),
  fields: [
    { key: "name", label: t("customBookmarks.name"), value: query.get("name") ?? "" },
    { key: "url", label: t("customBookmarks.url"), value: query.get("url") ?? "", required: true, inputMode: "url" },
  ],
  save: values => save({ type: "staticSaveConfirmed", name: values.name!, url: values.url! }),
  close,
}) : mountTemporaryConfirmation(root, {
  save: note => save({ type: "temporarySaveConfirmed", note }),
  close,
});
confirmation.focus();
