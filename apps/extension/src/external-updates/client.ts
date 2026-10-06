import type { ExternalUpdate } from "@browserail/protocol/api";

export function sendUserscriptUpdate(token: string, message: ExternalUpdate, target: Document = document): void {
  target.dispatchEvent(new CustomEvent(`browserail:${token}`, {
    detail: JSON.stringify(message),
  }));
}
