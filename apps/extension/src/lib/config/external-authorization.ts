export const EXTERNAL_AUTHORIZATION_STORAGE_KEY = "external_authorization";

export interface ExternalAuthorization {
  extensionsEnabled: boolean;
  extensionIds: readonly string[];
  userscriptEnabled: boolean;
  token: string;
}

export function normalizeExternalAuthorization(value: unknown): ExternalAuthorization {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    extensionsEnabled: record.extensionsEnabled === true,
    extensionIds: Array.isArray(record.extensionIds)
      ? [...new Set(record.extensionIds.filter((id): id is string => typeof id === "string").map(id => id.trim()).filter(Boolean))]
      : [],
    userscriptEnabled: record.userscriptEnabled === true,
    token: typeof record.token === "string" && /^[a-f0-9]{16,64}$/.test(record.token) ? record.token : "",
  };
}

export function createExternalToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, "0")).join("");
}
