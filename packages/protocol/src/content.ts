// Messages between the extension and its content scripts. They cross into web pages, so both
// sides depend only on this contract, never on each other's code.
import type { BarSettings } from "./bar";
import type { MenuView, MenuSpacing } from "./menu";
import type { MenuAnchor } from "./native";

/** Browser-mode bar position inside the page viewport. */
export interface BrowserMenuPlacement {
  anchor: MenuAnchor;
  offsetX: number;
  offsetY: number;
  itemWidth: number;
  itemHeight: number;
}

// Bar: the extension sends the state to render; the bar sends user commands back.
export const BAR_SNAPSHOT_MESSAGE = "browserMenusSnapshot";
export const BAR_COMMAND_MESSAGE = "browserMenuCommand";
export const BAR_REFRESH_MESSAGE = "browserMenusRefresh";

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

// Bridge: relays userscript events to the extension and external actions back to the page.
export const EXTERNAL_RELAY_MESSAGE = "externalUpdate";
export const EXTERNAL_RECEIVER_CONFIG = "externalReceiverConfig";
export const EXTERNAL_RUN_MESSAGE = "externalRunAction";
/** Tells bridges to fetch the token again after userscript access changes. */
export const EXTERNAL_RECEIVER_REFRESH = "externalReceiverRefresh";

/** The DOM event userscripts dispatch to send updates through the bridge. */
export function userscriptUpdateEvent(token: string): string {
  return `browserail:${token}`;
}
