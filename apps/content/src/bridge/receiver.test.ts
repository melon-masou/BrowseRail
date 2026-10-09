// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createExternalReceiver } from "./receiver";
import { sendUserscriptUpdate } from "@browserail/protocol/userscript-client";

const api = vi.hoisted(() => ({
  send: vi.fn<(message: unknown) => Promise<unknown>>(),
  listeners: new Set<(message: unknown) => unknown>(),
}));
vi.mock("webextension-polyfill", () => ({ default: {
  runtime: {
    id: "browserail-test",
    sendMessage: api.send,
    onMessage: { addListener: (listener: (message: unknown) => unknown) => api.listeners.add(listener), removeListener: (listener: (message: unknown) => unknown) => api.listeners.delete(listener) },
  },
} }));
let receiver: ReturnType<typeof createExternalReceiver> | undefined;
const token = "a".repeat(16);
const update = { type: "data.update" as const, payload: { key: "context", data: { chapter: 123 } } };
const relays = () => api.send.mock.calls.filter(([message]) => (message as { type?: string }).type === "externalUpdate");

beforeEach(() => { vi.useFakeTimers(); api.send.mockReset(); });
afterEach(() => { receiver?.destroy(); receiver = undefined; vi.useRealTimers(); document.body.replaceChildren(); });

it.each([{ ok: true }, { ok: false, error: "unauthorized" }])("forwards once without page replies or retries for backend result %j", async result => {
  document.body.innerHTML = "<main>Website</main>";
  api.send.mockImplementation(async message => (message as { type?: string }).type === "externalReceiverConfig" ? { token } : result);
  receiver = createExternalReceiver(document);
  await receiver.refresh();
  const events: unknown[] = [];
  const observe = (event: Event) => events.push(JSON.parse((event as CustomEvent<string>).detail));
  document.addEventListener(`browserail:${token}`, observe);
  try {
    sendUserscriptUpdate(token, update);
    await vi.advanceTimersByTimeAsync(6000);
    expect(events).toEqual([update]);
    expect(relays().map(([message]) => message)).toEqual([{ type: "externalUpdate", token, message: update }]);
    expect(document.body.innerHTML).toBe("<main>Website</main>");
  } finally {
    document.removeEventListener(`browserail:${token}`, observe);
  }
});

it("does not retain an update sent before receiver initialization", async () => {
  let ready!: (value: { token: string }) => void;
  const configuration = new Promise<{ token: string }>(resolve => { ready = resolve; });
  api.send.mockImplementation(async message => (message as { type?: string }).type === "externalReceiverConfig" ? configuration : { ok: true });
  receiver = createExternalReceiver(document);
  const initialization = receiver.refresh();
  sendUserscriptUpdate(token, update);
  ready({ token });
  await initialization;
  await vi.advanceTimersByTimeAsync(6000);
  expect(relays()).toHaveLength(0);
  sendUserscriptUpdate(token, update);
  expect(relays()).toHaveLength(1);
});

it("uses only the configured token channel and stops after revocation or destruction", async () => {
  let currentToken = token;
  api.send.mockImplementation(async message => (message as { type?: string }).type === "externalReceiverConfig" ? { token: currentToken } : { ok: true });
  receiver = createExternalReceiver(document);
  await receiver.refresh();
  const channel = `browserail:${token}`;
  document.dispatchEvent(new CustomEvent("browserail:wrong", { detail: JSON.stringify(update) }));
  document.dispatchEvent(new CustomEvent(channel, { detail: "invalid JSON" }));
  document.dispatchEvent(new CustomEvent(channel, { detail: update }));
  expect(relays()).toHaveLength(0);
  sendUserscriptUpdate(token, update);
  expect(relays()).toHaveLength(1);
  // The extension announces revoked userscript access; the bridge fetches the token again.
  currentToken = "";
  for (const listener of api.listeners) listener({ type: "externalReceiverRefresh" });
  await vi.advanceTimersByTimeAsync(0);
  sendUserscriptUpdate(token, update);
  expect(relays()).toHaveLength(1);
  currentToken = token;
  await receiver.refresh();
  receiver.destroy();
  sendUserscriptUpdate(token, update);
  expect(relays()).toHaveLength(1);
});

it("dispatches external action events only while the receiver holds a token", async () => {
  api.send.mockImplementation(async message => (message as { type?: string }).type === "externalReceiverConfig" ? { token } : { ok: true });
  receiver = createExternalReceiver(document);
  const run = (message: unknown) => Promise.all([...api.listeners].map(listener => listener(message)));
  const action = { type: "externalRunAction", eventName: `browserail:run:${token}`, detail: '{"command":"translate"}' };
  const details: unknown[] = [];
  const observe = (event: Event) => details.push((event as CustomEvent<unknown>).detail);
  document.addEventListener(action.eventName, observe);
  try {
    // Before the token arrives (or after revocation) the page sees nothing and the background is told so.
    expect(await run(action)).toEqual([false]);
    await receiver.refresh();
    expect(await run(action)).toEqual([true]);
    // The detail is the action's JSON text as-is, so userscripts in any world can read it.
    expect(details).toEqual(['{"command":"translate"}']);
    receiver.destroy();
    receiver = undefined;
    expect(api.listeners.size).toBe(0);
  } finally {
    document.removeEventListener(action.eventName, observe);
  }
});
