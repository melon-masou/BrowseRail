export interface BookmarkTargetDraft {
  register(browserBookmarkId: string): string;
  commit(): void;
}

let activeTargets = new Map<string, string>();
let previousTargets = new Map<string, string>();
const runtimeUidByBookmarkId = new Map<string, string>();

export function createBookmarkTargetDraft(): BookmarkTargetDraft {
  const nextTargets = new Map<string, string>();

  return {
    register(browserBookmarkId: string): string {
      let runtimeUid = runtimeUidByBookmarkId.get(browserBookmarkId);
      if (!runtimeUid) {
        runtimeUid = crypto.randomUUID();
        runtimeUidByBookmarkId.set(browserBookmarkId, runtimeUid);
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
}
