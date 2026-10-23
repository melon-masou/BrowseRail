import { t } from "@browserail/i18n";
import type { ItemIcon } from "@browserail/protocol";
import type { IconCatalog } from "../../../lib/icons/lucide";
import { loadIconCatalog, loadIconTags, loadIconUrl, type IconFamily } from "../../../lib/icons/item-icons";

type IconTab = "default" | IconFamily | "text" | "initial";

const COMMON_ICONS: Record<IconFamily, readonly string[]> = {
  phosphor: [
    "bookmark-simple", "book-open", "folder", "folder-open", "house", "star", "heart", "link", "magnifying-glass", "gear",
    "user", "users", "calendar", "clock", "bell", "envelope", "chat-circle", "file", "file-text", "image",
    "music-note", "video-camera", "play", "game-controller", "globe", "code", "terminal-window", "tag", "list", "squares-four",
    "download-simple", "upload-simple", "arrows-clockwise", "arrow-left", "arrow-right", "check-circle",
  ],
  lucide: [
    "bookmark", "book-open", "folder", "folder-open", "house", "star", "heart", "link", "search", "settings",
    "user", "users", "calendar", "clock", "bell", "mail", "message-circle", "file", "file-text", "image",
    "music", "video", "play", "gamepad-2", "globe", "code", "terminal", "tag", "list", "grid-2x2",
    "download", "upload", "refresh-cw", "arrow-left", "arrow-right", "circle-check",
  ],
};

const LIBRARIES: Record<IconFamily, { label: string; url: string }> = {
  phosphor: { label: "Phosphor", url: "https://phosphoricons.com/" },
  lucide: { label: "Lucide", url: "https://lucide.dev/icons/" },
};

const SEARCH_LIMIT = 120;

function prefixOf(label: string, length = 1): string {
  return Array.from(label.trim()).slice(0, length).join("");
}

