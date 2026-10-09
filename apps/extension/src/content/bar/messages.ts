import type { MenuView, MenuSpacing, BarSettings } from "@browserail/protocol";
import type { BrowserMenuPlacement } from "../../lib/config";

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
  | { type: "editBegin" | "editEnd"; token: string }
  | { type: "layout"; token: string; settings: BarSettings; placement: BrowserMenuPlacement; spacing: MenuSpacing }
);
export type TemporaryConfirmationResult = "opened" | "prompt";
export type MenuCommandResult = TemporaryConfirmationResult | boolean;
export interface MenuReply { error?: string; result?: MenuCommandResult; state?: BrowserMenuState }
