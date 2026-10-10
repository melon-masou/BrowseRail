// Options page ⇄ background messages about bar editing mode, which the toolbar menu also toggles.
import type { Replies } from "@browserail/protocol/message";
import { isRecord, messageType } from "../../lib/messaging";

export const EDITING_STATE_REQUEST = "getMenuEditingState";
export const EDITING_SET = "setMenuEditing";
/** Broadcast by the background when editing mode or its availability changes. */
export const EDITING_STATE_CHANGED = "menuEditingStateChanged";

/** `enabled` says whether editing can be toggled at all in the current mode. */
export type EditingState = { enabled: boolean; editing: boolean };
export type EditingStateRequest = { type: typeof EDITING_STATE_REQUEST } & Replies<EditingState>;
export type EditingSet = { type: typeof EDITING_SET; editing: boolean } & Replies<EditingState>;
export type EditingRequest = EditingStateRequest | EditingSet;
export type EditingStateChanged = EditingState & { type: typeof EDITING_STATE_CHANGED };

export function isEditingRequest(value: unknown): value is EditingRequest {
  const type = messageType(value);
  return type === EDITING_STATE_REQUEST || (type === EDITING_SET && isRecord(value) && typeof value.editing === "boolean");
}

export function isEditingStateChanged(value: unknown): value is EditingStateChanged {
  return messageType(value) === EDITING_STATE_CHANGED && isRecord(value)
    && typeof value.enabled === "boolean" && typeof value.editing === "boolean";
}
