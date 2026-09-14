import type { AttachmentMode, MenuOrientation } from "@browserail/protocol";
import browser from "webextension-polyfill";

import { createMenu, loadConfig, saveConfig, type StoredMenu } from "../config";
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
const desktopEnabled = element<HTMLInputElement>("desktop-enabled");
const desktopUrl = element<HTMLInputElement>("desktop-url");
const desktopUrlField = element<HTMLLabelElement>("desktop-url-field");
const testDesktop = element<HTMLButtonElement>("test-desktop");
const desktopTestStatus = element<HTMLOutputElement>("desktop-test-status");
const attachmentMode = element<HTMLSelectElement>("attachment-mode");
const alwaysOnTop = element<HTMLInputElement>("always-on-top");
const menusContainer = element<HTMLDivElement>("menus");
const addMenu = element<HTMLButtonElement>("add-menu");
const status = element<HTMLOutputElement>("status");

let menus: StoredMenu[] = [];
let bookmarkOptions: BookmarkOption[] = [];
let bookmarkLabels = new Map<string, string>();
let desktopTestGeneration = 0;

void initialize();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void persist();
});

addMenu.addEventListener("click", () => {
  menus.push(createMenu());
  renderMenus();
});

desktopEnabled.addEventListener("change", () => {
  updateDesktopControls();
  if (desktopEnabled.checked) {
    void testDesktopAddress();
  } else {
    clearDesktopTestStatus();
  }
});
randomInstanceLabel.addEventListener("click", () => {
  instanceLabel.value = createRandomInstanceLabel();
});
testDesktop.addEventListener("click", () => void testDesktopAddress());
desktopUrl.addEventListener("input", clearDesktopTestStatus);

async function initialize(): Promise<void> {
  const [config, tree] = await Promise.all([loadConfig(), browser.bookmarks.getTree()]);
  bookmarkOptions = flattenBookmarks(tree);
  bookmarkLabels = new Map(bookmarkOptions.map((option) => [option.id, option.label]));

  instanceLabel.value = config.instanceLabel;
  desktopEnabled.checked = config.desktopWidget.enabled;
  desktopUrl.value = config.desktopWidget.url;
  attachmentMode.value = config.attachmentMode;
  alwaysOnTop.checked = config.panel.alwaysOnTop;
  menus = structuredClone(config.panel.menus);
  updateDesktopControls();
  if (desktopEnabled.checked) {
    void testDesktopAddress();
  }
  renderMenus();
}

async function persist(): Promise<void> {
  if (desktopEnabled.checked && !isLocalDesktopUrl(desktopUrl.value)) {
    desktopUrl.setCustomValidity("Use a ws:// localhost address");
    desktopUrl.reportValidity();
    return;
  }
  desktopUrl.setCustomValidity("");

  await saveConfig({
    instanceLabel: instanceLabel.value,
    attachmentMode: attachmentMode.value as AttachmentMode,
    desktopWidget: {
      enabled: desktopEnabled.checked,
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

      const orientationLabel = document.createElement("label");
      orientationLabel.textContent = "Direction";
      const orientation = document.createElement("select");
      orientation.append(new Option("Row", "row"), new Option("Column", "column"));
      orientation.value = menu.orientation;
      orientation.addEventListener("change", () => {
        menu.orientation = orientation.value as MenuOrientation;
      });
      orientationLabel.append(orientation);

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

      card.append(header, orientationLabel, addRow, items);
      return card;
    }),
  );
}

function updateDesktopControls(): void {
  desktopUrl.disabled = !desktopEnabled.checked;
  testDesktop.disabled = !desktopEnabled.checked;
  desktopUrlField.toggleAttribute("data-disabled", !desktopEnabled.checked);
}

async function testDesktopAddress(): Promise<void> {
  const generation = ++desktopTestGeneration;
  const url = desktopUrl.value;
  setDesktopTestStatus("Connecting…", "pending");
  try {
    await probeDesktopConnection(url);
    if (generation === desktopTestGeneration && desktopEnabled.checked && desktopUrl.value === url) {
      setDesktopTestStatus("Connected", "success");
    }
  } catch (error) {
    if (generation === desktopTestGeneration && desktopEnabled.checked && desktopUrl.value === url) {
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
