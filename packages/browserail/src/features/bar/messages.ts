// Options page → background: forget a bar's saved position in the current display mode.
import type { Replies } from "@browserail/protocol/message";
import { isRecord, messageType } from "../../lib/messaging";

export const MENU_LAYOUT_RESET = "resetMenuLayout";

export type MenuLayoutReset = { type: typeof MENU_LAYOUT_RESET; menuUid: string } & Replies<{ ok: true }>;

export function isMenuLayoutReset(value: unknown): value is MenuLayoutReset {
  return messageType(value) === MENU_LAYOUT_RESET && isRecord(value) && typeof value.menuUid === "string";
}
