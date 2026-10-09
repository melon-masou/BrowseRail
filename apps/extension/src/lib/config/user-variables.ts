import { isJsonValue, type JsonValue } from "@browserail/protocol/api";

export function isUserVariables(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && isJsonValue(value);
}

export function normalizeUserVariables(value: unknown): Record<string, JsonValue> {
  return isUserVariables(value) ? structuredClone(value) : {};
}
