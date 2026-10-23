import { describe, expect, it } from "vitest";

import { ExtensionStateMachine, type ExtensionConnectionState } from "./state-machine";

describe("ExtensionStateMachine", () => {
  it("updates connection details without sending another state change for the same state", () => {
    const sm = new ExtensionStateMachine("connecting", () => {});
    const notifications: ExtensionConnectionState[] = [];
    sm.subscribe(next => notifications.push(next));

    sm.transition("connecting", "again");
    expect(sm.getState()).toBe("connecting");
    expect(sm.getDetail()).toBe("again");
    expect(notifications).toEqual([]);
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
