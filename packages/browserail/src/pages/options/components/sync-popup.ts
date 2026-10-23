import { getLanguage, t } from "@browserail/i18n";
import type { ExportedSettingsData } from "@browserail/protocol";
import { cloudStorageAvailable, readCloudSettings, uploadCloudSettings } from "../../../lib/config/cloud-storage";
import { loadSyncSettings, saveSyncSettings, type SyncSettings } from "../../../lib/config/sync-settings";
import { authorizeWebDav, readWebDavSettings, uploadWebDavSettings } from "../../../lib/config/webdav";
import { mergeTransferData, type TransferOptions } from "../transfer";
import { createTransferChoices } from "./transfer-options";

interface SyncPopupOptions {
  signal: AbortSignal;
  exportSettings(): Promise<ExportedSettingsData>;
  canUpload(): boolean;
  apply(data: ExportedSettingsData, options: TransferOptions): Promise<void>;
  busy(value: boolean): void;
}

/** Who exported the data and when, in the current time zone. */
function describeSource(data: ExportedSettingsData): string {
  const date = new Date(data.exportedAt);
  const time = Number.isNaN(date.getTime()) ? data.exportedAt : new Intl.DateTimeFormat(getLanguage(), {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
  return data.exportedBy ? `${data.exportedBy} · ${time}` : time;
}

export function createSyncPopup(options: SyncPopupOptions) {
  let dialog: HTMLDialogElement | undefined;
  let opening = false;
  options.signal.addEventListener("abort", () => dialog?.close(), { once: true });

  async function open(): Promise<void> {
    if (dialog || opening || options.signal.aborted) return;
    opening = true;
    try {
      const [settings, local] = await Promise.all([loadSyncSettings(), options.exportSettings()]);
      if (options.signal.aborted) return;
      show(settings, local);
    } finally { opening = false; }
  }

  function show(settings: SyncSettings, local: ExportedSettingsData): void {
    const popup = document.createElement("dialog");
    dialog = popup;
    popup.id = "sync-dialog";
    popup.className = "space-bookmark-dialog sync-dialog";
    const lifetime = new AbortController();
    let operation: AbortController | undefined;
    let busy = false;
    let remote: ExportedSettingsData | undefined;
    const header = document.createElement("div"); header.className = "space-bookmark-dialog-header";
    const title = document.createElement("span"); title.textContent = t("btn.sync");
    const close = document.createElement("button"); close.type = "button"; close.className = "color-popover-close";
    close.textContent = "✕"; close.ariaLabel = t("common.close");
    header.append(title, close);
    const body = document.createElement("div"); body.className = "space-bookmark-dialog-body";
    const providers = document.createElement("div"); providers.className = "shortcuts-subtabs sync-providers";
    const providerButtons = new Map<SyncSettings["provider"], HTMLButtonElement>();
    for (const [provider, label] of [["chrome", t("form.browserSync")], ["webdav", "WebDAV"]] as const) {
      const button = document.createElement("button"); button.type = "button"; button.className = "shortcuts-subtab-btn";
      button.textContent = label; button.dataset.provider = provider;
      button.addEventListener("click", () => { settings.provider = provider; resetPreview(); render(); });
      providers.append(button); providerButtons.set(provider, button);
    }
    // Neither provider reports whether a copy reached other devices; the source of a fetched copy lets the user check.
    const info = document.createElement("div"); info.className = "sync-copy-info";
    const hint = document.createElement("p"); hint.textContent = t("sync.browserHint");
    const source = document.createElement("p"); source.id = "sync-copy-source";
    info.append(hint, source);
    const credentials = document.createElement("div"); credentials.className = "sync-webdav-fields";
    function field(label: string, id: string, value: string, type = "text") {
      const row = document.createElement("label"); row.append(label);
      const input = document.createElement("input"); input.id = id; input.type = type; input.value = value;
      input.addEventListener("input", resetPreview);
      row.append(input); credentials.append(row); return input;
    }
    const url = field(t("sync.fileUrl"), "sync-webdav-url", settings.webdav.url, "url");
    url.placeholder = "https://example.com/dav/browserail.json";
    const username = field(t("sync.username"), "sync-webdav-username", settings.webdav.username);
    username.autocomplete = "username";
    const password = field(t("sync.password"), "sync-webdav-password", settings.webdav.password, "password");
    password.autocomplete = "current-password";
    const choicesRoot = document.createElement("div");
    let choices = createTransferChoices(local, false);
    choicesRoot.append(choices.element);
    choicesRoot.addEventListener("change", render);
    const status = document.createElement("output"); status.id = "sync-status"; status.ariaLive = "polite";
    const actions = document.createElement("div"); actions.className = "space-bookmark-dialog-actions";
    const upload = document.createElement("button"); upload.id = "sync-upload"; upload.type = "button"; upload.className = "save-btn";
    upload.textContent = t("cloud.upload");
    const download = document.createElement("button"); download.id = "sync-download"; download.type = "button"; download.className = "action-btn";
    const back = document.createElement("button"); back.type = "button"; back.className = "action-btn"; back.textContent = t("sync.back");
    back.addEventListener("click", () => { resetPreview(); render(); });
    actions.append(upload, download, back);
    body.append(providers, credentials, info, choicesRoot, status, actions);
    popup.append(header, body); document.body.append(popup);

    function readSettings(): SyncSettings {
      settings.webdav = { url: url.value.trim(), username: username.value, password: password.value };
      return structuredClone(settings);
    }
    function message(text: string, error = false): void {
      if (lifetime.signal.aborted) return;
      status.value = text; status.dataset.state = error ? "error" : "";
    }
    function resetPreview(): void {
      if (remote) {
        remote = undefined;
        choices = createTransferChoices(local, false);
        choicesRoot.replaceChildren(choices.element);
      }
      message("");
      render();
    }
    function render(): void {
      for (const [provider, button] of providerButtons) {
        button.classList.toggle("is-active", settings.provider === provider);
        button.setAttribute("aria-pressed", String(settings.provider === provider));
        button.disabled = busy || provider === "chrome" && !cloudStorageAvailable();
        button.title = provider === "chrome" && !cloudStorageAvailable() ? t("cloud.unavailable") : "";
      }
      credentials.hidden = settings.provider !== "webdav";
      hint.hidden = settings.provider !== "chrome";
      info.hidden = settings.provider === "chrome" && !cloudStorageAvailable();
      for (const input of [url, username, password]) input.disabled = busy;
      choicesRoot.inert = busy;
      const unavailable = settings.provider === "chrome" && !cloudStorageAvailable();
      upload.hidden = !!remote;
      upload.disabled = busy || unavailable || !choices.hasSelection();
      download.textContent = t(remote ? "btn.import" : "cloud.download");
      download.disabled = busy || unavailable || !!remote && !choices.hasSelection();
      back.hidden = !remote; back.disabled = busy;
      title.textContent = t(remote ? "sync.remote" : "btn.sync");
      source.textContent = remote ? t("sync.copy", { source: describeSource(remote) }) : "";
    }
    async function transfer(direction: "upload" | "download"): Promise<void> {
      if (busy) return;
      if (direction === "upload" && !options.canUpload()) { message(t("export.saveFirst"), true); return; }
      const selected = choices.options();
      const target = readSettings();
      busy = true; options.busy(true); render();
      operation = new AbortController();
      const abort = () => operation?.abort();
      lifetime.signal.addEventListener("abort", abort, { once: true });
      let timeout = window.setTimeout(abort, 30000);
      try {
        if (direction === "download" && remote) {
          await options.apply(remote, selected);
          if (lifetime.signal.aborted) return;
          local = await options.exportSettings();
          resetPreview(); message(t("cloud.downloaded"));
          return;
        }
        // Permission requests must retain the click's user gesture.
        if (target.provider === "webdav") await authorizeWebDav(target.webdav);
        if (lifetime.signal.aborted) return;
        await saveSyncSettings(target);
        message(t(direction === "upload" ? "cloud.uploading" : "cloud.downloading"));
        const data = target.provider === "chrome" ? await readCloudSettings() : await readWebDavSettings(target.webdav, operation.signal);
        if (lifetime.signal.aborted) return;
        if (direction === "upload") {
          const snapshot = await options.exportSettings();
          if (lifetime.signal.aborted) return;
          // Compare the two copies only now that the remote one has been fetched for this upload.
          const comparison = [t("sync.localCopy", { source: describeSource(snapshot) }), data ? t("sync.copy", { source: describeSource(data) }) : t("sync.copyNone")];
          if (!window.confirm([t("sync.uploadConfirm"), "", ...comparison].join("\n"))) { message(""); return; }
          // Time spent deciding does not count against the upload.
          clearTimeout(timeout); timeout = window.setTimeout(abort, 30000);
          const merged = mergeTransferData(data, snapshot, selected);
          if (target.provider === "chrome") await uploadCloudSettings(merged);
          else await uploadWebDavSettings(target.webdav, merged, operation.signal);
          message(t("cloud.uploaded"));
        } else {
          if (!data) throw new Error(t("sync.empty"));
          remote = data;
          choices = createTransferChoices(data, true, selected);
          choicesRoot.replaceChildren(choices.element);
          message("");
        }
      } catch (error) {
        message(t("sync.failed", { error: String(error) }), true);
      } finally {
        clearTimeout(timeout);
        lifetime.signal.removeEventListener("abort", abort);
        operation = undefined;
        busy = false; options.busy(false);
        if (!lifetime.signal.aborted) render();
      }
    }
    upload.addEventListener("click", () => void transfer("upload"));
    download.addEventListener("click", () => void transfer("download"));
    close.addEventListener("click", () => popup.close());
    popup.addEventListener("close", () => {
      lifetime.abort();
      void saveSyncSettings(readSettings()).catch(error => console.warn("Sync settings save failed:", error));
      popup.remove(); dialog = undefined;
    }, { once: true });
    render(); popup.showModal();
  }
  return { open };
}
