import { describe, expect, it } from "vitest";

import { isLocalDesktopUrl, probeDesktopConnection } from "./desktop-connection";

describe("isLocalDesktopUrl", () => {
  it.each(["ws://127.0.0.1:17654", "ws://localhost:9000/panels"])(
    "accepts a local WebSocket address: %s",
    (address) => {
      expect(isLocalDesktopUrl(address)).toBe(true);
    },
  );

  it.each(["https://127.0.0.1:17654", "ws://192.168.1.5:17654", "not-a-url"])(
    "rejects a non-local WebSocket address: %s",
    (address) => {
      expect(isLocalDesktopUrl(address)).toBe(false);
    },
  );
});

describe("probeDesktopConnection", () => {
  it("reports a reachable Desktop Widget address", async () => {
    const socket = new FakeProbeSocket();
    const result = probeDesktopConnection("ws://127.0.0.1:17654", 100, () => socket);

    socket.emit("open");

    await expect(result).resolves.toBeUndefined();
    expect(socket.closed).toBe(true);
  });

  it("reports an unreachable Desktop Widget address", async () => {
    const socket = new FakeProbeSocket();
    const result = probeDesktopConnection("ws://127.0.0.1:17654", 100, () => socket);

    socket.emit("error");

    await expect(result).rejects.toThrow("Connection failed");
    expect(socket.closed).toBe(true);
  });
});

class FakeProbeSocket {
  closed = false;
  private listeners = new Map<"open" | "error", () => void>();

  addEventListener(type: "open" | "error", listener: () => void): void {
    this.listeners.set(type, listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: "open" | "error"): void {
    this.listeners.get(type)?.();
  }
}
