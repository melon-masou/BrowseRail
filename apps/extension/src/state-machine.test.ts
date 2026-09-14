import { describe, expect, it } from "vitest";

import { ExtensionStateMachine, type ExtensionConnectionState } from "./state-machine";

describe("ExtensionStateMachine", () => {
  it("initializes with default state disconnected", () => {
    const logs: string[] = [];
    const sm = new ExtensionStateMachine("disconnected", (msg) => logs.push(msg));

    expect(sm.getState()).toBe("disconnected");
    expect(logs).toEqual(["[BrowseRail:Extension:StateMachine] Initial state: disconnected"]);
  });

  it("transitions between states and logs output", () => {
    const logs: string[] = [];
    const sm = new ExtensionStateMachine("disconnected", (msg) => logs.push(msg));

    sm.transition("connecting", "ws://127.0.0.1:17654");
    sm.transition("handshaking", "hello sent");
    sm.transition("connected", "ready received");
    sm.transition("syncing", "revision 1");
    sm.transition("connected", "sync done");

    expect(sm.getState()).toBe("connected");
    expect(logs).toEqual([
      "[BrowseRail:Extension:StateMachine] Initial state: disconnected",
      "[BrowseRail:Extension:StateMachine] disconnected -> connecting (ws://127.0.0.1:17654)",
      "[BrowseRail:Extension:StateMachine] connecting -> handshaking (hello sent)",
      "[BrowseRail:Extension:StateMachine] handshaking -> connected (ready received)",
      "[BrowseRail:Extension:StateMachine] connected -> syncing (revision 1)",
      "[BrowseRail:Extension:StateMachine] syncing -> connected (sync done)",
    ]);
  });

  it("ignores self-transitions", () => {
    const logs: string[] = [];
    const sm = new ExtensionStateMachine("connecting", (msg) => logs.push(msg));

    sm.transition("connecting", "again");
    expect(sm.getState()).toBe("connecting");
    expect(logs).toHaveLength(1);
  });

  it("notifies subscribed listeners", () => {
    const events: Array<{ next: ExtensionConnectionState; prev: ExtensionConnectionState; detail?: string | undefined }> = [];
    const sm = new ExtensionStateMachine("disconnected", () => {});

    const unsubscribe = sm.subscribe((next, prev, detail) => {
      events.push({ next, prev, detail });
    });

    sm.transition("connecting", "url");
    sm.transition("connected");

    expect(events).toEqual([
      { next: "connecting", prev: "disconnected", detail: "url" },
      { next: "connected", prev: "connecting", detail: undefined },
    ]);

    unsubscribe();
    sm.transition("disconnected");
    expect(events).toHaveLength(2);
  });
});
