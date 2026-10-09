// Options page ⇄ background messages about the desktop connection, the on/off switch and debugging.
import { isRecord, messageType } from "../../lib/messaging";
import type { BrowserWindowCandidate } from "../../lib/browser/windows";
import type { ExtensionDebugLogEntry } from "./debug-log";
import type { ExtensionConnectionState } from "./state-machine";

export const DESKTOP_STATE_REQUEST = "getDesktopState";
/** Broadcast by the background when the connection state changes. */
export const DESKTOP_STATE_CHANGED = "desktopStateChanged";
export const DESKTOP_RECONNECT = "manualReconnect";
export const DESKTOP_RESYNC_WINDOWS = "resyncWindows";
export const WIDGET_ENABLED_SET = "setWidgetEnabled";
export const DEBUG_INFO_REQUEST = "getDebugInfo";
export const DEBUG_LOGGING_SET = "setDebugLogging";

export type DesktopRequest =
  | { type: typeof DESKTOP_STATE_REQUEST }
  | { type: typeof DESKTOP_RECONNECT }
  | { type: typeof DESKTOP_RESYNC_WINDOWS }
  | { type: typeof WIDGET_ENABLED_SET; enabled: boolean }
  | { type: typeof DEBUG_INFO_REQUEST }
  | { type: typeof DEBUG_LOGGING_SET; enabled: boolean };

export type DesktopState = { state: ExtensionConnectionState; detail?: string | undefined };
export type DesktopStateChanged = DesktopState & { type: typeof DESKTOP_STATE_CHANGED };
export type ResyncResult = { ok: boolean; message: string };
export type DesktopDebugInfo = {
  debugLoggingEnabled: boolean;
  connected: boolean;
  connectionState: ExtensionConnectionState;
  connectionDetail?: string | undefined;
  socketUrl: string;
  instanceLabel: string;
  pairedWindowUids: string[];
  pendingWindowPairings: Array<{ requestUid: string; windowUid: string }>;
  browserWindows: BrowserWindowCandidate[];
  recentLogs: readonly ExtensionDebugLogEntry[];
};

export function isDesktopRequest(value: unknown): value is DesktopRequest {
  switch (messageType(value)) {
    case DESKTOP_STATE_REQUEST:
    case DESKTOP_RECONNECT:
    case DESKTOP_RESYNC_WINDOWS:
    case DEBUG_INFO_REQUEST:
      return true;
    case WIDGET_ENABLED_SET:
    case DEBUG_LOGGING_SET:
      return isRecord(value) && typeof value.enabled === "boolean";
    default:
      return false;
  }
}

export function isDesktopStateChanged(value: unknown): value is DesktopStateChanged {
  return messageType(value) === DESKTOP_STATE_CHANGED && isRecord(value) && typeof value.state === "string";
}
