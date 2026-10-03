import { t } from "@browserail/i18n";
import { AUTO_FONT_SIZE, type BarSettings, type NativeBarSettings } from "@browserail/protocol";
import { automaticButtonFontSize } from "../appearance";

export function mountBarSettings(root: HTMLElement, initial: BarSettings | NativeBarSettings, changed: (settings: BarSettings | NativeBarSettings) => void, itemHeight: number) {
  const doc = root.ownerDocument;
  const abort = new AbortController();
  let draft = structuredClone(initial);
  let autoFontSize = automaticButtonFontSize(itemHeight);
  root.classList.add("bar-settings");
  function notify(): void {
    buttonFont.refresh();
    popupFont.refresh();
    changed(structuredClone(draft));
  }
  function label(key: Parameters<typeof t>[0], input: HTMLElement): void {
    const row = doc.createElement(input.tagName === "DIV" ? "div" : "label");
    row.className = "bar-settings-field";
    const text = doc.createElement("span"); text.textContent = t(key);
    row.append(text, input); root.append(row);
  }
  function select(key: Parameters<typeof t>[0], value: string, choices: [string, Parameters<typeof t>[0]][], set: (value: string) => void): HTMLSelectElement {
    const input = doc.createElement("select");
    for (const [value, key] of choices) {
      const option = doc.createElement("option"); option.value = value; option.textContent = t(key); input.append(option);
    }
    input.value = value;
    input.addEventListener("change", () => { set(input.value); notify(); }, { signal: abort.signal });
    label(key, input); return input;
  }
  select("menuSettings.direction", draft.orientation, [["column", "menuSettings.column"], ["row", "menuSettings.row"]], value => { draft.orientation = value === "row" ? "row" : "column"; });
  function number(value: number, set: (value: number) => void): HTMLInputElement {
    const input = doc.createElement("input"); input.type = "number"; input.min = "1"; input.step = "1"; input.value = String(value);
    input.addEventListener("input", () => {
      if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) return;
      set(input.valueAsNumber); notify();
    }, { signal: abort.signal }); return input;
  }
  function fontSetting(key: Parameters<typeof t>[0], field: "buttonFontSize" | "popupFontSize", automatic: () => number) {
    const font = number(draft[field] === AUTO_FONT_SIZE ? automatic() : draft[field], value => { draft[field] = value; });
    font.setAttribute("aria-label", t(key));
    const auto = doc.createElement("input"); auto.type = "checkbox"; auto.checked = draft[field] === AUTO_FONT_SIZE;
    font.disabled = auto.checked;
    const fontRow = doc.createElement("div"); fontRow.className = "bar-settings-font";
    const autoLabel = doc.createElement("label"); autoLabel.append(auto, t("menuSettings.buttonFontSizeAuto")); fontRow.append(font, autoLabel);
    auto.addEventListener("change", () => {
      draft[field] = auto.checked ? AUTO_FONT_SIZE : (font.validity.valid && Number.isFinite(font.valueAsNumber) ? font.valueAsNumber : automatic());
      notify();
    }, { signal: abort.signal });
    label(key, fontRow);
    return {
      refresh(): void {
        font.disabled = draft[field] === AUTO_FONT_SIZE;
        if (font.disabled) font.value = String(automatic());
      },
    };
  }
  const buttonFont = fontSetting("menuSettings.buttonFontSize", "buttonFontSize", () => autoFontSize);
  const popupFont = fontSetting("menuSettings.popupFontSize", "popupFontSize", () => draft.buttonFontSize === AUTO_FONT_SIZE ? autoFontSize : Math.max(1, Math.round(draft.buttonFontSize)));
  select("menuSettings.expandDirection", draft.expandDirection ?? "", [["", "expandDirection.default"], ["down", "expandDirection.down"], ["up", "expandDirection.up"], ["right", "expandDirection.right"], ["left", "expandDirection.left"]], value => {
    if (!value) delete draft.expandDirection; else draft.expandDirection = value as NonNullable<BarSettings["expandDirection"]>;
  });
  select("menuSettings.expandAlignment", draft.expandAlignment, [["edge", "expandAlignment.edge"], ["center", "expandAlignment.center"]], value => { draft.expandAlignment = value === "center" ? "center" : "edge"; });
  if ("attachmentMode" in draft) {
    let onTop: HTMLSelectElement;
    select("form.attachTo", draft.attachmentMode, [["lastFocused", "form.attach.lastFocused"], ["all", "form.attach.all"], ["free", "form.attach.free"]], value => {
      const native = draft as NativeBarSettings;
      native.attachmentMode = value as NativeBarSettings["attachmentMode"];
      if (value === "free") native.onTopMode = "alwaysOnTop";
      onTop.value = native.onTopMode; onTop.disabled = value === "free";
    });
    onTop = select("form.onTopMode", draft.onTopMode, [["aboveBrowser", "form.onTopMode.aboveBrowser"], ["alwaysOnTop", "form.onTopMode.alwaysOnTop"]], value => { (draft as NativeBarSettings).onTopMode = value as NativeBarSettings["onTopMode"]; });
    onTop.disabled = draft.attachmentMode === "free";
  }
  return {
    updateItemHeight(height: number): void {
      autoFontSize = automaticButtonFontSize(height);
      buttonFont.refresh();
      popupFont.refresh();
    },
    destroy(): void { abort.abort(); root.replaceChildren(); root.classList.remove("bar-settings"); },
  };
}

export function createSettingsIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
  const path = doc.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z");
  const circle = doc.createElementNS(svg.namespaceURI, "circle"); circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", "3"); svg.append(path, circle); return svg;
}