export function createItemIconPicker(showError: (error: string) => void) {
  let dismiss: (() => void) | undefined;
  let destroyed = false;
  function close(): void { dismiss?.(); }

  function pick(icon: ItemIcon | undefined, label: string, change: (icon: ItemIcon | undefined) => void): void {
    dismiss?.();
    if (destroyed) return;
    const dialog = document.createElement("dialog");
    dialog.className = "space-bookmark-dialog icon-picker-dialog";
    dialog.setAttribute("aria-label", t("item.iconChoose"));
    let settled = false;
    // `null` closes without a change; `undefined` selects the default by removing the item's icon.
    function finish(next: ItemIcon | undefined | null): void {
      if (settled) return;
      settled = true;
      if (dismiss === cancel) dismiss = undefined;
      dialog.close();
      dialog.remove();
      if (next !== null) change(next);
    }
    function cancel(): void { finish(null); }
    dismiss = cancel;
    dialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); });
    dialog.addEventListener("close", cancel);

    const header = document.createElement("div");
    header.className = "space-bookmark-dialog-header";
    const heading = document.createElement("span");
    heading.textContent = t("item.iconChoose");
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "color-popover-close";
    closeButton.textContent = "✕";
    closeButton.setAttribute("aria-label", t("common.close"));
    closeButton.addEventListener("click", cancel);
    header.append(heading, closeButton);

    const body = document.createElement("div");
    body.className = "space-bookmark-dialog-body";
    const navigation = document.createElement("div");
    navigation.className = "shortcuts-subtabs item-picker-tabs";
    const panel = document.createElement("div");
    panel.className = "icon-picker-panel";
    body.append(navigation, panel);
    dialog.append(header, body);

    const tabs: { id: IconTab; label: string }[] = [
      { id: "default", label: t("item.iconDefault") },
      { id: "phosphor", label: LIBRARIES.phosphor.label },
      { id: "lucide", label: LIBRARIES.lucide.label },
      { id: "text", label: t("item.iconText") },
      { id: "initial", label: t("item.iconInitial") },
    ];
    // A tab switch invalidates catalog loads started by the previous tab.
    let panelRevision = 0;
    function showTab(tab: IconTab): void {
      for (const [index, control] of [...navigation.children].entries()) {
        const active = tabs[index]!.id === tab;
        control.classList.toggle("is-active", active);
        control.setAttribute("aria-pressed", String(active));
      }
      const revision = ++panelRevision;
      panel.replaceChildren();
      if (tab === "text") renderTextPanel();
      else if (tab === "initial") renderInitialPanel();
      else if (tab === "default") renderDefaultPanel();
      else void renderLibraryPanel(tab, revision);
    }
    for (const tab of tabs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "shortcuts-subtab-btn";
      button.textContent = tab.label;
      // Default is a choice, not a panel to browse: selecting it removes the item's icon at once.
      button.addEventListener("click", () => tab.id === "default" ? finish(undefined) : showTab(tab.id));
      navigation.append(button);
    }

    async function renderLibraryPanel(family: IconFamily, revision: number): Promise<void> {
      let catalog: IconCatalog;
      let tags: Record<string, readonly string[]>;
      try {
        [catalog, tags] = await Promise.all([loadIconCatalog(family), loadIconTags(family)]);
      } catch (error) {
        if (!destroyed && !settled) showError(String(error));
        return;
      }
      if (destroyed || settled || revision !== panelRevision) return;
      const current = icon?.type === family ? icon.name : undefined;
      const search = document.createElement("input");
      search.type = "search";
      search.placeholder = t("common.search");
      search.setAttribute("aria-label", t("common.search"));
      const grid = document.createElement("div");
      grid.className = "icon-picker-grid";
      const link = document.createElement("a");
      link.className = "action-btn icon-picker-library-link";
      link.href = LIBRARIES[family].url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = t("item.iconLibraryLink", { library: LIBRARIES[family].label });
      function renderGrid(): void {
        const query = search.value.trim().toLocaleLowerCase();
        let names: string[];
        if (query) {
          // Rank exact names, then name matches, then tag matches, so the limit keeps the closest results.
          const exact = catalog.names.includes(query) ? [query] : [];
          const byName = catalog.names.filter(name => name !== query && name.includes(query));
          const byTag = catalog.names.filter(name => !name.includes(query) && tags[name]?.some(tag => tag.includes(query)));
          names = [...exact, ...byName, ...byTag].slice(0, SEARCH_LIMIT);
        } else {
          names = [...COMMON_ICONS[family]];
          if (current && !names.includes(current)) names.unshift(current);
        }
        grid.replaceChildren(...names.map(name => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "icon-picker-cell";
          button.title = name;
          button.setAttribute("aria-label", name);
          button.setAttribute("aria-pressed", String(name === current));
          const image = document.createElement("img");
          image.src = catalog.iconUrl(name);
          image.alt = "";
          image.loading = "lazy";
          button.append(image);
          button.addEventListener("click", () => finish({ type: family, name }));
          return button;
        }));
        if (!names.length) {
          const empty = document.createElement("p");
          empty.className = "url-rule-empty-hint";
          empty.textContent = t("common.noMatches");
          grid.append(empty);
        }
        grid.scrollTop = 0;
      }
      search.addEventListener("input", renderGrid);
      renderGrid();
      const searchRow = document.createElement("div");
      searchRow.className = "icon-picker-text-row";
      searchRow.append(search, link);
      panel.append(searchRow, grid);
      search.focus();
    }

    function renderTextPanel(): void {
      const row = document.createElement("div");
      row.className = "icon-picker-text-row";
      const preview = document.createElement("span");
      preview.className = "icon-picker-cell icon-picker-preview";
      const input = document.createElement("input");
      input.type = "text";
      input.value = icon?.type === "text" ? icon.text : "";
      input.setAttribute("aria-label", t("item.iconText"));
      preview.textContent = input.value.trim();
      // Typing applies immediately; Enter only closes the picker.
      input.addEventListener("input", () => {
        const text = input.value.trim();
        preview.textContent = text;
        if (text) change({ type: "text", text });
      });
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); finish(null); }
      });
      row.append(preview, input);
      panel.append(row);
      input.focus();
    }

    function renderDefaultPanel(): void {
      const hint = document.createElement("p");
      hint.className = "icon-picker-hint";
      hint.textContent = t("item.iconDefaultHint");
      panel.append(hint);
    }

    function renderInitialPanel(): void {
      const row = document.createElement("div");
      row.className = "icon-picker-text-row";
      const current = icon?.type === "initial" ? icon.length ?? 1 : 0;
      for (const length of [1, 2] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "icon-picker-cell icon-picker-preview";
        button.textContent = prefixOf(label, length);
        button.title = t("item.iconPrefixLength", { count: length });
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-pressed", String(current === length));
        button.addEventListener("click", () => finish(length === 2 ? { type: "initial", length } : { type: "initial" }));
        row.append(button);
      }
      panel.append(row);
      (row.querySelector<HTMLElement>('[aria-pressed="true"]') ?? row.firstElementChild as HTMLElement).focus();
    }

    document.body.append(dialog);
    dialog.showModal();
    showTab(!icon ? "default" : icon.type);
  }

  return {
    button(icon: ItemIcon | undefined, label: string, change: (icon: ItemIcon | undefined) => void, beforeOpen: () => void): HTMLButtonElement {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "item-icon-btn";
      button.ariaLabel = t("item.iconChoose");
      const description = icon?.type === "lucide" || icon?.type === "phosphor"
        ? `${LIBRARIES[icon.type].label}: ${icon.name}`
        : icon?.type === "text" ? icon.text : icon ? t("item.iconInitial") : t("item.iconDefault");
      button.title = `${t("item.iconChoose")}: ${description}`;
      if (!icon || icon.type === "lucide" || icon.type === "phosphor") {
        // Unconfigured items show a neutral bookmark; the bar style decides what the bar itself shows.
        const [family, name] = icon ? [icon.type, icon.name] : ["lucide", "bookmark"] as const;
        const image = document.createElement("img");
        image.alt = "";
        button.append(image);
        void loadIconUrl(family, name).then(url => {
          if (!destroyed) image.src = url;
        }).catch(error => {
          if (!destroyed) showError(String(error));
        });
      } else {
        const text = document.createElement("span");
        text.textContent = icon.type === "text" ? icon.text : icon.type === "initial" ? prefixOf(label, icon.length) : "";
        button.append(text);
      }
      button.addEventListener("click", event => {
        event.stopPropagation(); beforeOpen(); pick(icon, label, change);
      });
      return button;
    },
    close,
    destroy(): void { destroyed = true; close(); },
  };
}
