import type { ExpandAlignment, ExpandDirection, FolderEntry, LayoutEntry, MenuView } from "@browserail/protocol";

export interface Size { width: number; height: number }
export interface Rect { left: number; top: number; right: number; bottom: number }
export interface BarState {
  menu: MenuView;
  itemSize: Size;
  collapsed: boolean;
  editingLocked: boolean;
  fontFamily: string;
}
export interface PopupTheme {
  color?: string;
  fontFamily: string;
  fontSize: number;
  itemHeight: number;
}
export type PopupPin = "none" | "temporary" | "locked";
export type FolderPin = Exclude<PopupPin, "none">;

export interface PopupState {
  rootExpandOnHover?: boolean;
  entries: LayoutEntry[];
  theme: PopupTheme;
  direction: ExpandDirection;
  rootDirection: ExpandDirection;
  rootOffsetX: number;
  /** Top edge, bottom edge when expanding up, or anchor center for lateral center alignment. */
  rootOffsetY: number;
  expandAlignment?: ExpandAlignment;
  bounds: Rect;
  maxColumnHeight: number;
  editingLocked: boolean;
}
export interface Controller<State> {
  readonly ready: Promise<void>;
  update(state: State): Promise<void>;
  destroy(): void;
}
export interface MenuActions {
  invokeAction(actionUid: string): Promise<void>;
  requestToggleFold(): Promise<void>;
  requestTemporarySave(input: { uid: string; label: string }): Promise<void>;
}
export interface PopupRequest {
  folder: FolderEntry;
  anchor: Rect;
  theme: PopupTheme;
  direction: ExpandDirection;
  expandAlignment?: ExpandAlignment;
  editingLocked: boolean;
  pin: PopupPin;
}
export interface BarHost extends MenuActions {
  waitForFonts?(): Promise<unknown>;
  openPopup(request: PopupRequest, pointerInside: (inside: boolean) => void, pinChanged: (pin: PopupPin, rootPin: PopupPin) => void): Promise<PopupSession>;
  requestCustomize(): Promise<void>;
  commitHitRegion?(regions: Rect[] | null): Promise<void>;
}
export interface PopupSession {
  togglePin(pin: FolderPin): Promise<void>;
  dismiss(): Promise<void>;
  close(): Promise<void>;
  requestClose(): void;
  cancelClose(): void;
  setBarPointerInside(inside: boolean): void;
  readonly closed: Promise<void>;
}
export interface BarController extends Controller<BarState> {
  /** Report execution results; accepting a Native dispatch alone does not mean it succeeded. */
  setActionError(actionUid: string, error?: string): void;
}
export interface PopupController extends Controller<PopupState> {
  toggleRootPin(pin: FolderPin): void;
  dismiss(): void;
}
export interface PopupLayout { columns: Rect[] }
export interface PopupHost extends MenuActions {
  readonly pin: PopupPin;
  setPin(pin: PopupPin, rootPin: PopupPin): Promise<void>;
  waitForFonts?(): Promise<unknown>;
  close(): Promise<void>;
  setPointerInside(inside: boolean): void;
  commitLayout(layout: PopupLayout): Promise<void>;
}
