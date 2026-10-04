export const SYSTEM_FONT_FAMILY = '"Segoe UI", "Microsoft YaHei", "PingFang SC", Arial, sans-serif';

export const COMMON_FONT_FAMILIES = ["Arial", "Microsoft YaHei", "PingFang SC", "Segoe UI"] as const;

export function resolveFontFamily(family?: string): string {
  const name = family?.trim();
  if (!name) return SYSTEM_FONT_FAMILY;
  // Font names are a single CSS string, never an executable family-list fragment.
  const quoted = `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r\f]/g, " ")}"`;
  return `${quoted}, ${SYSTEM_FONT_FAMILY}`;
}
