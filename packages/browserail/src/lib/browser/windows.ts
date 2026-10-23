import { host } from "../../runtime";

export type { BrowserWindowCandidate } from "../../runtime";

export const browserKind = () => host.browserKind();
export const listBrowserWindows = () => host.listWindows();
