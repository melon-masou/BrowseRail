// Request/reply typing for runtime messages. A request type names its reply, so the sender's
// result and the handler's return value are checked against the same contract.

/** Type-only key; no value carries it at runtime. */
export declare const replyKey: unique symbol;

/** Marks a request whose handler resolves with `Reply`. */
export type Replies<Reply> = { readonly [replyKey]?: (reply: Reply) => void };

export type ReplyOf<Message> = Message extends { readonly [replyKey]?: (reply: infer Reply) => void } ? Reply : never;

/** One handler per request type, each returning that request's reply. */
export type Handlers<Message extends { type: string }> = {
  [Type in Message["type"]]: (message: Extract<Message, { type: Type }>) => Promise<ReplyOf<Extract<Message, { type: Type }>>>;
};

export function dispatch<Message extends { type: string }>(handlers: NoInfer<Handlers<Message>>, message: Message): Promise<ReplyOf<Message>> {
  // The mapped type pairs each key with its own message type, which indexing by a union loses.
  const handler = handlers[message.type as Message["type"]] as (message: Message) => Promise<ReplyOf<Message>>;
  return handler(message);
}
