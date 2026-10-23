import type { RuntimeAdapter } from "@browserail/runtime-adapter";
import type { ExtensionServices } from "@browserail/runtime-adapter/extension";
import { initializeBrowserail } from "../runtime";
import { createExtensionHost } from "./host";
import { initializeExtensionServices } from "./runtime";

export { startExtension } from "./background/index";

export function initializeExtension(adapter: RuntimeAdapter, services: ExtensionServices): void {
  initializeExtensionServices(services);
  initializeBrowserail(adapter, createExtensionHost(adapter, services));
}
