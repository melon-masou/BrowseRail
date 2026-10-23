import browser from "webextension-polyfill";
import { createExtensionRuntimeAdapter, createExtensionServices } from "@browserail/runtime-adapter/extension";

export const runtime = createExtensionRuntimeAdapter(browser);
export const extension = createExtensionServices(browser);
