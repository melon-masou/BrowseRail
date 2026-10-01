import type { StoredMenu } from "../config";
import { saveTemporaryValue } from "../config";

export async function captureTemporaryUrl(
  tabs: { query(query: { active: true; windowId: number }): Promise<Array<{ url?: string }>> },
  menus: StoredMenu[],
  uid: string,
  windowUid: string,
  confirmed: boolean,
  note = "",
): Promise<"saved" | "needsConfirmation" | "unavailable"> {
  if (!menus.some((menu) => menu.items.some((item) => item.type === "temporary" && item.uid === uid))) {
    return "unavailable";
  }
  if (!confirmed) return "needsConfirmation";
  const [tab] = await tabs.query({ active: true, windowId: Number(windowUid) });
  if (!tab?.url) return "unavailable";
  await saveTemporaryValue(uid, tab.url, note);
  return "saved";
}
