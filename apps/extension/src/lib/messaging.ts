import browser from "webextension-polyfill";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Runtime messages arrive untyped; this reads the `type` every internal message carries. */
export function messageType(value: unknown): unknown {
  return isRecord(value) ? value.type : undefined;
}

/**
 * Sends an internal request whose reply type the receiving feature defines. The cast lives here
 * once instead of at every call site.
 */
export function request<Reply>(message: { readonly type: string; readonly [field: string]: unknown }): Promise<Reply> {
  return browser.runtime.sendMessage(message) as Promise<Reply>;
}
