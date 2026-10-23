import browser from "webextension-polyfill";
import { createExtensionRuntimeAdapter, createExtensionServices } from "@browserail/runtime-adapter/extension";
import { initializeExtension } from "@browserail/browserail/extension";

initializeExtension(createExtensionRuntimeAdapter(browser), createExtensionServices(browser));
