import type { AttachmentMode, MenuFontSize, MenuOrientation } from "@browserail/protocol";
import browser from "webextension-polyfill";

import {
  createMenu,
  loadConfig,
  loadWidgetEnabled,
  saveConfig,
  saveWidgetEnabled,
  type StoredMenu,
} from "../config";
import { isLocalDesktopUrl, probeDesktopConnection } from "../desktop-connection";
import { createRandomInstanceLabel } from "../instance-label";

import "./styles.css";

interface BookmarkOption {
  id: string;
  label: string;
}

const form = element<HTMLFormElement>("settings");
const instanceLabel = element<HTMLInputElement>("instance-label");
const randomInstanceLabel = element<HTMLButtonElement>("random-instance-label");
const toggleEnabledButton = element<HTMLButtonElement>("toggle-enabled-button");
const desktopUrl = element<HTMLInputElement>("desktop-url");
const stateCard = element<HTMLDivElement>("state-card");
const stateBadge = element<HTMLSpanElement>("state-badge");
const stateDetail = element<HTMLDivElement>("state-detail");
const testDesktop = element<HTMLButtonElement>("test-desktop");
const desktopTestStatus = element<HTMLOutputElement>("desktop-test-status");
const attachmentMode = element<HTMLSelectElement>("attachment-mode");
const alwaysOnTop = element<HTMLInputElement>("always-on-top");
const menusContainer = element<HTMLDivElement>("menus");
const addMenu = element<HTMLButtonElement>("add-menu");
const status = element<HTMLOutputElement>("status");
const reconnectButton = element<HTMLButtonElement>("reconnect-button");
const resyncButton = element<HTMLButtonElement>("resync-button");
const resyncStatus = element<HTMLOutputElement>("resync-status");

let widgetEnabled = true;

let menus: StoredMenu[] = [];
let bookmarkOptions: BookmarkOption[] = [];
let bookmarkLabels = new Map<string, string>();
let desktopTestGeneration = 0;

void initialize();

browser.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "desktopStateChanged" &&
    "state" in message &&
    typeof message.state === "string"
  ) {
    const detail =
      "detail" in message && typeof message.detail === "string" ? message.detail : undefined;
    renderDesktopState(message.state, detail);
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void persist();
});

addMenu.addEventListener("click", () => {
  menus.push(createMenu());
  renderMenus();
});

toggleEnabledButton.addEventListener("click", () => {
  widgetEnabled = !widgetEnabled;
  updateDesktopControls();
  if (!widgetEnabled) {
    renderDesktopState("disabled", "Connection disabled");
  } else {
    renderDesktopState("connecting", "Connecting to Desktop Widget…");
  }
  void saveWidgetEnabled(widgetEnabled);
  void browser.runtime.sendMessage({ type: "setWidgetEnabled", enabled: widgetEnabled });
});

randomInstanceLabel.addEventListener("click", () => {
  instanceLabel.value = createRandomInstanceLabel();
});

testDesktop.addEventListener("click", () => void testDesktopAddress());
desktopUrl.addEventListener("input", clearDesktopTestStatus);

reconnectButton.addEventListener("click", () => {
  void manualReconnect();
});
resyncButton.addEventListener("click", () => void resyncDesktopWindows());

stateCard.addEventListener("click", (event) => {
  if (
    widgetEnabled &&
    event.target !== reconnectButton &&
    event.target !== resyncButton &&
    event.target !== toggleEnabledButton &&
    stateCard.dataset.state !== "connected"
  ) {
    void manualReconnect();
  }
});

async function manualReconnect(): Promise<void> {
  renderDesktopState("connecting", "Reconnecting to Desktop Widget…");
  try {
    await browser.runtime.sendMessage({ type: "manualReconnect" });
  } catch {
    // Ignore
  }
}

async function resyncDesktopWindows(): Promise<void> {
  resyncButton.disabled = true;
  resyncButton.textContent = "Resyncing…";
  resyncStatus.dataset.state = "pending";
  resyncStatus.value = "Closing and rebuilding windows…";
  try {
    const result = (await browser.runtime.sendMessage({ type: "resyncWindows" })) as
      | { ok?: boolean; message?: string }
      | undefined;
    resyncStatus.dataset.state = result?.ok ? "success" : "error";
    resyncStatus.value = result?.message ?? "Resync failed";
  } catch {
    resyncStatus.dataset.state = "error";
    resyncStatus.value = "Background is unavailable";
  } finally {
    resyncButton.textContent = "Resync";
    resyncButton.disabled = stateCard.dataset.state !== "connected";
  }
}

