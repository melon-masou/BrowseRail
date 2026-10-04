import { matchesUrlRule } from "@browserail/protocol";
import type { DynamicBookmark, DynamicValue, UrlRule } from "../config";
import { runDynamic, runRewrite } from "./runner";

export interface DynamicUpdate {
  newUrl: string | null;
  title?: string;
  note?: string;
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
  current?: DynamicValue,
  preview = false,
): Promise<DynamicEvaluation> {
  if (!rule) return { ok: false, error: "No URL rule selected" };
  if (!/^https?:\/\//i.test(url) || !matchesUrlRule(url, rule)) return { ok: true, skipped: "inputRule" };
  let value: unknown;
  if (bookmark.type === "rule") value = { newUrl: url, title };
  else if (bookmark.type === "rewrite") {
    const result = await runRewrite(bookmark.rewrite ?? "", url);
    if (!result.ok) return result;
    if (result.url === null) return { ok: true, skipped: result.line ? "filtered" : "noUpdate", ...(result.line ? { line: result.line } : {}) };
    value = { newUrl: result.url, title };
  } else {
    const result = await runDynamic(bookmark.code, {
      action: "visit", url, title,
      current: { url: current?.url ?? null, title: current?.title ?? null, note: current?.note ?? "" },
    }, 200);
    if (!result.ok) return { ok: false, error: result.error ?? "Script failed" };
    if (preview) return { ok: true, value: result.value };
    value = result.value;
  }
  if (!value || typeof value !== "object") return { ok: false, error: "Expected an object with newUrl" };
  const update = value as { newUrl?: unknown; title?: unknown; note?: unknown };
  const newUrl = typeof update.newUrl === "string" ? update.newUrl : null;
  if (update.newUrl !== null) {
    try {
      const parsed = new URL(newUrl ?? "");
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !matchesUrlRule(parsed.href, rule))
        return { ok: false, error: "Result URL is outside the selected URL rule" };
    } catch { return { ok: false, error: "Result is not a valid HTTP(S) URL" }; }
  } else if (typeof update.note !== "string") return { ok: true, skipped: "noUpdate" };
  return { ok: true, value: {
    newUrl,
    ...(newUrl !== null ? { title: typeof update.title === "string" && update.title ? update.title : title } : {}),
    ...(typeof update.note === "string" ? { note: update.note } : {}),
  } };
}
