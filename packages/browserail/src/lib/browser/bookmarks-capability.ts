import { getRuntimeAdapter } from "@browserail/runtime-adapter";

// Some browsers (e.g. Firefox for Android) install the extension but expose no
// bookmarks API, or one that rejects every call.
export function canUseBookmarks(): Promise<boolean> {
  return getRuntimeAdapter().bookmarks.isAvailable();
}
