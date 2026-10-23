// Options page → background: evaluate a dynamic bookmark against a URL without saving.
import type { Replies } from "@browserail/protocol/message";
import { isRecord, messageType } from "../../lib/messaging";

export const DYNAMIC_TEST = "testDynamicBookmark";

/** The bookmark and rule are unsaved drafts; the background normalizes them like stored settings. */
export type DynamicEvaluation =
  | { ok: true; value: unknown }
  | { ok: true; skipped: "inputRule" | "filtered" | "noUpdate"; line?: number }
  | { ok: false; error: string };
export type DynamicTest = { type: typeof DYNAMIC_TEST; bookmark: unknown; rule: unknown; url: string } & Replies<DynamicEvaluation>;

export function isDynamicTest(value: unknown): value is DynamicTest {
  return messageType(value) === DYNAMIC_TEST && isRecord(value) && typeof value.url === "string";
}
