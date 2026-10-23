import { runtime } from "../../runtime";
import { EXTERNAL_AUTHORIZATION_STORAGE_KEY, normalizeExternalAuthorization, type ExternalAuthorization } from "./external-authorization";

export async function loadExternalAuthorization(): Promise<ExternalAuthorization> {
  const stored = await runtime.storage.local.get(EXTERNAL_AUTHORIZATION_STORAGE_KEY);
  return normalizeExternalAuthorization(stored[EXTERNAL_AUTHORIZATION_STORAGE_KEY]);
}

export function saveExternalAuthorization(value: Readonly<ExternalAuthorization>): Promise<void> {
  return runtime.storage.local.set({ [EXTERNAL_AUTHORIZATION_STORAGE_KEY]: normalizeExternalAuthorization(value) });
}
