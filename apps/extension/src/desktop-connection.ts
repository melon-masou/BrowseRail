import { SOCKET_URL } from "@browserail/protocol";

export const DEFAULT_DESKTOP_URL = SOCKET_URL;

interface ProbeSocket {
  addEventListener(type: "open" | "error", listener: () => void): void;
  close(): void;
}

type ProbeSocketFactory = (url: string) => ProbeSocket;

export function isLocalDesktopUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "ws:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

export function probeDesktopConnection(
  value: string,
  timeoutMs = 3_000,
  createSocket: ProbeSocketFactory = (url) => new WebSocket(url),
): Promise<void> {
  if (!isLocalDesktopUrl(value)) {
    return Promise.reject(new Error("Use a ws:// localhost address"));
  }

  return new Promise((resolve, reject) => {
    const socket = createSocket(value);
    const timer = setTimeout(() => finish(new Error("Connection timed out")), timeoutMs);
    let finished = false;

    socket.addEventListener("open", () => finish());
    socket.addEventListener("error", () => finish(new Error("Connection failed")));

    function finish(error?: Error): void {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      socket.close();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }
  });
}
