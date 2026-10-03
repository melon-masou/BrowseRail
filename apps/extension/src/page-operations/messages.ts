import type { MenuView } from "@browserail/protocol";
import type { BrowserMenuPlacement } from "../config";

export interface BrowserMenu {
  view: MenuView;
  placement: BrowserMenuPlacement;
  collapsed: boolean;
  editingLocked: boolean;
}
export interface BrowserMenuState { type: "state"; menus: BrowserMenu[] }
export type MenuRequest = { menuUid: string } & (
  | { type: "invoke"; actionUid: string }
  | { type: "fold" }
  | { type: "temporaryConfirm"; uid: string }
  | { type: "temporarySave"; uid: string; note: string }
  | { type: "placement"; placement: BrowserMenuPlacement }
);
export type TemporaryConfirmationResult = "opened" | "prompt";
export interface MenuReply { error?: string; result?: TemporaryConfirmationResult; state?: BrowserMenuState }
