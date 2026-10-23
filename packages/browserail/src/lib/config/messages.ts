// Options page → background: settings were saved; reapply the connection and resync menus.
import type { Replies } from "@browserail/protocol/message";
import { messageType } from "../messaging";

export const CONFIG_SAVED = "configSaved";

export type ConfigSaved = { type: typeof CONFIG_SAVED } & Replies<{ ok: true }>;

export function isConfigSaved(value: unknown): value is ConfigSaved {
  return messageType(value) === CONFIG_SAVED;
}
