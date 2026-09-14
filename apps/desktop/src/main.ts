import type {
  LayoutEntry,
  MenuAnchor,
  MenuPlacement,
  MenuSnapshot,
} from "@browserail/protocol";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import "./styles.css";

const root = requiredElement("app");
const query = new URLSearchParams(location.search);

if (query.get("view") === "host") {
  document.body.replaceChildren();
} else if (query.get("view") === "settings") {
  void initializeListenerSettings();
} else {
  void initializeSurface();
}

async function initializeSurface(): Promise<void> {
  const instanceUid = requiredQuery("instanceUid");
  const windowUid = requiredQuery("windowUid");
  const menuUid = requiredQuery("menuUid");
  const surface = query.get("surface") === "popup" ? "popup" : "menu";
  const initial = await invoke<SurfaceState>("surface_state", {
    instanceUid,
    menuUid,
    surface,
    windowUid,
  });
  document.body.dataset.surface = surface;
  root.addEventListener("pointerenter", () => {
    void cancelPopupClose(instanceUid, windowUid, menuUid);
  });
  root.addEventListener("pointerleave", () => {
    void schedulePopupClose(instanceUid, windowUid, menuUid);
  });

  let customizing = false;
  let currentMenu = initial.menu;

  await listen<MenuSnapshot>("menu-state", ({ payload }) => {
    if (surface === "menu" && payload.uid === menuUid && !customizing) {
      if (
        currentMenu &&
        currentMenu.orientation === payload.orientation &&
        currentMenu.items.length === payload.items.length &&
        currentMenu.items.every(
          (item, i) => item.uid === payload.items[i]?.uid && item.label === payload.items[i]?.label,
        )
      ) {
        currentMenu = payload;
        return;
      }
      currentMenu = payload;
      renderMenu(payload);
    }
  });
  await listen<PopupPayload>("popup-state", ({ payload }) => {
    if (surface === "popup") {
      renderPopup(payload);
    }
  });
  await listen<{ ok: boolean; message?: string }>("action-result", ({ payload }) => {
    root.toggleAttribute("data-error", !payload.ok);
    root.title = payload.ok ? "" : (payload.message ?? "Action failed");
  });

  if (surface === "menu" && initial.menu) {
    renderMenu(initial.menu);
  } else if (surface === "popup" && initial.payload) {
    renderPopup(initial.payload);
  }

  function renderMenu(menu: MenuSnapshot): void {
    root.className = "menu";
    root.ariaLabel = "BrowseRail menu";
    root.dataset.orientation = menu.orientation;
    root.style.setProperty("--item-count", String(Math.max(1, menu.items.length)));
    if (menu.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-menu";
      empty.textContent = "Empty menu · add items in extension";
      root.replaceChildren(empty);
    } else {
      root.replaceChildren(
        ...menu.items.map((entry) => renderMenuEntry(entry, instanceUid, windowUid, menuUid)),
      );
    }
    root.onpointerdown = (event) => {
      if (event.button === 2) {
        event.preventDefault();
        void invoke("begin_menu_customization")
          .then(() => {
            customizing = true;
            renderCustomize(currentMenu ?? menu);
          })
          .catch(showSurfaceError);
      }
    };
    root.oncontextmenu = (event) => event.preventDefault();
  }

  function renderCustomize(menu: MenuSnapshot): void {
    let anchor = menu.placement.anchor;
    root.className = "menu customize";
    root.replaceChildren();
    root.dataset.orientation = menu.orientation;
    root.onpointerdown = null;
    root.oncontextmenu = (event) => event.preventDefault();

    const toolbar = document.createElement("div");
    toolbar.className = "customize-toolbar";
    const anchorButton = controlButton(anchorLabel(anchor));
    anchorButton.title = "Change anchor";
    anchorButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        anchor = nextAnchor(anchor);
        anchorButton.textContent = anchorLabel(anchor);
      }
    });
    const moveButton = controlButton("Move");
    moveButton.classList.add("move-handle");
    moveButton.addEventListener("pointerdown", () => {
      void invoke("start_menu_drag");
    });
    const cancelButton = controlButton("×");
    cancelButton.title = "Cancel";
    cancelButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        void cancelCustomization();
      }
    });
    const saveButton = controlButton("✓");
    saveButton.title = "Save";
    saveButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        void saveCustomization();
      }
    });
    toolbar.append(anchorButton, moveButton, cancelButton, saveButton);
    root.append(toolbar, resizeHandle("east"), resizeHandle("south"), resizeHandle("southEast"));

    async function cancelCustomization(): Promise<void> {
      customizing = false;
      await invoke("cancel_menu_customization", { instanceUid, menuUid, windowUid });
      if (currentMenu) {
        renderMenu(currentMenu);
      }
    }

    async function saveCustomization(): Promise<void> {
      const placement = await invoke<MenuPlacement>("save_menu_placement", {
        anchor,
        instanceUid,
        menuUid,
        windowUid,
      });
      customizing = false;
      if (currentMenu) {
        currentMenu = { ...currentMenu, placement };
        renderMenu(currentMenu);
      }
    }
  }

  function resizeHandle(direction: "east" | "south" | "southEast"): HTMLElement {
    const handle = document.createElement("div");
    handle.className = `resize-handle resize-${direction}`;
    handle.addEventListener("pointerdown", () => {
      void invoke("start_menu_resize", { direction });
    });
    return handle;
  }

  function renderPopup(payload: PopupPayload): void {
    let levels: LayoutEntry[][] = [payload.entries];
    let expandedUids: string[] = [];
    root.className = "popup";
    root.ariaLabel = "BrowseRail bookmark menu";

    renderLevels();

    function renderLevels(): void {
      root.replaceChildren(
        ...levels.map((entries, level) => {
          const column = document.createElement("div");
          column.className = "menu-column";
          column.append(
            ...entries.map((entry) => {
              const button = menuButton(entry, true);
              if (entry.kind === "folder") {
                button.toggleAttribute("data-expanded", expandedUids[level] === entry.uid);
                button.addEventListener("pointerenter", () => {
                  levels = [...levels.slice(0, level + 1), entry.children];
                  expandedUids = [...expandedUids.slice(0, level), entry.uid];
                  renderLevels();
                });
              } else {
                button.addEventListener("pointerenter", () => {
                  if (levels.length > level + 1) {
                    levels = levels.slice(0, level + 1);
                    expandedUids = expandedUids.slice(0, level);
                    renderLevels();
                  }
                });
                button.addEventListener("pointerdown", (event) => {
                  if (event.button === 0) {
                    void invokePopupAction(entry.uid);
                  }
                });
              }
              return button;
            }),
          );
          return column;
        }),
      );

      requestAnimationFrame(() => {
        const width = Math.min(900, 16 + levels.length * 220 + (levels.length - 1) * 4);
        const height = Math.min(520, Math.max(...levels.map(popupHeight)));
        void invoke("resize_popup", {
          height,
          instanceUid,
          menuUid,
          width,
          windowUid,
        }).then(() => {
          root.scrollLeft = root.scrollWidth;
        });
      });
    }

    async function invokePopupAction(actionUid: string): Promise<void> {
      await invokeAction(instanceUid, windowUid, actionUid);
      await invoke("close_popup", { instanceUid, menuUid, windowUid });
    }
  }
}

