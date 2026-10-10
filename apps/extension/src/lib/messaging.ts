import browser, { type Tabs } from "webextension-polyfill";
import type { ReplyOf } from "@browserail/protocol/message";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Runtime messages arrive untyped; this reads the `type` every internal message carries. */
export function messageType(value: unknown): unknown {
  return isRecord(value) ? value.type : undefined;
}

/** Sends a request; name its type explicitly so the reply type follows from it. */
export function request<Message extends { type: string }>(message: NoInfer<Message>): Promise<ReplyOf<Message>> {
  return browser.runtime.sendMessage(message) as Promise<ReplyOf<Message>>;
}

export function requestTab<Message extends { type: string }>(tabId: number, message: NoInfer<Message>, options?: Tabs.SendMessageOptionsType): Promise<ReplyOf<Message>> {
  return browser.tabs.sendMessage(tabId, message, options) as Promise<ReplyOf<Message>>;
}
