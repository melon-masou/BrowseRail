import type { ExpandDirection, FolderEntry, LayoutEntry, MenuView } from "@browserail/protocol";

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
export interface PopupState {
  entries: LayoutEntry[];
  theme: PopupTheme;
  direction: ExpandDirection;
  rootDirection: ExpandDirection;
  rootOffsetX: number;
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
  editingLocked: boolean;
}
export interface BarHost extends MenuActions {
  waitForFonts?(): Promise<unknown>;
  openPopup(request: PopupRequest): Promise<PopupSession>;
  requestCustomize(): Promise<void>;
}
export interface PopupSession {
  close(): Promise<void>;
  requestClose(): void;
  cancelClose(): void;
  setBarPointerInside(inside: boolean): void;
  readonly closed: Promise<void>;
}
export interface PopupLayout { columns: Rect[] }
export interface PopupHost extends MenuActions {
  waitForFonts?(): Promise<unknown>;
  close(): Promise<void>;
  setPointerInside(inside: boolean): void;
  commitLayout(layout: PopupLayout): Promise<void>;
}
