import { runtime } from "../../runtime";

const INSTANCE_UID_KEY = "instanceUid";

export async function loadInstanceUid(): Promise<string> {
  const stored = await runtime.storage.local.get(INSTANCE_UID_KEY);
  const uid =
    typeof stored[INSTANCE_UID_KEY] === "string" ? stored[INSTANCE_UID_KEY] : crypto.randomUUID();
  if (stored[INSTANCE_UID_KEY] !== uid) {
    await runtime.storage.local.set({ [INSTANCE_UID_KEY]: uid });
  }

  return uid;
}
