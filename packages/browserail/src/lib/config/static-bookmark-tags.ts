export function normalizeStaticBookmarkTags(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : []).flatMap((tag) =>
    typeof tag === "string" && tag.trim() ? [tag.trim()] : [],
  ))];
}
