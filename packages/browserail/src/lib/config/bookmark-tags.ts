import type { CustomBookmarkType } from "@browserail/protocol";

export function normalizeBookmarkTags(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : []).flatMap((tag) =>
    typeof tag === "string" && tag.trim() ? [tag.trim()] : [],
  ))];
}

interface TaggableBookmark {
  readonly uid: string;
  readonly name: string;
  readonly tags?: readonly string[];
}

export interface BookmarkTagSources {
  readonly staticBookmarks?: readonly TaggableBookmark[];
  readonly temporaryBookmarks?: readonly TaggableBookmark[];
  readonly dynamicBookmarks?: readonly TaggableBookmark[];
  readonly externalActions?: readonly TaggableBookmark[];
}

export function customBookmarkTagDefinitions(sources: BookmarkTagSources): Array<TaggableBookmark & { type: CustomBookmarkType }> {
  const collections: Array<[CustomBookmarkType, readonly TaggableBookmark[] | undefined]> = [
    ["static", sources.staticBookmarks], ["temporary", sources.temporaryBookmarks],
    ["dynamic", sources.dynamicBookmarks], ["externalAction", sources.externalActions],
  ];
  return collections.flatMap(([type, bookmarks]) => (bookmarks ?? []).map(bookmark => ({ ...bookmark, type })));
}

export function allBookmarkTags(sources: BookmarkTagSources): string[] {
  return normalizeBookmarkTags(customBookmarkTagDefinitions(sources).flatMap(bookmark => bookmark.tags ?? [])).sort();
}
