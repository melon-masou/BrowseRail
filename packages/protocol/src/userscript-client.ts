import type { ExternalUpdate } from "./api";
import { userscriptUpdateEvent } from "./content";

export function sendUserscriptUpdate(token: string, message: ExternalUpdate, target: Document = document): void {
  target.dispatchEvent(new CustomEvent(userscriptUpdateEvent(token), {
    detail: JSON.stringify(message),
  }));
}
