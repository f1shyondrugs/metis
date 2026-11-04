// Portable source entrypoint, matching chat-page-worker.mjs.
import { parentPort, workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";
import { register as registerCjs } from "tsx/cjs/api";
import { fileURLToPath } from "node:url";
// A dedicated worker already isolates module state. One loader keeps every
// dependency in that graph and avoids namespaced alias URLs.
const tsconfig = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
registerCjs({ tsconfig });
register({ tsconfig });
process.env.CHAT_DB_PATH = workerData.databasePath;
const { initialize, maintain, observeNotificationEvents, deliverPendingNotifications } =
  await import("./notification-observer-worker.ts");
let stopped = false;
let timer;
let sequence = 0;
const pending = new Map();
function send(clientId, ownerId, notification) {
  if (stopped || pending.size >= 32) return Promise.resolve(false);
  const id = ++sequence;
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      resolve(false);
    }, 12000);
    pending.set(id, { resolve, timeout });
    parentPort.postMessage({ type: "send", id, clientId, ownerId, notification });
  });
}
parentPort.on("message", message => {
  if (message.type === "result") {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    request.resolve(message.acknowledged === true);
  } else if (message.type === "stop") {
    stopped = true;
    clearTimeout(timer);
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.resolve(false);
    }
    pending.clear();
    parentPort.close();
  }
});
async function tick() {
  if (stopped) return;
  try {
    maintain();
    observeNotificationEvents();
    await deliverPendingNotifications(send);
  } catch (error) {
    parentPort.postMessage({ type: "warning", error: String(error?.message || error) });
  } finally {
    if (!stopped) timer = setTimeout(tick, workerData.intervalMs);
  }
}
initialize();
parentPort.postMessage({ type: "ready" });
timer = setTimeout(tick, workerData.intervalMs);
