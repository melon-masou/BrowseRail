import browser from "webextension-polyfill";
import { activeUrlPatterns, type UrlRule } from "@browserail/protocol";

export const ALL_WEBSITE_ORIGINS = ["http://*/*", "https://*/*"];
export type UnsupportedSiteReason = "regex" | "scheme" | "pattern";
export interface RuleSites {
  uid: string;
  name: string;
  origins: string[];
  unsupported: { pattern: string; reason: UnsupportedSiteReason }[];
}

export function ruleSites(rule: UrlRule): RuleSites {
  const origins = new Set<string>();
  const unsupported: RuleSites["unsupported"] = [];
  for (const raw of activeUrlPatterns(rule.patterns)) {
    const pattern = raw.trim();
    if (!pattern || pattern.startsWith("!")) continue;
    if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
      unsupported.push({ pattern, reason: "regex" }); continue;
    }
    const schemeMatch = /^([^/]+):\/\//.exec(pattern);
    if ((schemeMatch && !["http", "https", "*"].includes(schemeMatch[1]!.toLowerCase())) || /^(about|chrome|edge|file|moz-extension):/i.test(pattern)) {
      unsupported.push({ pattern, reason: "scheme" }); continue;
    }
    const scheme = schemeMatch?.[1]!.toLowerCase() ?? "*";
    const rest = schemeMatch ? pattern.slice(schemeMatch[0].length) : pattern;
    const slash = rest.indexOf("/");
    if (/[\s?#@\\]/.test(slash < 0 ? rest : rest.slice(0, slash))) {
      unsupported.push({ pattern, reason: "pattern" }); continue;
    }
    let host = slash < 0 ? rest : rest.slice(0, slash);
    host = host.replace(/:(\d+|\*)$/, "");
    const wildcard = host.startsWith("*.");
    if (wildcard) host = host.slice(2);
    if (!host || (wildcard && host === "*") || (host.includes("*") && host !== "*")) {
      unsupported.push({ pattern, reason: "pattern" }); continue;
    }
    try {
      if (host !== "*") {
        const parsed = new URL(`https://${host}/`);
        host = parsed.hostname;
        if (!host || parsed.port || parsed.username || parsed.password || parsed.pathname !== "/" || !/^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])$/i.test(host)) throw new Error("Invalid host");
      }
      // Bare domain rules include subdomains. IP literals stay exact.
      const ip = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[");
      const target = host === "*" ? "*" : (wildcard || (!schemeMatch && !ip)) ? `*.${host}` : host;
      // Chrome requires concrete schemes for both requests and coverage
      // checks when the optional hosts declare HTTP and HTTPS separately.
      for (const protocol of scheme === "*" ? ["http", "https"] : [scheme]) origins.add(`${protocol}://${target}/*`);
    } catch {
      unsupported.push({ pattern, reason: "pattern" });
    }
  }
  return { uid: rule.uid, name: rule.name, origins: [...origins], unsupported };
}

export function websiteOrigins(origins: string[] = []): string[] {
  return [...new Set(origins.flatMap(origin => origin === "<all_urls>" ? ALL_WEBSITE_ORIGINS : /^(https?|\*):\/\//.test(origin) ? [origin] : []))];
}

export async function loadWebsiteOrigins(): Promise<string[]> {
  return websiteOrigins((await browser.permissions.getAll()).origins);
}

export async function hasWebsitePermission(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return await browser.permissions.contains({ origins: [`${parsed.protocol}//${parsed.hostname}/*`] });
  } catch { return false; }
}

export async function incompleteRuleUids(rules: RuleSites[]): Promise<Set<string>> {
  const checks = await Promise.all(rules.map(async rule =>
    rule.origins.length && !await browser.permissions.contains({ origins: rule.origins }) ? rule.uid : undefined,
  ));
  return new Set(checks.filter((uid): uid is string => uid !== undefined));
}

export async function revokeWebsitePermissions(): Promise<void> {
  const origins = await loadWebsiteOrigins();
  if (origins.length && !await browser.permissions.remove({ origins })) throw new Error("Website permissions could not be removed");
  if ((await loadWebsiteOrigins()).length) throw new Error("Website permissions are still active");
}
