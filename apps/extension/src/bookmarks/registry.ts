export interface BookmarkTargetDraft {
  register(browserBookmarkId: string): string;
  commit(): void;
}

let activeTargets = new Map<string, string>();
let previousTargets = new Map<string, string>();
const runtimeUidByBookmarkId = new Map<string, string>();
const TARGET_UIDS_KEY = "bookmark_target_uids";
let loading: Promise<void> | undefined;
let dirty = false;

export function loadBookmarkTargets(storage: { get(key: string): Promise<Record<string, unknown>> }): Promise<void> {
  loading ??= storage.get(TARGET_UIDS_KEY).then(stored => {
    const values: unknown = stored[TARGET_UIDS_KEY];
    if (!values || typeof values !== "object" || Array.isArray(values)) return;
    for (const [id, uid] of Object.entries(values)) {
      if (typeof uid === "string" && uid) runtimeUidByBookmarkId.set(id, uid);
    }
  });
  return loading;
}

export async function persistBookmarkTargets(storage: { set(values: Record<string, unknown>): Promise<void> }): Promise<void> {
  if (!dirty) return;
  // Page buttons outlive an idle MV3 worker. Persist opaque IDs before
  // publishing them so waking the worker can resolve those same buttons.
  await storage.set({ [TARGET_UIDS_KEY]: Object.fromEntries(runtimeUidByBookmarkId) });
  dirty = false;
}

export function createBookmarkTargetDraft(): BookmarkTargetDraft {
  const nextTargets = new Map<string, string>();

  return {
    register(browserBookmarkId: string): string {
      let runtimeUid = runtimeUidByBookmarkId.get(browserBookmarkId);
      if (!runtimeUid) {
        runtimeUid = crypto.randomUUID();
        runtimeUidByBookmarkId.set(browserBookmarkId, runtimeUid);
        dirty = true;
      }
      nextTargets.set(runtimeUid, browserBookmarkId);
      return runtimeUid;
    },
    commit(): void {
      previousTargets = activeTargets;
      activeTargets = nextTargets;
    },
  };
}

export function resolveBookmarkTarget(uid: string): string | undefined {
  return activeTargets.get(uid) ?? previousTargets.get(uid);
}

export function clearBookmarkTargets(): void {
  activeTargets.clear();
  previousTargets.clear();
  runtimeUidByBookmarkId.clear();
  loading = undefined;
  dirty = false;
}