function renderDesktopState(state: string, detail?: string): void {
  stateCard.dataset.state = state;
  stateBadge.textContent = state;
  stateDetail.textContent = detail || defaultDetailForState(state);
  resyncButton.disabled = state !== "connected";
}

function defaultDetailForState(state: string): string {
  switch (state) {
    case "connected":
      return "Connected and synchronized with Desktop Widget";
    case "syncing":
      return "Synchronizing menu layouts with Desktop Widget…";
    case "connecting":
      return "Attempting to connect to Desktop Widget…";
    case "handshaking":
      return "Verifying protocol handshake with Desktop Widget…";
    case "reconnecting":
      return "Connection lost, retrying…";
    case "disabled":
      return "Desktop connection is disabled in settings";
    case "disconnected":
    default:
      return "Not connected to Desktop Widget";
  }
}

async function refreshDesktopState(): Promise<void> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: "getDesktopState",
    })) as { state?: string; detail?: string } | undefined;
    if (response?.state) {
      renderDesktopState(response.state, response.detail);
    }
  } catch {
    // Ignore if background is unavailable
  }
}

async function initialize(): Promise<void> {
  void refreshDesktopState();
  const [config, enabled, tree] = await Promise.all([
    loadConfig(),
    loadWidgetEnabled(),
    browser.bookmarks.getTree(),
  ]);
  bookmarkOptions = flattenBookmarks(tree);
  bookmarkLabels = new Map(bookmarkOptions.map((option) => [option.id, option.label]));

  instanceLabel.value = config.instanceLabel;
  widgetEnabled = enabled;
  desktopUrl.value = config.desktopWidget.url;
  attachmentMode.value = config.attachmentMode;
  alwaysOnTop.checked = config.panel.alwaysOnTop;
  menus = structuredClone(config.panel.menus);
  updateDesktopControls();
  renderMenus();
}

async function persist(): Promise<void> {
  if (!isLocalDesktopUrl(desktopUrl.value)) {
    desktopUrl.setCustomValidity("Use a ws:// localhost address");
    desktopUrl.reportValidity();
    return;
  }
  desktopUrl.setCustomValidity("");

  await saveConfig({
    instanceLabel: instanceLabel.value,
    attachmentMode: attachmentMode.value as AttachmentMode,
    desktopWidget: {
      url: desktopUrl.value,
    },
    panel: {
      alwaysOnTop: alwaysOnTop.checked,
      menus,
    },
  });
  await browser.runtime.sendMessage({ type: "configSaved" });
  status.value = "Saved";
  setTimeout(() => {
    status.value = "";
  }, 1_500);
}

function renderMenus(): void {
  menusContainer.replaceChildren(
    ...menus.map((menu, menuIndex) => {
      const card = document.createElement("article");
      card.className = "menu-card";

      const header = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = `Menu ${menuIndex + 1}`;
      const removeMenu = actionButton("Remove menu", () => {
        menus.splice(menuIndex, 1);
        renderMenus();
      });
      header.append(title, removeMenu);

      const configGrid = document.createElement("div");
      configGrid.style.display = "grid";
      configGrid.style.gridTemplateColumns = "1fr 1fr";
      configGrid.style.gap = "12px";

      const orientationLabel = document.createElement("label");
      orientationLabel.textContent = "Direction";
      const orientation = document.createElement("select");
      orientation.append(new Option("Row", "row"), new Option("Column", "column"));
      orientation.value = menu.orientation;
      orientation.addEventListener("change", () => {
        menu.orientation = orientation.value as MenuOrientation;
      });
      orientationLabel.append(orientation);

      const fontSizeLabel = document.createElement("label");
      fontSizeLabel.textContent = "Font size";
      const fontSizeSelect = document.createElement("select");
      fontSizeSelect.append(
        new Option("Small (Compact)", "small"),
        new Option("Medium (Default)", "medium"),
        new Option("Large (Spacious)", "large"),
      );
      fontSizeSelect.value = menu.fontSize ?? "medium";
      fontSizeSelect.addEventListener("change", () => {
        menu.fontSize = fontSizeSelect.value as MenuFontSize;
      });
      fontSizeLabel.append(fontSizeSelect);

      configGrid.append(orientationLabel, fontSizeLabel);

      const addRow = document.createElement("div");
      addRow.className = "add-row";
      const picker = document.createElement("select");
      picker.append(...bookmarkOptions.map((option) => new Option(option.label, option.id)));
      const addItem = actionButton("Add item", () => {
        if (picker.value && !menu.items.some((item) => item.bookmarkId === picker.value)) {
          menu.items.push({ bookmarkId: picker.value });
          renderMenus();
        }
      });
      addRow.append(picker, addItem);

      const items = document.createElement("ol");
      items.replaceChildren(
        ...menu.items.map((item, itemIndex) => {
          const row = document.createElement("li");
          const label = document.createElement("span");
          label.textContent = bookmarkLabels.get(item.bookmarkId) ?? item.bookmarkId;
          const remove = actionButton("−", () => {
            menu.items.splice(itemIndex, 1);
            renderMenus();
          });
          row.append(label, remove);
          return row;
        }),
      );

      card.append(header, configGrid, addRow, items);
      return card;
    }),
  );
}

