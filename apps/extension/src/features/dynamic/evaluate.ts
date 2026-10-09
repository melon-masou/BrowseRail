import { matchesUrlRule } from "@browserail/protocol";
import type { DynamicBookmark, UrlRule } from "../../lib/config";
import { runRewrite } from "./runner";

export interface DynamicUpdate {
  newUrl: string;
  title?: string;
}
export type DynamicEvaluation =
  | { ok: true; value: unknown }
  | { ok: true; skipped: "inputRule" | "filtered" | "noUpdate"; line?: number }
  | { ok: false; error: string };

export async function evaluateDynamicBookmark(
  bookmark: DynamicBookmark,
  rule: UrlRule | undefined,
  url: string,
  title: string,
): Promise<DynamicEvaluation> {
  if (bookmark.type === "external") return { ok: true, skipped: "noUpdate" };
  if (!rule) return { ok: false, error: "No URL rule selected" };
  if (!/^https?:\/\//i.test(url) || !matchesUrlRule(url, rule)) return { ok: true, skipped: "inputRule" };
  let newUrl = url;
  if (bookmark.type === "rewrite") {
    const result = await runRewrite(bookmark.rewrite ?? "", url);
    if (!result.ok) return result;
    if (result.url === null) return { ok: true, skipped: result.line ? "filtered" : "noUpdate", ...(result.line ? { line: result.line } : {}) };
    newUrl = result.url;
  }
  try {
    const parsed = new URL(newUrl);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !matchesUrlRule(parsed.href, rule))
      return { ok: false, error: "Result URL is outside the selected URL rule" };
  } catch { return { ok: false, error: "Result is not a valid HTTP(S) URL" }; }
  return { ok: true, value: { newUrl, title } };
}
