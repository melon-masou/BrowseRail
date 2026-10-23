import type { RuntimeAdapter, RuntimeHost } from "./contracts";

let adapter: (RuntimeAdapter & { host: RuntimeHost }) | undefined;

export function registerRuntimeAdapter(implementation: RuntimeAdapter, host: RuntimeHost): void {
  adapter = Object.assign(implementation, { host });
}

export function getRuntimeAdapter(): RuntimeAdapter & { host: RuntimeHost } {
  if (!adapter) throw new Error("Register a runtime adapter before starting BrowseRail");
  return adapter;
}
