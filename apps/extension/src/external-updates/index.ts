import { createExternalReceiver } from "./receiver";

const context = globalThis as typeof globalThis & { __browserailExternalReceiver?: ReturnType<typeof createExternalReceiver> };
if (!context.__browserailExternalReceiver) {
  const receiver = createExternalReceiver(document);
  context.__browserailExternalReceiver = receiver;
  window.addEventListener("pageshow", () => void receiver.refresh());
}
void context.__browserailExternalReceiver.refresh();
