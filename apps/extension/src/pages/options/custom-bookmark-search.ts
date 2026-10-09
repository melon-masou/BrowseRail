import type { CustomBookmarkType } from "@browserail/protocol";
import type { StaticBookmark, TemporaryBookmark, DynamicBookmark, ExternalAction, UrlRule } from "../../lib/config";
import type { CustomBookmarkSource } from "./custom-bookmark-source";
import type { ReadonlyData } from "./state";

export interface CustomBookmarkSearchContext {
  source?: CustomBookmarkSource;
  urlRules?: readonly ReadonlyData<UrlRule>[];
}

/** Extracts all searchable text tokens for a custom bookmark definition. */
export function getCustomBookmarkSearchableText(
  type: CustomBookmarkType,
  item: ReadonlyData<StaticBookmark | TemporaryBookmark | DynamicBookmark | ExternalAction>,
  context?: CustomBookmarkSearchContext,
): string {
  const parts: string[] = [item.name];
  switch (type) {
    case "static": {
      const b = item as ReadonlyData<StaticBookmark>;
      if (b.url) parts.push(b.url);
      if (b.tags?.length) parts.push(...b.tags);
      break;
    }
    case "temporary": {
      const b = item as ReadonlyData<TemporaryBookmark>;
      const liveUrl = context?.source?.temporaryValues[b.uid];
      const liveNote = context?.source?.temporaryNotes[b.uid];
      if (liveUrl) parts.push(liveUrl);
      if (liveNote) parts.push(liveNote);
      break;
    }
    case "dynamic": {
      const b = item as ReadonlyData<DynamicBookmark>;
      const live = context?.source?.dynamicValues[b.uid];
      if (live?.url) parts.push(live.url);
      if (live?.title) parts.push(live.title);
      if (b.urlRuleUid && context?.urlRules) {
        const rule = context.urlRules.find(r => r.uid === b.urlRuleUid);
        if (rule?.name) parts.push(rule.name);
      }
      if (b.rewrite) parts.push(b.rewrite);
      break;
    }
    case "externalAction": {
      const b = item as ReadonlyData<ExternalAction>;
      if (b.eventName) parts.push(b.eventName);
      if (b.extensionId) parts.push(b.extensionId);
      if (b.data) parts.push(b.data);
      if (b.urlRuleUid && context?.urlRules) {
        const rule = context.urlRules.find(r => r.uid === b.urlRuleUid);
        if (rule?.name) parts.push(rule.name);
      }
      break;
    }
  }
  return parts.join(" ");
}

/**
 * Checks if searchable text matches all whitespace-separated terms in the query.
 * Empty query matches everything. #terms search only tags; matching is case-insensitive.
 */
export function matchesSearchQuery(searchableText: string, query: string, tags: readonly string[] = []): boolean {
  const trimmed = query.trim().toLocaleLowerCase();
  if (!trimmed) return true;
  const terms = trimmed.split(/\s+/);
  const text = searchableText.toLocaleLowerCase();
  const tagNames = tags.map(tag => tag.toLocaleLowerCase());
  return terms.every(term => term.startsWith("#") ? tagNames.some(tag => tag.includes(term.slice(1))) : text.includes(term));
}

/**
 * Filters a collection of custom bookmarks based on a search query.
 */
export function filterCustomBookmarks<T extends StaticBookmark | TemporaryBookmark | DynamicBookmark | ExternalAction>(
  type: CustomBookmarkType,
  items: readonly ReadonlyData<T>[],
  query: string,
  context?: CustomBookmarkSearchContext,
): readonly ReadonlyData<T>[] {
  const trimmed = query.trim();
  if (!trimmed) return items;
  return items.filter(item => {
    const text = getCustomBookmarkSearchableText(type, item, context);
    const tags = type === "static" ? (item as ReadonlyData<StaticBookmark>).tags ?? [] : [];
    return matchesSearchQuery(text, trimmed, tags);
  });
}
