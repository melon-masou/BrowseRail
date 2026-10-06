import type { ExternalUpdate } from "./protocol";

export function sendUserscriptUpdate(token: string, message: ExternalUpdate, target: Document = document): void {
  target.dispatchEvent(new CustomEvent(`browserail:${token}`, {
    detail: JSON.stringify(message),
  }));
}
