// Confirmation page → background: save the page the user confirmed.
import type { Replies } from "@browserail/protocol/message";
import { isRecord, messageType } from "../../lib/messaging";

export const TEMPORARY_SAVE_CONFIRMED = "temporarySaveConfirmed";
export const STATIC_SAVE_CONFIRMED = "staticSaveConfirmed";

export type CaptureResult = { saved?: true; error?: string };
export type TemporarySaveConfirmed = { type: typeof TEMPORARY_SAVE_CONFIRMED; note: string } & Replies<CaptureResult>;
export type StaticSaveConfirmed = { type: typeof STATIC_SAVE_CONFIRMED; name: string; url: string; tags?: string[] } & Replies<CaptureResult>;
export type CaptureConfirmation = TemporarySaveConfirmed | StaticSaveConfirmed;

export function isTemporarySaveConfirmed(value: unknown): value is TemporarySaveConfirmed {
  return messageType(value) === TEMPORARY_SAVE_CONFIRMED && isRecord(value) && typeof value.note === "string";
}

export function isStaticSaveConfirmed(value: unknown): value is StaticSaveConfirmed {
  // Tags are normalized when saving, so only the name and URL decide whether this is a confirmation.
  return messageType(value) === STATIC_SAVE_CONFIRMED && isRecord(value) && typeof value.name === "string" && typeof value.url === "string";
}
