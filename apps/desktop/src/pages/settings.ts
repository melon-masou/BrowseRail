import { invoke } from "@tauri-apps/api/core";
import { getLanguage, type Lang, LANGUAGES, onLanguageChange, saveLanguage, t } from "@browserail/i18n";
import { showWindowWhenReady } from "../window-ready";

export async function initializeListenerSettings(
  root: HTMLElement,
): Promise<void> {
  document.body.dataset.view = "settings";
  root.className = "listener-settings";

  const portSection = document.createElement("div");
  portSection.className = "settings-section";

  const portLabel = document.createElement("label");
  portLabel.className = "settings-label";
  portLabel.htmlFor = "settings-port-input";
  portLabel.textContent = t("settings.listenPort");

  const portRow = document.createElement("form");
  portRow.className = "settings-inline-row";

  const portInput = document.createElement("input");
  portInput.id = "settings-port-input";
  portInput.type = "number";
  portInput.min = "1";
  portInput.max = "65535";
  portInput.required = true;

  const applyBtn = document.createElement("button");
  applyBtn.type = "submit";
  applyBtn.textContent = t("settings.apply");

  portRow.append(portInput, applyBtn);
  portSection.append(portLabel, portRow);

  const debugSection = document.createElement("div");
  debugSection.className = "settings-section";

  const debugLabel = document.createElement("label");
  debugLabel.className = "settings-checkbox-row";

  const debugCheckbox = document.createElement("input");
  debugCheckbox.type = "checkbox";
  debugCheckbox.id = "settings-debug-checkbox";

  const debugText = document.createElement("span");
  debugText.textContent = t("settings.debug");

  debugLabel.append(debugCheckbox, debugText);
  debugSection.append(debugLabel);

  const langSection = document.createElement("div");
  langSection.className = "settings-section";

  const langRow = document.createElement("div");
  langRow.className = "settings-language-row";

  const langLabel = document.createElement("label");
  langLabel.className = "settings-label";
  langLabel.textContent = t("language.label");

  const langSelect = document.createElement("select");
  langSelect.className = "settings-language-select";
  for (const lang of LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = lang === "zh-CN" ? t("language.zhCN") : t("language.en");
    langSelect.append(opt);
  }
  langSelect.value = getLanguage();
  langSelect.addEventListener("change", () => {
    saveLanguage(langSelect.value as Lang);
  });
  langRow.append(langLabel, langSelect);
  langSection.append(langRow);

  const statusCard = document.createElement("div");
  statusCard.className = "settings-status-card";

  root.append(portSection, debugSection, langSection, statusCard);

  let currentState: ListenerState | null = null;
  let isSubmitting = false;

  onLanguageChange(() => {
    portLabel.textContent = t("settings.listenPort");
    applyBtn.textContent = t("settings.apply");
    debugText.textContent = t("settings.debug");
    langLabel.textContent = t("language.label");
    for (const opt of langSelect.options) {
      opt.textContent = opt.value === "zh-CN" ? t("language.zhCN") : t("language.en");
    }
    langSelect.value = getLanguage();
    void invoke("set_ui_language", { language: getLanguage() }).catch(() => {});
    if (currentState) {
      renderStatus(currentState);
    }
  });

  function renderStatus(state: ListenerState): void {
    currentState = state;
    if (!portInput.matches(":focus")) {
      portInput.value = String(state.port);
    }
    debugCheckbox.checked = Boolean(state.debugEnabled);

    statusCard.replaceChildren();

    const statusRow = document.createElement("div");
    statusRow.className = "settings-status-row";

    const dot = document.createElement("span");
    dot.className = "settings-status-dot";

    const text = document.createElement("span");

    if (state.error) {
      dot.dataset.status = "error";
      dot.textContent = "!";
      text.textContent = t("settings.listenerError");
    } else if (state.listening) {
      dot.dataset.status = "listening";
      dot.textContent = "●";
      text.textContent = t("settings.listeningOn", { address: state.address });
    } else {
      dot.dataset.status = "stopped";
      dot.textContent = "○";
      text.textContent = t("settings.stopped");
    }
    statusRow.append(dot, text);
    statusCard.append(statusRow);

    if (state.error) {
      const errorBox = document.createElement("div");
      errorBox.className = "settings-error-box";

      const errorTitle = document.createElement("div");
      errorTitle.className = "settings-error-title";
      errorTitle.textContent = t("settings.failureReason");

      const errorDetail = document.createElement("div");
      errorDetail.className = "settings-error-detail";
      errorDetail.textContent = state.error;

      errorBox.append(errorTitle, errorDetail);
      statusCard.append(errorBox);
    }

    const extSection = document.createElement("div");
    extSection.className = "settings-ext-section";

    const extTitle = document.createElement("div");
    extTitle.className = "settings-ext-title";
    const count = state.extensions?.length ?? 0;
    extTitle.textContent = t("settings.connectedExtensions", { count });
    extSection.append(extTitle);

    if (!state.extensions || state.extensions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-ext-empty";
      empty.textContent = t("settings.noExtensions");
      extSection.append(empty);
    } else {
      const extList = document.createElement("div");
      extList.className = "settings-ext-list";

      for (const ext of state.extensions) {
        const item = document.createElement("div");
        item.className = "settings-ext-item";

        const main = document.createElement("div");
        main.className = "settings-ext-item-main";

        const extDot = document.createElement("span");
        extDot.style.color = "#10b981";
        extDot.textContent = "●";

        const browserName = formatBrowserName(ext.browser);
        const labelText = ext.label && ext.label.length > 0 ? ext.label : ext.instanceUid;

        const nameSpan = document.createElement("span");
        nameSpan.textContent = `${browserName} (${labelText})`;

        main.append(extDot, nameSpan);

        const meta = document.createElement("div");
        meta.className = "settings-ext-item-meta";
        meta.textContent =
          ext.windowsCount === 1
            ? t("settings.windowsOne", { count: ext.windowsCount })
            : t("settings.windowsOther", { count: ext.windowsCount });

        item.append(main, meta);
        extList.append(item);
      }
      extSection.append(extList);
    }

    statusCard.append(extSection);
  }

  function formatBrowserName(browser?: string): string {
    if (!browser) return t("ext.fallback");
    const b = browser.toLowerCase();
    if (b === "chrome") return "Chrome";
    if (b === "edge") return "Edge";
    if (b === "brave") return "Brave";
    if (b === "firefox") return "Firefox";
    if (b === "opera") return "Opera";
    if (b === "vivaldi") return "Vivaldi";
    return browser.charAt(0).toUpperCase() + browser.slice(1);
  }

  try {
    const initial = await invoke<ListenerState>("listener_state");
    renderStatus(initial);
  } catch (err) {
    statusCard.textContent = String(err);
  }

  const timer = setInterval(() => {
    if (isSubmitting) return;
    void invoke<ListenerState>("listener_state")
      .then(renderStatus)
      .catch(() => {});
  }, 1500);

  window.addEventListener("beforeunload", () => {
    clearInterval(timer);
  });

  portRow.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePort();
  });

  async function savePort(): Promise<void> {
    const port = portInput.valueAsNumber;
    if (!port || port < 1 || port > 65535) return;
    isSubmitting = true;
    applyBtn.disabled = true;
    try {
      const next = await invoke<ListenerState>("set_listener_port", { port });
      renderStatus(next);
    } catch (error) {
      if (currentState) {
        renderStatus({
          ...currentState,
          error: String(error),
          listening: false,
        });
      }
    } finally {
      isSubmitting = false;
      applyBtn.disabled = false;
    }
  }

  debugCheckbox.addEventListener("change", () => {
    const enabled = debugCheckbox.checked;
    void invoke<ListenerState>("set_debug_enabled", { enabled })
      .then(renderStatus)
      .catch((error) => {
        debugCheckbox.checked = !enabled;
        if (currentState) {
          renderStatus({
            ...currentState,
            error: String(error),
          });
        }
      });
  });

  await showWindowWhenReady();
}

interface ConnectedExtension {
  instanceUid: string;
  browser?: string;
  label?: string;
  windowsCount: number;
}

interface ListenerState {
  address: string;
  error?: string;
  listening: boolean;
  port: number;
  debugEnabled: boolean;
  extensions: ConnectedExtension[];
}
