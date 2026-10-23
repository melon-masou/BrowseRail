import { t } from "@browserail/i18n";
import { matchesSearchQuery } from "../custom-bookmark-search";

export interface PickerItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly meta?: string;
  readonly tags?: readonly string[];
}

interface PickerTab {
  readonly label: string;
  readonly items: readonly PickerItem[];
  readonly emptyText?: string;
}

type PickerContent = readonly PickerItem[] | { readonly tabs: readonly PickerTab[] };

export function createItemPicker({ rememberSearch = false }: { rememberSearch?: boolean } = {}) {
  let dismiss: (() => void) | undefined;
  let destroyed = false;
  let searchQuery = "";

  function open(title: string, content: PickerContent, emptyText: string, multiple = false): Promise<string | string[] | null> {
      dismiss?.();
      if (destroyed) return Promise.resolve(null);
      return new Promise(resolve => {
        const dialog = document.createElement("dialog");
        dialog.className = "space-bookmark-dialog item-picker-dialog";
        dialog.setAttribute("aria-label", title);
        const header = document.createElement("div");
        header.className = "space-bookmark-dialog-header";
        const heading = document.createElement("span");
        heading.textContent = title;
        const close = document.createElement("button");
        close.type = "button";
        close.className = "color-popover-close";
        close.textContent = "✕";
        close.setAttribute("aria-label", t("common.close"));
        header.append(heading, close);
        const body = document.createElement("div");
        body.className = "space-bookmark-dialog-body";
        const tabs = "tabs" in content ? content.tabs : [];
        let activeTab = 0;
        let items = "tabs" in content ? tabs[0]?.items ?? [] : content;
        const search = document.createElement("input");
        search.type = "search";
        search.autocomplete = "off";
        search.value = rememberSearch ? searchQuery : "";
        search.placeholder = t("common.search");
        search.setAttribute("aria-label", t("common.search"));
        const list = document.createElement("div");
        list.className = "pick-menu-list";
        const selected = new Set<string>();
        let settled = false;
        function finish(id: string | string[] | null): void {
          if (settled) return;
          settled = true;
          if (dismiss === cancel) dismiss = undefined;
          dialog.close();
          dialog.remove();
          resolve(id);
        }
        function cancel(): void { finish(null); }
        dismiss = cancel;
        close.addEventListener("click", cancel);
        dialog.addEventListener("cancel", event => {
          event.preventDefault();
          cancel();
        });
        dialog.addEventListener("close", cancel);
        function render(): void {
          const query = search.value.trim().toLocaleLowerCase();
          const matches = items.filter(item => matchesSearchQuery(`${item.label} ${item.meta ?? ""} ${(item.tags ?? []).join(" ")}`, query, item.tags));
          list.replaceChildren();
          list.scrollTop = 0;
          for (const item of matches) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "pick-menu-item";
            const info = document.createElement("div");
            info.className = "pick-menu-item-info";
            if (item.icon) {
              const icon = document.createElement("span");
              icon.className = "pick-menu-item-icon";
              icon.textContent = item.icon;
              info.append(icon);
            }
            const label = document.createElement("span");
            label.className = "pick-menu-item-title";
            label.textContent = item.label;
            button.title = item.label;
            info.append(label);
            button.append(info);
            if (item.meta) {
              const meta = document.createElement("span");
              meta.className = "pick-menu-item-meta";
              meta.textContent = item.meta;
              meta.title = item.meta;
              button.append(meta);
            }
            if (multiple) button.setAttribute("aria-pressed", String(selected.has(item.id)));
            button.addEventListener("click", () => {
              if (!multiple) { finish(item.id); return; }
              if (selected.has(item.id)) selected.delete(item.id);
              else selected.add(item.id);
              button.setAttribute("aria-pressed", String(selected.has(item.id)));
            });
            list.append(button);
          }
          if (!matches.length) {
            const empty = document.createElement("p");
            empty.className = "url-rule-empty-hint";
            empty.textContent = items.length ? t("common.noMatches") : tabs[activeTab]?.emptyText ?? emptyText;
            list.append(empty);
          }
        }
        search.addEventListener("input", () => {
          if (rememberSearch) searchQuery = search.value;
          render();
        });
        if (tabs.length) {
          const navigation = document.createElement("div");
          navigation.className = "shortcuts-subtabs item-picker-tabs";
          tabs.forEach((tab, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "shortcuts-subtab-btn";
            button.classList.toggle("is-active", index === activeTab);
            button.setAttribute("aria-pressed", String(index === activeTab));
            button.textContent = tab.label;
            button.addEventListener("click", () => {
              activeTab = index;
              items = tab.items;
              if (!rememberSearch) search.value = "";
              for (const [position, control] of [...navigation.children].entries()) {
                control.classList.toggle("is-active", position === index);
                control.setAttribute("aria-pressed", String(position === index));
              }
              render();
              search.focus();
            });
            navigation.append(button);
          });
          body.append(navigation);
        }
        render();
        body.append(search, list);
        dialog.append(header, body);
        if (multiple) {
          const actions = document.createElement("div");
          actions.className = "space-bookmark-dialog-actions";
          const apply = document.createElement("button");
          apply.type = "button";
          apply.className = "action-btn";
          apply.textContent = t("picker.apply");
          apply.addEventListener("click", () => finish([...selected]));
          actions.append(apply);
          dialog.append(actions);
        }
        document.body.append(dialog);
        dialog.showModal();
        search.focus();
      });
  }
  return {
    async pick(title: string, content: PickerContent, emptyText = t("common.noMatches")): Promise<string | null> {
      const result = await open(title, content, emptyText);
      return typeof result === "string" ? result : null;
    },
    async pickMany(title: string, items: readonly PickerItem[], emptyText = t("common.noMatches")): Promise<string[] | null> {
      const result = await open(title, items, emptyText, true);
      return Array.isArray(result) ? result : null;
    },
    close(): void { dismiss?.(); },
    destroy(): void {
      destroyed = true;
      dismiss?.();
    },
  };
}
