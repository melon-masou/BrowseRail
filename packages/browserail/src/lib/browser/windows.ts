import { getRuntimeAdapter } from "@browserail/runtime-adapter";

export type { BrowserWindowCandidate } from "@browserail/runtime-adapter";

export const browserKind = () => getRuntimeAdapter().host.browserKind();
export const listBrowserWindows = () => getRuntimeAdapter().host.listWindows();
