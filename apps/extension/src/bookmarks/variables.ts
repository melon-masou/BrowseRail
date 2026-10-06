import { t } from "@browserail/i18n";
import type { JsonValue } from "@browserail/protocol/api";
import { loadExternalData } from "../config/external-data";

export type VariableSource = "user" | "external";

export function variableReference(source: VariableSource, key: string): string {
  return "${" + source + "." + key + "}";
}

export async function resolveStaticBookmarkUrl(
  template: string,
  userVariables: Readonly<Record<string, JsonValue>>,
): Promise<string> {
  if (template.replace(/\$\{([^{}]*)\}/g, "").includes("${"))
    throw new Error(t("variables.invalidReference", { reference: template }));
  const references = new Map<string, { source: VariableSource; key: string }>();
  for (const [, reference] of template.matchAll(/\$\{([^{}]*)\}/g)) {
    const match = /^(user|external)\.([^{}]+)$/.exec(reference!);
    if (!match) throw new Error(t("variables.invalidReference", { reference: "${" + reference + "}" }));
    references.set(reference!, { source: match[1] as VariableSource, key: match[2]! });
  }
  const resolved = new Map<string, string>();
  await Promise.all([...references].map(async ([reference, { source, key }]) => {
    const value = source === "user"
      ? Object.hasOwn(userVariables, key) ? userVariables[key] : undefined
      : await loadExternalData(key);
    if (value === undefined) throw new Error(t("variables.missing", { reference: "${" + reference + "}" }));
    resolved.set(reference, typeof value === "string" ? value : JSON.stringify(value));
  }));
  return template.replace(/\$\{([^{}]*)\}/g, (_, reference: string) => resolved.get(reference)!);
}
