import browser from "webextension-polyfill";
import { t } from "@browserail/i18n";
import { mountTemporaryConfirmation } from "@browserail/menu-ui";
import "@browserail/menu-ui/temporary-confirm.css";

document.title = t("temporary.confirmTitle");
const confirmation = mountTemporaryConfirmation(document.getElementById("app")!, {
  async save(note) {
    const result = await browser.runtime.sendMessage({ type: "temporarySaveConfirmed", note }) as { error?: string; saved?: boolean } | undefined;
    if (result?.error) throw new Error(result.error);
    if (!result?.saved) throw new Error("Temporary bookmark was not saved");
  },
  async close() { window.close(); },
});
confirmation.focus();
