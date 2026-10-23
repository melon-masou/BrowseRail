import browser from "webextension-polyfill";
import { createExtensionRuntimeAdapter, createExtensionServices } from "@browserail/runtime-adapter/extension";
import { initializeExtension } from "../src/extension/index";

initializeExtension(createExtensionRuntimeAdapter(browser), createExtensionServices(browser));
