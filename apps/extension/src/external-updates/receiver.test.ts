// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createExternalReceiver } from "./receiver";
import { sendUserscriptUpdate } from "./client";

const api = vi.hoisted(() => ({ send: vi.fn<(message: unknown) => Promise<unknown>>() }));
vi.mock("webextension-polyfill", () => ({ default: {
  runtime: { id: "browserail-test", sendMessage: api.send },
  storage: { onChanged: { addListener() {}, removeListener() {} } },
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
  currentToken = "";
  await receiver.refresh();
  sendUserscriptUpdate(token, update);
  expect(relays()).toHaveLength(1);
  currentToken = token;
  await receiver.refresh();
  receiver.destroy();
  sendUserscriptUpdate(token, update);
  expect(relays()).toHaveLength(1);
});
