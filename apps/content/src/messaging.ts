import browser from "webextension-polyfill";
import type { ReplyOf } from "@browserail/protocol/message";

/** Sends a request to the extension; name its type explicitly so the reply type follows from it. */
export function request<Message extends { type: string }>(message: NoInfer<Message>): Promise<ReplyOf<Message>> {
  return browser.runtime.sendMessage(message) as Promise<ReplyOf<Message>>;
}
