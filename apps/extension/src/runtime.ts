import browser from "webextension-polyfill";
import { registerRuntimeAdapter } from "@browserail/runtime-adapter";
import { createExtensionRuntimeAdapter, createExtensionServices, createExtensionHost, createExtensionRewrite } from "@browserail/runtime-adapter/extension";
import { applyRewrite } from "@browserail/browserail/lib/rewrite/rewrite";

const adapter = createExtensionRuntimeAdapter(browser);
export const extension = createExtensionServices(browser);
registerRuntimeAdapter(adapter, createExtensionHost(adapter, extension, createExtensionRewrite(adapter, applyRewrite)));
