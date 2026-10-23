import { t } from "@browserail/i18n";
import { createColorPicker, DEFAULT_COLOR } from "./color-picker";
import { positionPopover } from "./popover-position";
import { element } from "../dom";
import { createScope } from "../lifecycle";
import { type Overlays } from "./overlays";
export interface ColorValue {
  readonly type?: string;
  readonly color?: string;
  readonly dockColor?: string;
  readonly cycleColors?: readonly string[];
}
export type ColorField = "color" | "dockColor";
export interface ColorFieldOption {
  field: ColorField;
  label: string;
  defaultColor: string;
}
export interface ColorBinding {
  read(): ColorValue;
  setColor(field: ColorField, color: string | undefined): void;
  setCycleColors(colors: readonly string[]): void;
  onClose(): void;
  onChange(): void;
  defaultColor: string;
  title: string;
  /** The field the anchor swatch displays; the popover opens on it. */
  field: ColorField;
  /** When set, the header switches between these fields instead of showing the title. */
  fields?: readonly ColorFieldOption[];
}
const PALETTE_COLORS = [
  "#1a59e5", // Blue
  "#1aa0e5", // Sky
  "#1abee5", // Cyan
  "#1ae5a6", // Emerald
  "#1ae565", // Green
  "#91e51a", // Lime
  "#e5a41a", // Gold
  "#e5871a", // Amber
  "#e55f1a", // Orange
  "#e51a1a", // Red
  "#e51a74", // Pink
  "#cf1ae5", // Fuchsia
  "#651ae5", // Purple
  "#251ae5", // Indigo
  "#4776b8", // Slate
  "#3773c8", // Charcoal
  "#1ae5d3", // Teal
  "#e54d1a", // Rust
  "#e51a6c", // Wine
  "#2169de", // Navy
];

function getRandomPaletteColor(): string {
  return PALETTE_COLORS[Math.floor(Math.random() * PALETTE_COLORS.length)] ?? PALETTE_COLORS[0]!;
}

export { updateSwatchAppearance };
function updateSwatchAppearance(swatch: HTMLElement, color?: string): void {
  if (color) {
    swatch.style.background = "";
    swatch.style.backgroundColor = color;
    swatch.style.borderColor = color;
    swatch.classList.remove("has-no-color");
    swatch.title = t("color.swatchSet", { color });
  } else {
    swatch.style.background = "";
    swatch.style.backgroundColor = "transparent";
    swatch.style.borderColor = "#cbd5e1";
    swatch.classList.add("has-no-color");
    swatch.title = t("color.swatchEmpty");
  }
}

