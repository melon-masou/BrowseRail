import type { BrowserActionKind, StoredMenu } from "@browserail/protocol";

export function toggleTargetMenus(
  menus: StoredMenu[],
  sourceMenuUid: string,
  targetMenuUids: string[],
): StoredMenu[] | undefined {
  const targets = new Set(targetMenuUids.filter((uid) => uid !== sourceMenuUid));
  const selected = menus.filter((menu) => targets.has(menu.uid));
  if (selected.length === 0) return undefined;
  const enabled = !selected.every((menu) => menu.enabled !== false);
  return menus.map((menu) => targets.has(menu.uid) ? { ...menu, enabled } : menu);
}

export async function runTabAction(
  tabs: {
    query(query: { active: true; windowId: number }): Promise<Array<{ id?: number }>>;
    goBack(tabId: number): Promise<unknown>;
    goForward(tabId: number): Promise<unknown>;
    reload(tabId: number): Promise<unknown>;
  },
  windowUid: string,
  kind: BrowserActionKind,
): Promise<void> {
  const windowId = Number(windowUid);
  if (!Number.isInteger(windowId)) return;
  const [tab] = await tabs.query({ active: true, windowId });
  if (tab?.id === undefined) return;
  if (kind === "back") await tabs.goBack(tab.id);
  else if (kind === "forward") await tabs.goForward(tab.id);
  else await tabs.reload(tab.id);
}
