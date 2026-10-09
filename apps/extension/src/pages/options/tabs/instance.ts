import { type DisplayMode } from "../../../lib/config";
import { isLocalDesktopUrl } from "../../../lib/desktop/connection";
import { createRandomInstanceLabel } from "../../../lib/config/instance-label";
import { t } from "@browserail/i18n";
import { element } from "../dom";
import { createScope } from "../lifecycle";
import { type OptionsState } from "../state";
import { type BookmarkLibrary } from "../bookmark-library";
import { type BookmarkPicker } from "../components/bookmark-picker";
import { browserActions } from "../browser";

export function mountInstanceTab(
  state: OptionsState,
  library: BookmarkLibrary,
  bookmarkPicker: BookmarkPicker,
  initialEnabled: boolean,
) {
  const scope = createScope();
  const displayMode = element<HTMLSelectElement>("display-mode");
  const instanceLabel = element<HTMLInputElement>("instance-label");
  const randomInstanceLabel = element<HTMLButtonElement>("random-instance-label");
  const desktopUrl = element<HTMLInputElement>("desktop-url");
  const stateCard = element<HTMLDivElement>("state-card");
  const stateBadge = element<HTMLSpanElement>("state-badge");
  const stateDetail = element<HTMLDivElement>("state-detail");
  const testDesktop = element<HTMLButtonElement>("test-desktop");
  const desktopTestStatus = element<HTMLOutputElement>("desktop-test-status");
  const reconnectButton = element<HTMLButtonElement>("reconnect-button");
  const resyncButton = element<HTMLButtonElement>("resync-button");
  const resyncStatus = element<HTMLOutputElement>("resync-status");
  const bookmarkRootInput = document.getElementById(
    "bookmark-root-input",
  ) as HTMLInputElement | null;
  const pickBookmarkRootBtn = document.getElementById(
    "pick-bookmark-root-btn",
  ) as HTMLButtonElement | null;
  if (pickBookmarkRootBtn) pickBookmarkRootBtn.disabled = !library.available;
  let widgetEnabled = initialEnabled;
  let desktopTestGeneration = 0;

  scope.add(browserActions.onDesktopState(renderDesktopState));
  scope.add(browserActions.onRuntimeState((runtime) => {
    if (scope.signal.aborted || widgetEnabled === runtime.enabled) return;
    widgetEnabled = runtime.enabled;
    if (!widgetEnabled || state.savedDisplayMode === "browser") renderDesktopState("disabled");
    else void refreshDesktopState();
  }));

  instanceLabel.addEventListener(
    "input",
    () => state.editInstance({ label: instanceLabel.value }),
    { signal: scope.signal },
  );

  displayMode.addEventListener(
    "change",
    () => state.editInstance({ displayMode: displayMode.value as DisplayMode }),
    { signal: scope.signal },
  );

  desktopUrl.addEventListener(
    "input",
    () => {
      desktopUrl.setCustomValidity("");
      clearDesktopTestStatus();
      state.editInstance({ desktopUrl: desktopUrl.value });
    },
    { signal: scope.signal },
  );

  randomInstanceLabel.addEventListener(
    "click",
    () => {
      instanceLabel.value = createRandomInstanceLabel();
      state.editInstance({ label: instanceLabel.value });
    },
    { signal: scope.signal },
  );

  testDesktop.addEventListener("click", () => void testDesktopAddress(), { signal: scope.signal });

  reconnectButton.addEventListener(
    "click",
    () => {
      void manualReconnect();
    },
    { signal: scope.signal },
  );

  resyncButton.addEventListener("click", () => void resyncDesktopWindows(), {
    signal: scope.signal,
  });

  function setBookmarkRootPrefix(segments: string[]): void {
    state.editInstance({ rootPrefix: segments });
    if (bookmarkRootInput)
      bookmarkRootInput.value = library.formatRoot([...state.instance.rootPrefix]);
  }

  let resyncStatusTimer: ReturnType<typeof setTimeout> | undefined;

  function clearResyncStatus(): void {
    if (scope.signal.aborted) return;
    if (resyncStatusTimer !== undefined) {
      clearTimeout(resyncStatusTimer);
      resyncStatusTimer = undefined;
    }
    resyncStatus.value = "";
    delete resyncStatus.dataset.state;
  }

  function setResyncStatus(
    state: "pending" | "success" | "error",
    message: string,
    autoClearMs = 0,
  ): void {
    if (scope.signal.aborted) return;
    if (resyncStatusTimer !== undefined) {
      clearTimeout(resyncStatusTimer);
      resyncStatusTimer = undefined;
    }
    resyncStatus.dataset.state = state;
    resyncStatus.value = message;
    if (autoClearMs > 0) {
      resyncStatusTimer = scope.timeout(() => {
        clearResyncStatus();
      }, autoClearMs);
    }
  }

  async function manualReconnect(): Promise<void> {
    clearResyncStatus();
    renderDesktopState("connecting", t("state.detail.reconnectingToWidget"));
    try {
      await browserActions.reconnect();
    } catch {
      // Ignore
    }
  }

  async function resyncDesktopWindows(): Promise<void> {
    clearResyncStatus();
    resyncButton.disabled = true;
    resyncButton.textContent = t("resync.resyncing");
    setResyncStatus("pending", t("resync.closingRebuilding"));
    try {
      const result = (await browserActions.resync()) as
        { ok?: boolean; message?: string } | undefined;
      setResyncStatus(
        result?.ok ? "success" : "error",
        result?.message ?? t("resync.failed"),
        3500,
      );
    } catch {
      setResyncStatus("error", t("resync.backgroundUnavailable"), 3500);
    } finally {
      if (!scope.signal.aborted) {
        resyncButton.textContent = t("btn.resync");
        resyncButton.disabled = stateCard.dataset.state !== "connected";
      }
    }
  }

  function renderDesktopState(connectionState: string, detail?: string): void {
    if (scope.signal.aborted) return;
    stateCard.dataset.state = connectionState;
    stateBadge.textContent = badgeLabel(connectionState);
    stateDetail.textContent = detail || defaultDetailForState(connectionState);
    resyncButton.disabled = connectionState !== "connected";
    reconnectButton.disabled = connectionState === "disabled";
    if (connectionState !== "connected") {
      clearResyncStatus();
    }
  }

  const KNOWN_STATES = [
    "connected",
    "connecting",
    "syncing",
    "handshaking",
    "reconnecting",
    "disconnected",
    "disabled",
  ] as const;

  function badgeLabel(state: string): string {
    const known = KNOWN_STATES.find((s) => s === state);
    return known ? t(`state.badge.${known}`) : state;
  }

  function defaultDetailForState(connectionState: string): string {
    switch (connectionState) {
      case "connected":
        return t("state.detail.connected");
      case "syncing":
        return t("state.detail.syncing");
      case "connecting":
        return t("state.detail.connecting");
      case "handshaking":
        return t("state.detail.handshaking");
      case "reconnecting":
        return t("state.detail.reconnecting");
      case "disabled":
        return t(
          widgetEnabled && state.savedDisplayMode === "browser"
            ? "state.detail.browserInjection"
            : "state.detail.disabled",
        );
      case "disconnected":
      default:
        return t("state.detail.disconnected");
    }
  }

  async function refreshDesktopState(): Promise<void> {
    try {
      const response = (await browserActions.desktopState()) as
        { state?: string; detail?: string } | undefined;
      if (!scope.signal.aborted && response?.state) {
        renderDesktopState(response.state);
      }
    } catch {
      // Ignore if background is unavailable
    }
  }

  function updateDesktopControls(): void {
    desktopUrl.disabled = state.savedDisplayMode === "browser";
    testDesktop.disabled = state.savedDisplayMode === "browser";
  }

  async function testDesktopAddress(): Promise<void> {
    const generation = ++desktopTestGeneration;
    const url = desktopUrl.value;
    setDesktopTestStatus(t("test.connecting"), "pending");
    await new Promise<void>((resolve) => scope.timeout(resolve, 500));
    if (generation !== desktopTestGeneration) {
      return;
    }
    try {
      await browserActions.probeDesktop(url);
      if (generation === desktopTestGeneration && desktopUrl.value === url) {
        setDesktopTestStatus(t("test.connected"), "success");
      }
    } catch (error) {
      if (generation === desktopTestGeneration && desktopUrl.value === url) {
        setDesktopTestStatus(
          error instanceof Error ? error.message : t("test.connectionFailed"),
          "error",
        );
      }
    }
  }

  function clearDesktopTestStatus(): void {
    desktopTestGeneration += 1;
    desktopTestStatus.textContent = "";
    delete desktopTestStatus.dataset.state;
  }

  function setDesktopTestStatus(message: string, state: "pending" | "success" | "error"): void {
    desktopTestStatus.textContent = message;
    desktopTestStatus.dataset.state = state;
  }

  const debugLoggingToggle = document.getElementById(
    "debug-logging-toggle",
  ) as HTMLInputElement | null;
  const copyDebugBtn = document.getElementById("copy-debug-btn") as HTMLButtonElement | null;
  const copyDebugStatus = document.getElementById("copy-debug-status") as HTMLSpanElement | null;

  void browserActions
    .diagnosticsEnabled()
    .then((enabled) => {
      if (scope.signal.aborted) return;
      if (debugLoggingToggle) {
        debugLoggingToggle.checked = enabled;
      }
      if (copyDebugBtn) {
        copyDebugBtn.disabled = !enabled;
      }
    })
    .catch(() => {});

  debugLoggingToggle?.addEventListener(
    "change",
    async () => {
      const enabled = Boolean(debugLoggingToggle.checked);
      if (copyDebugBtn) {
        copyDebugBtn.disabled = !enabled;
      }
      try {
        await browserActions.setDiagnosticsEnabled(enabled);
        if (!scope.signal.aborted && copyDebugStatus) {
          const msg = enabled ? t("diagnostics.loggingEnabled") : t("diagnostics.loggingDisabled");
          copyDebugStatus.textContent = msg;
          scope.timeout(() => {
            if (copyDebugStatus.textContent === msg) {
              copyDebugStatus.textContent = "";
            }
          }, 2500);
        }
      } catch (err) {
        if (!scope.signal.aborted && copyDebugStatus) {
          copyDebugStatus.textContent = t("diagnostics.setFailed", { error: String(err) });
        }
      }
    },
    { signal: scope.signal },
  );

  copyDebugBtn?.addEventListener(
    "click",
    async () => {
      if (!debugLoggingToggle?.checked) {
        if (!scope.signal.aborted && copyDebugStatus) {
          copyDebugStatus.textContent = t("diagnostics.notEnabled");
        }
        return;
      }

      if (copyDebugBtn) copyDebugBtn.disabled = true;
      if (!scope.signal.aborted && copyDebugStatus)
        copyDebugStatus.textContent = t("diagnostics.collecting");

      try {
        const combined = await browserActions.debugInfo();
        if (scope.signal.aborted) return;
        const text = JSON.stringify(combined, null, 2);
        let copied = false;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(text);
            copied = true;
          } catch {
            // fallback to textarea
          }
        }
        if (!copied) {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          copied = document.execCommand("copy");
          document.body.removeChild(textarea);
        }

        if (!scope.signal.aborted && copyDebugStatus) {
          const msg = copied ? t("diagnostics.copied") : t("diagnostics.copyFailed");
          copyDebugStatus.textContent = msg;
          scope.timeout(() => {
            if (copyDebugStatus.textContent === msg) {
              copyDebugStatus.textContent = "";
            }
          }, 3000);
        }
      } catch (err) {
        if (!scope.signal.aborted && copyDebugStatus) {
          copyDebugStatus.textContent = t("diagnostics.fetchFailed", { error: String(err) });
        }
      } finally {
        if (!scope.signal.aborted && copyDebugBtn)
          copyDebugBtn.disabled = !debugLoggingToggle?.checked;
      }
    },
    { signal: scope.signal },
  );

  async function pickRoot(): Promise<void> {
    const root = library.root();
    const result = await bookmarkPicker.pick({
      mode: "root",
      title: t("picker.selectRootTitle"),
      confirmLabel: t("picker.selectRootConfirm"),
      ...(root ? { selectedId: root.id } : {}),
      rootPrefix: state.instance.rootPrefix,
    });
    if (result) setBookmarkRootPrefix(result.rootPrefix);
  }
  function render(): void {
    const current = state.instance;
    instanceLabel.value = current.label;
    desktopUrl.value = current.desktopUrl;
    displayMode.value = current.displayMode;
    if (bookmarkRootInput) {
      bookmarkRootInput.readOnly = true;
      bookmarkRootInput.value = library.formatRoot([...current.rootPrefix]);
    }
    updateDesktopControls();
    renderDesktopState(stateCard.dataset.state ?? "disconnected");
  }
  pickBookmarkRootBtn?.addEventListener("click", () => void pickRoot(), { signal: scope.signal });
  scope.add(state.subscribe(["instance"], render));
  render();
  void refreshDesktopState();
  return {
    render,
    refresh: refreshDesktopState,
    discard(): void {
      desktopUrl.setCustomValidity("");
      clearDesktopTestStatus();
      state.discardInstance();
    },
    validate(): boolean {
      if (!isLocalDesktopUrl(state.instance.desktopUrl)) {
        desktopUrl.setCustomValidity(t("validation.localWsAddress"));
        desktopUrl.reportValidity();
        return false;
      }
      desktopUrl.setCustomValidity("");
      return true;
    },
    destroy(): void {
      ++desktopTestGeneration;
      scope.destroy();
    },
  };
}
