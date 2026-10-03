export const DEFAULT_COLOR = "#3b82f6ff";

export function withColorAlpha(rgb: string, alpha: number): string {
  return `${rgb.slice(0, 7).toLowerCase()}${Math.round(Math.max(0, Math.min(255, alpha)))
    .toString(16)
    .padStart(2, "0")}`;
}

export function createColorPicker(
  root: HTMLElement,
  onChange: (color: string) => void,
  signal: AbortSignal,
) {
  const rgb = root.querySelector<HTMLInputElement>("#popover-color-input")!;
  const hex = root.querySelector<HTMLInputElement>("#popover-color-hex")!;
  const transparency = root.querySelector<HTMLInputElement>("#popover-color-transparency")!;
  const percentage = root.querySelector<HTMLOutputElement>("#popover-color-transparency-value")!;
  let value = DEFAULT_COLOR;

  function render(showHex = true, preserveText = false) {
    rgb.value = value.slice(0, 7);
    if (!preserveText) hex.value = showHex ? value.toUpperCase() : "";
    const alpha = parseInt(value.slice(7), 16);
    transparency.value = String(Math.round((1 - alpha / 255) * 100));
    percentage.value = `${transparency.value}%`;
    transparency.style.setProperty("--picker-color", rgb.value);
  }

  function commit(color: string, preserveText = false) {
    value = color.toLowerCase();
    render(true, preserveText);
    onChange(value);
  }

  function setRgb(color: string) {
    commit(withColorAlpha(color, parseInt(value.slice(7), 16)));
  }

  rgb.addEventListener("input", () => setRgb(rgb.value), { signal });
  hex.addEventListener(
    "input",
    () => {
      const color = `#${hex.value.trim().replace(/^#/, "")}`;
      if (/^#[0-9a-f]{8}$/i.test(color)) commit(color, true);
      else if (/^#[0-9a-f]{6}$/i.test(color))
        commit(withColorAlpha(color, parseInt(value.slice(7), 16)), true);
    },
    { signal },
  );
  transparency.addEventListener(
    "input",
    () => {
      commit(withColorAlpha(value, 255 * (1 - Number(transparency.value) / 100)));
    },
    { signal },
  );

  return {
    setRgb,
    setValue(color: string | undefined, defaultColor = DEFAULT_COLOR) {
      const current = color || defaultColor;
      value = current.length === 7 ? `${current}ff` : current;
      render(Boolean(color));
    },
  };
}
