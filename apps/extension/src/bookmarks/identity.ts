export function menuItemIdentity(itemUid: string, bookmarkId?: string): string {
  const item = encodeURIComponent(itemUid);
  return bookmarkId === undefined ? item : `${item}#${encodeURIComponent(bookmarkId)}`;
}

export function parseMenuItemIdentity(identity: string): { itemUid: string; bookmarkId?: string } {
  const separator = identity.indexOf("#");
  return separator < 0
    ? { itemUid: decodeURIComponent(identity) }
    : { itemUid: decodeURIComponent(identity.slice(0, separator)), bookmarkId: decodeURIComponent(identity.slice(separator + 1)) };
}

export function menuEntryIdentity(uid: string): { itemUid: string; bookmarkId?: string } {
  const separator = uid.indexOf(":");
  const kind = uid.slice(0, separator);
  if (separator < 0 || !["bookmark", "folder", "static", "dynamic", "temporary", "noop", "browserAction", "menusToggle"].includes(kind)) return { itemUid: uid };
  const identity = decodeURIComponent(uid.slice(separator + 1).split("?")[0]!);
  return kind === "browserAction" || kind === "menusToggle" ? { itemUid: identity } : parseMenuItemIdentity(identity);
}
