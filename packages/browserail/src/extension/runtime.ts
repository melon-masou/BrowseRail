import type { ExtensionServices } from "@browserail/runtime-adapter/extension";

export { runtime } from "../runtime";
export let extension: ExtensionServices;

export function initializeExtensionServices(services: ExtensionServices): void {
  extension = services;
}