function renderMenuEntry(
  entry: LayoutEntry,
  instanceUid: string,
  windowUid: string,
  menuUid: string,
): HTMLElement {
  const button = menuButton(entry, false);
  if (entry.kind === "bookmark") {
    button.addEventListener("pointerenter", () => {
      void schedulePopupClose(instanceUid, windowUid, menuUid);
    });
    button.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        event.preventDefault();
        void invokeAction(instanceUid, windowUid, entry.uid);
      }
    });
  } else {
    const open = async () => {
      const bounds = button.getBoundingClientRect();
      await invoke("open_popup", {
        request: {
          anchor: { height: bounds.height, x: bounds.x, y: bounds.y },
          height: popupHeight(entry.children),
          instanceUid,
          menuUid,
          payload: { entries: entry.children },
          width: 236,
          windowUid,
        },
      });
    };
    button.addEventListener("pointerenter", () => void open());
    button.addEventListener("focus", () => void open());
  }
  return button;
}

function menuButton(entry: LayoutEntry, popup: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-button";
  button.toggleAttribute("data-popup", popup);
  button.textContent = entry.label;
  button.title = entry.label;
  if (entry.kind === "folder") {
    button.dataset.folder = "";
    button.setAttribute("aria-haspopup", "menu");
  }
  return button;
}

function controlButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "customize-control";
  button.textContent = label;
  return button;
}

function nextAnchor(anchor: MenuAnchor): MenuAnchor {
  const anchors: MenuAnchor[] = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
  return anchors[(anchors.indexOf(anchor) + 1) % anchors.length]!;
}

function anchorLabel(anchor: MenuAnchor): string {
  return { topLeft: "TL", topRight: "TR", bottomLeft: "BL", bottomRight: "BR" }[anchor];
}

async function invokeAction(
  instanceUid: string,
  windowUid: string,
  actionUid: string,
): Promise<void> {
  try {
    await invoke("invoke_action", { actionUid, instanceUid, windowUid });
  } catch (error) {
    root.dataset.error = "";
    root.title = String(error);
  }
}

function showSurfaceError(error: unknown): void {
  root.dataset.error = "";
  root.title = String(error);
}

function popupHeight(entries: LayoutEntry[]): number {
  return Math.min(520, Math.max(48, 16 + entries.length * 38));
}

async function cancelPopupClose(
  instanceUid: string,
  windowUid: string,
  menuUid: string,
): Promise<void> {
  await invoke("cancel_popup_close", { instanceUid, menuUid, windowUid });
}

async function schedulePopupClose(
  instanceUid: string,
  windowUid: string,
  menuUid: string,
): Promise<void> {
  try {
    await invoke("schedule_popup_close", { instanceUid, menuUid, windowUid });
  } catch {
    // A Menu can be hovered before it has opened a Popup.
  }
}

async function initializeListenerSettings(): Promise<void> {
  document.body.dataset.view = "settings";
  root.className = "listener-settings";

  const heading = document.createElement("h1");
  heading.textContent = "Desktop Widget listener";
  const description = document.createElement("p");
  description.textContent = "The extension address must use the same port.";
  const form = document.createElement("form");
  const label = document.createElement("label");
  label.textContent = "Port";
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = "65535";
  input.required = true;
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Apply";
  const status = document.createElement("output");
  label.append(input);
  form.append(label, save, status);
  root.append(heading, description, form);

  const current = await invoke<ListenerState>("listener_state");
  input.value = String(current.port);
  status.value = describeListener(current);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePort();
  });

  async function savePort(): Promise<void> {
    save.disabled = true;
    status.value = "Changing listener…";
    try {
      const next = await invoke<ListenerState>("set_listener_port", {
        port: input.valueAsNumber,
      });
      status.value = describeListener(next);
    } catch (error) {
      status.value = String(error);
    } finally {
      save.disabled = false;
    }
  }
}

function describeListener(listener: ListenerState): string {
  if (listener.listening) {
    return `Listening on ${listener.address}`;
  }
  return listener.error ? `Not listening: ${listener.error}` : "Not listening";
}

interface PopupPayload {
  entries: LayoutEntry[];
}

interface SurfaceState {
  kind: "menu" | "popup";
  menu?: MenuSnapshot;
  payload?: PopupPayload;
}

interface ListenerState {
  address: string;
  error?: string;
  listening: boolean;
  port: number;
}

function requiredQuery(name: string): string {
  const value = query.get(name);
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function requiredElement(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) {
    throw new Error(`Missing #${id}`);
  }
  return value;
}