function updateDesktopControls(): void {
  toggleEnabledButton.textContent = widgetEnabled ? "Disable" : "Enable";
  toggleEnabledButton.dataset.action = widgetEnabled ? "disable" : "enable";
}

async function testDesktopAddress(): Promise<void> {
  const generation = ++desktopTestGeneration;
  const url = desktopUrl.value;
  setDesktopTestStatus("Connecting…", "pending");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (generation !== desktopTestGeneration) {
    return;
  }
  try {
    await probeDesktopConnection(url);
    if (generation === desktopTestGeneration && desktopUrl.value === url) {
      setDesktopTestStatus("Connected", "success");
    }
  } catch (error) {
    if (generation === desktopTestGeneration && desktopUrl.value === url) {
      setDesktopTestStatus(
        error instanceof Error ? error.message : "Connection failed",
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

function setDesktopTestStatus(
  message: string,
  state: "pending" | "success" | "error",
): void {
  desktopTestStatus.textContent = message;
  desktopTestStatus.dataset.state = state;
}

function actionButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function flattenBookmarks(
  nodes: browser.Bookmarks.BookmarkTreeNode[],
  depth = 0,
): BookmarkOption[] {
  return nodes.flatMap((node) => {
    const current = node.id === "0" ? [] : [{ id: node.id, label: `${"  ".repeat(depth)}${node.title || "Bookmarks"}` }];
    return [...current, ...flattenBookmarks(node.children ?? [], depth + 1)];
  });
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) {
    throw new Error(`Missing #${id}`);
  }
  return value as T;
}

const refreshDebugBtn = document.getElementById("refresh-debug-btn") as HTMLButtonElement | null;
const copyDebugBtn = document.getElementById("copy-debug-btn") as HTMLButtonElement | null;
const debugOutput = document.getElementById("debug-output") as HTMLPreElement | null;

async function loadDebugInfo(): Promise<void> {
  if (!debugOutput) return;
  debugOutput.textContent = "Loading debug info...";
  try {
    const extInfo = await browser.runtime
      .sendMessage({ type: "getDebugInfo" })
      .catch((err) => ({ error: String(err) }));
    let desktopInfo: unknown = null;
    try {
      const res = await fetch("http://127.0.0.1:17654/debug");
      if (res.ok) {
        desktopInfo = await res.json();
      } else {
        desktopInfo = { status: res.status, statusText: res.statusText };
      }
    } catch (fetchErr) {
      desktopInfo = {
        error: `Failed to fetch http://127.0.0.1:17654/debug: ${String(fetchErr)}`,
      };
    }

    const combined = {
      timestamp: new Date().toISOString(),
      extension: extInfo,
      desktop: desktopInfo,
    };
    debugOutput.textContent = JSON.stringify(combined, null, 2);
  } catch (err) {
    debugOutput.textContent = `Error loading debug info: ${String(err)}`;
  }
}

refreshDebugBtn?.addEventListener("click", () => void loadDebugInfo());
copyDebugBtn?.addEventListener("click", () => {
  if (debugOutput?.textContent) {
    void navigator.clipboard.writeText(debugOutput.textContent);
  }
});
