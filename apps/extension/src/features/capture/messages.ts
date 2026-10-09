// Confirmation page → background: save the page the user confirmed.
export const TEMPORARY_SAVE_CONFIRMED = "temporarySaveConfirmed";
export const STATIC_SAVE_CONFIRMED = "staticSaveConfirmed";

export type CaptureConfirmation =
  | { type: typeof TEMPORARY_SAVE_CONFIRMED; note: string }
  | { type: typeof STATIC_SAVE_CONFIRMED; name: string; url: string; tags: string[] };