export function createColorPopover(overlays: Overlays) {
  const scope = createScope();
  const colorPopover = element<HTMLDivElement>("color-popover");
  const colorPopoverTitle = element<HTMLSpanElement>("color-popover-title");
  const colorPopoverClose = element<HTMLButtonElement>("color-popover-close");
  const colorPopoverPresets = element<HTMLDivElement>("color-popover-presets");
  const popoverRandomBtn = element<HTMLButtonElement>("popover-random-btn");
  const popoverDefaultBtn = element<HTMLButtonElement>("popover-default-btn");
  const colorPopoverCycleRow = element<HTMLDivElement>("color-popover-cycle-row");
  const colorPopoverCycleToggle = element<HTMLInputElement>("color-popover-cycle-toggle");
  const colorPopoverCycleSection = element<HTMLDivElement>("color-popover-cycle-section");
  const colorPopoverCycleList = element<HTMLDivElement>("color-popover-cycle-list");
  const colorPopoverFields = element<HTMLDivElement>("color-popover-fields");
  let binding: ColorBinding | null = null;
  let activeColorTarget: ColorValue | null = null;
  let activeColorField: ColorField = "color";
  let activeDefaultColor = DEFAULT_COLOR;
  let activeColorSwatchElement: HTMLElement | null = null;
  let selectedCycleIndex = -1;
  const home = colorPopover.parentElement!;
  const colorPicker = createColorPicker(colorPopover, setColor, scope.signal);
  function resolveColorTarget(): ColorValue | null {
    return binding?.read() ?? null;
  }
  function writeColor(value: string | undefined): void {
    binding?.setColor(activeColorField, value);
    activeColorTarget = resolveColorTarget();
    binding?.onChange();
  }
  function writeCycleColors(colors: readonly string[]): void {
    binding?.setCycleColors(colors);
    activeColorTarget = resolveColorTarget();
    binding?.onChange();
  }
  function closeColorPopover(): void {
    if (!binding) return;
    colorPopover.style.display = "none";
    home.append(colorPopover);
    const previous = binding;
    binding = null;
    activeColorTarget = null;
    activeColorSwatchElement = null;
    selectedCycleIndex = -1;
    previous.onClose();
  }
  function initColorPopover(): void {
    colorPopoverPresets.replaceChildren(
      ...PALETTE_COLORS.map((color) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "color-preset-dot";
        dot.style.backgroundColor = color;
        dot.title = color;
        dot.addEventListener(
          "click",
          () => {
            colorPicker.setRgb(color);
          },
          { signal: scope.signal },
        );
        return dot;
      }),
    );

    colorPopoverClose.addEventListener("click", () => closeColorPopover(), {
      signal: scope.signal,
    });

    colorPopoverCycleToggle.addEventListener(
      "change",
      () => {
        if (
          !activeColorTarget ||
          !("type" in activeColorTarget) ||
          activeColorTarget.type !== "flattenFolder"
        )
          return;
        const item = activeColorTarget as ColorValue;
        if (colorPopoverCycleToggle.checked) {
          if (!Array.isArray(item.cycleColors) || item.cycleColors.length === 0) {
            writeCycleColors([`${PALETTE_COLORS[0]}ff`, `${PALETTE_COLORS[3]}ff`]);
          }

          colorPopoverCycleSection.style.display = "block";
          selectedCycleIndex = 0;
          renderPopoverCycleList();
          const firstColor = (activeColorTarget as ColorValue).cycleColors?.[0] ?? DEFAULT_COLOR;
          colorPicker.setValue(firstColor);
        } else {
          writeCycleColors([]);

          colorPopoverCycleSection.style.display = "none";
          selectedCycleIndex = -1;
          colorPicker.setValue(undefined, activeDefaultColor);
        }
        updateActiveTargetSwatch();
      },
      { signal: scope.signal },
    );

    popoverRandomBtn.addEventListener(
      "click",
      () => {
        colorPicker.setRgb(getRandomPaletteColor());
      },
      { signal: scope.signal },
    );

    popoverDefaultBtn.addEventListener(
      "click",
      () => {
        if (!activeColorTarget || !activeColorSwatchElement) return;
        if ("type" in activeColorTarget && activeColorTarget.type === "flattenFolder") {
          const item = activeColorTarget as ColorValue;
          if (
            colorPopoverCycleToggle.checked &&
            Array.isArray(item.cycleColors) &&
            item.cycleColors.length > 0
          ) {
            if (item.cycleColors.length > 1 && selectedCycleIndex >= 0) {
              writeCycleColors(item.cycleColors.filter((_, index) => index !== selectedCycleIndex));
              selectedCycleIndex = Math.max(0, selectedCycleIndex - 1);
              renderPopoverCycleList();
              const curColor =
                (activeColorTarget as ColorValue).cycleColors?.[selectedCycleIndex] ??
                DEFAULT_COLOR;
              colorPicker.setValue(curColor);
            } else {
              writeCycleColors([]);

              colorPopoverCycleToggle.checked = false;
              colorPopoverCycleSection.style.display = "none";
              selectedCycleIndex = -1;
              colorPicker.setValue(undefined, activeDefaultColor);
            }
            updateActiveTargetSwatch();

            return;
          }
        }
        writeColor(undefined);
        colorPicker.setValue(undefined, activeDefaultColor);
        updateActiveTargetSwatch();
      },
      { signal: scope.signal },
    );

    document.addEventListener(
      "pointerdown",
      (e) => {
        if (colorPopover.style.display === "none") return;
        const target = e.target as Node | null;
        if (
          target &&
          !colorPopover.contains(target) &&
          activeColorSwatchElement &&
          !activeColorSwatchElement.contains(target)
        ) {
          closeColorPopover();
        }
      },
      { signal: scope.signal },
    );

    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && colorPopover.style.display !== "none") {
          closeColorPopover();
        }
      },
      { signal: scope.signal },
    );
  }

  function renderPopoverCycleList(): void {
    colorPopoverCycleList.replaceChildren();
    if (
      !activeColorTarget ||
      !("type" in activeColorTarget) ||
      activeColorTarget.type !== "flattenFolder"
    ) {
      return;
    }
    const item = activeColorTarget as ColorValue;
    (item.cycleColors ?? []).forEach((color, idx) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = `cycle-color-dot ${idx === selectedCycleIndex ? "is-selected" : ""}`;
      dot.style.backgroundColor = color;
      dot.title = color;

      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedCycleIndex = idx;
        renderPopoverCycleList();
        colorPicker.setValue(color);
      });

      const delBtn = document.createElement("span");
      delBtn.className = "cycle-color-dot-del";
      delBtn.textContent = "✕";
      delBtn.title = t("common.close");
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const colors =
          (resolveColorTarget() as ColorValue).cycleColors?.filter((_, index) => index !== idx) ??
          [];
        writeCycleColors(colors);
        if (selectedCycleIndex >= colors.length) selectedCycleIndex = colors.length - 1;
        if (!colors.length) {
          colorPopoverCycleToggle.checked = false;
          colorPopoverCycleSection.style.display = "none";
          selectedCycleIndex = -1;
          colorPicker.setValue(undefined, activeDefaultColor);
        } else {
          renderPopoverCycleList();
          colorPicker.setValue(colors[selectedCycleIndex] ?? DEFAULT_COLOR);
        }
        updateActiveTargetSwatch();
      });

      dot.appendChild(delBtn);
      colorPopoverCycleList.appendChild(dot);
    });

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "cycle-color-dot-add";
    addBtn.textContent = "+";
    addBtn.title = t("itemSettings.addColor");
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const colors = (resolveColorTarget() as ColorValue).cycleColors ?? [];
      const nextPreset = `${PALETTE_COLORS[colors.length % PALETTE_COLORS.length]}ff`;
      writeCycleColors([...colors, nextPreset]);
      selectedCycleIndex = colors.length;
      renderPopoverCycleList();
      colorPicker.setValue(nextPreset);
      updateActiveTargetSwatch();
    });
    colorPopoverCycleList.appendChild(addBtn);
  }

  function setColor(color: string): void {
    if (!activeColorTarget || !activeColorSwatchElement) return;
    if ("type" in activeColorTarget && activeColorTarget.type === "flattenFolder") {
      const colors = [...(activeColorTarget.cycleColors ?? [])];
      if (!colorPopoverCycleToggle.checked || !colors.length) {
        colorPopoverCycleToggle.checked = true;
        colorPopoverCycleSection.style.display = "block";
        selectedCycleIndex = 0;
        writeCycleColors([color]);
      } else {
        if (selectedCycleIndex < 0 || selectedCycleIndex >= colors.length) selectedCycleIndex = 0;
        colors[selectedCycleIndex] = color;
        writeCycleColors(colors);
      }
      renderPopoverCycleList();
    } else writeColor(color);
    updateActiveTargetSwatch();
  }

  function updateActiveTargetSwatch(): void {
    if (!activeColorTarget || !activeColorSwatchElement) return;
    if ("type" in activeColorTarget && activeColorTarget.type === "flattenFolder") {
      const colors = activeColorTarget.cycleColors;
      if (colors && colors.length > 0) {
        if (colors.length === 1) {
          const onlyColor = colors[0] ?? "";
          activeColorSwatchElement.style.background = "";
          activeColorSwatchElement.style.backgroundColor = onlyColor;
          activeColorSwatchElement.style.borderColor = onlyColor;
        } else {
          activeColorSwatchElement.style.background = `linear-gradient(135deg, ${colors.join(", ")})`;
          activeColorSwatchElement.style.borderColor = "transparent";
        }
        activeColorSwatchElement.classList.remove("has-no-color");
        activeColorSwatchElement.title = t("item.cycleColorsTitle", { count: colors.length });
      } else {
        activeColorSwatchElement.style.background = "";
        activeColorSwatchElement.style.backgroundColor = "transparent";
        activeColorSwatchElement.style.borderColor = "#cbd5e1";
        activeColorSwatchElement.classList.add("has-no-color");
        activeColorSwatchElement.title = t("item.cycleColorsEmpty");
      }
    } else {
      updateSwatchAppearance(activeColorSwatchElement, (activeColorTarget as ColorValue)[binding!.field]);
    }
  }

  function renderFieldSwitch(): void {
    const options = binding?.fields ?? [];
    colorPopoverFields.style.display = options.length ? "flex" : "none";
    colorPopoverFields.replaceChildren(
      ...options.map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "color-popover-field-btn";
        button.classList.toggle("is-active", option.field === activeColorField);
        button.setAttribute("aria-pressed", String(option.field === activeColorField));
        button.textContent = option.label;
        button.addEventListener("click", () => {
          if (option.field === activeColorField) return;
          activeColorField = option.field;
          activeDefaultColor = option.defaultColor;
          colorPicker.setValue(activeColorTarget?.[activeColorField], activeDefaultColor);
          renderFieldSwitch();
        });
        return button;
      }),
    );
  }

  scope.add(overlays.register("color", closeColorPopover));
  initColorPopover();
  return {
    get isOpen(): boolean {
      return binding !== null;
    },
    open(next: ColorBinding, swatch: HTMLElement): void {
      if (binding && activeColorSwatchElement === swatch) {
        closeColorPopover();
        return;
      }
      const rect = swatch.getBoundingClientRect();
      const dialog = swatch.closest("dialog");
      closeColorPopover();
      overlays.close("addItem");
      if (dialog?.id !== "menu-settings-dialog") overlays.close("menuSettings");
      const parent = dialog || home;
      parent.append(colorPopover);
      binding = next;
      activeColorTarget = next.read();
      activeColorField = next.field;
      activeDefaultColor = next.defaultColor;
      activeColorSwatchElement = swatch;
      const flatten = activeColorTarget.type === "flattenFolder";
      colorPopoverCycleRow.style.display = flatten ? "flex" : "none";
      colorPopoverTitle.style.display = flatten || next.fields?.length ? "none" : "block";
      colorPopoverTitle.textContent = next.title;
      renderFieldSwitch();
      const colors = flatten ? activeColorTarget.cycleColors : undefined;
      colorPopoverCycleToggle.checked = Boolean(colors?.length);
      colorPopoverCycleSection.style.display = colors?.length ? "block" : "none";
      selectedCycleIndex = colors?.length ? 0 : -1;
      if (colors?.length) {
        renderPopoverCycleList();
        colorPicker.setValue(colors[0]);
      } else colorPicker.setValue(activeColorTarget[activeColorField], activeDefaultColor);
      positionPopover(colorPopover, rect, 220);
    },
    close: closeColorPopover,
    destroy(): void {
      closeColorPopover();
      scope.destroy();
      colorPopoverCycleList.replaceChildren();
      colorPopoverFields.replaceChildren();
      colorPopoverPresets.replaceChildren();
    },
  };
}
export type ColorPopover = ReturnType<typeof createColorPopover>;
