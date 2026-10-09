// Options page ⇄ background messages about the desktop connection, the on/off switch and debugging.
export const DESKTOP_STATE_REQUEST = "getDesktopState";
/** Broadcast by the background when the connection state changes. */
export const DESKTOP_STATE_CHANGED = "desktopStateChanged";
export const DESKTOP_RECONNECT = "manualReconnect";
export const DESKTOP_RESYNC_WINDOWS = "resyncWindows";
export const WIDGET_ENABLED_SET = "setWidgetEnabled";
export const DEBUG_INFO_REQUEST = "getDebugInfo";
export const DEBUG_LOGGING_SET = "setDebugLogging";
