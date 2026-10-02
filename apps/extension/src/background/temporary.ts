import type { TemporaryBookmark } from "../config";
import { saveTemporaryValue } from "../config";

export async function captureTemporaryUrl(
  tabs: { query(query: { active: true; windowId: number }): Promise<Array<{ url?: string }>> },
  definitions: TemporaryBookmark[],
  uid: string,
  windowUid: string,
  confirmed: boolean,
  note = "",
): Promise<"saved" | "needsConfirmation" | "unavailable"> {
  if (!definitions.some(entry => entry.uid === uid)) {
    return "unavailable";
  }
  if (!confirmed) return "needsConfirmation";
  const [tab] = await tabs.query({ active: true, windowId: Number(windowUid) });
  if (!tab?.url) return "unavailable";
  await saveTemporaryValue(uid, tab.url, note);
  return "saved";
}
