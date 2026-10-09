// Options page → background: evaluate a dynamic bookmark against a URL without saving.
// Background → offscreen page (Chrome): run a rewrite in a worker the service worker cannot start.
import { isRecord, messageType } from "../../lib/messaging";

export const DYNAMIC_TEST = "testDynamicBookmark";
export const REWRITE_RUN = "runRewrite";

/** The bookmark and rule are unsaved drafts; the background normalizes them like stored settings. */
export type DynamicTest = { type: typeof DYNAMIC_TEST; bookmark: unknown; rule: unknown; url: string };
export type RewriteRun = { type: typeof REWRITE_RUN; source: string; url: string };

export function isDynamicTest(value: unknown): value is DynamicTest {
  return messageType(value) === DYNAMIC_TEST && isRecord(value) && typeof value.url === "string";
}

export function isRewriteRun(value: unknown): value is RewriteRun {
  return messageType(value) === REWRITE_RUN && isRecord(value) && typeof value.source === "string" && typeof value.url === "string";
}
