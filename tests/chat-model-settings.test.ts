import assert from "node:assert/strict";
import test from "node:test";
import { createChatModelSettingsQueue, type ChatModelSettingsSelection } from "../lib/chat-model-settings";

const selection = (modelId: string, effort: string, context: string, fast: string): ChatModelSettingsSelection => ({
  modelId, modelParams: [{ id: "effort", value: effort }, { id: "context", value: context }, { id: "fast", value: fast }],
});
const a = selection("account/model", "high", "context-a", "off");
const b = selection("account/model", "ultra", "context-b", "on");
function fixture() {
  const calls: Array<{ chatId: string; selection: ChatModelSettingsSelection; resolve: (selection: ChatModelSettingsSelection) => void; reject: (reason: Error) => void }> = [];
  const queue = createChatModelSettingsQueue((chatId, selected) => new Promise((resolve, reject) => calls.push({ chatId, selection: selected, resolve, reject })));
  return { queue, calls };
}

test("same model retains independent effort, context and fast settings for each chat", async () => {
  const { queue, calls } = fixture();
  const pendingA = queue.save("chat-a", a, { modelId: a.modelId, modelParams: [] });
  const pendingB = queue.save("chat-b", b, { modelId: b.modelId, modelParams: [] });
  assert.equal(calls.length, 2, "independent chats do not block one another");
  assert.deepEqual(queue.resolve("chat-a", b), a);
  assert.deepEqual(queue.resolve("chat-b", a), b);
  calls[1].resolve(b); await pendingB;
  assert.deepEqual(queue.resolve("chat-a", b), a, "late B confirmation cannot replace pending A");
  calls[0].resolve(a); await pendingA;
  assert.deepEqual(queue.resolve("chat-a", a), a);
  assert.deepEqual(queue.resolve("chat-b", b), b);
});

test("rapid settings writes are serialized and persist complete latest selections", async () => {
  const { queue, calls } = fixture();
  const first = queue.save("chat", b, a);
  const latest = selection("other-account/other-model", "custom-effort", "custom-context", "custom-speed");
  const second = queue.save("chat", latest, b);
  assert.equal(calls.length, 1);
  assert.deepEqual(queue.resolve("chat", a), latest);
  const canonical = selection(b.modelId, "canonical-effort", "canonical-context", "canonical-speed");
  calls[0].resolve(canonical);
  const oldResult = await first;
  assert.equal(oldResult.current, false);
  assert.deepEqual(queue.resolve("chat", a), latest, "older success cannot replace a newer optimistic selection");
  await Promise.resolve();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].selection, latest);
  calls[1].resolve(latest);
  const result = await second;
  assert.equal(result.current, true);
  assert.deepEqual(result.selection, latest);
  assert.equal(queue.pending("chat"), false);
});

test("latest failure rolls back to the last actual success, not an optimistic intermediate value", async () => {
  const { queue, calls } = fixture();
  const first = queue.save("chat", b, a);
  const second = queue.save("chat", { modelId: "next-model", modelParams: [] }, b);
  calls[0].resolve(b); await first; await Promise.resolve();
  calls[1].reject(new Error("network unavailable"));
  const failed = await second;
  assert.equal(failed.current, true);
  assert.equal(failed.error?.message, "network unavailable");
  assert.deepEqual(failed.selection, b);
});

test("obsolete failure does not replace a newer intent and overlapping failures restore the original baseline", async () => {
  const { queue, calls } = fixture();
  const first = queue.save("chat", b, a);
  const next = { modelId: "other-model", modelParams: [] };
  const second = queue.save("chat", next, b);
  calls[0].reject(new Error("first failed"));
  assert.equal((await first).current, false); await Promise.resolve();
  assert.deepEqual(queue.resolve("chat", a), next);
  calls[1].reject(new Error("second failed"));
  assert.deepEqual((await second).selection, a);
});

test("polls started before or during a save cannot restore stale settings after its confirmation", async () => {
  const { queue, calls } = fixture();
  const beforeWrite = queue.revision("chat");
  const writing = queue.save("chat", b, a);
  const duringWrite = queue.revision("chat");
  assert.equal(queue.acceptsSnapshot("chat", duringWrite), false);
  assert.deepEqual(queue.resolve("chat", a, beforeWrite), b);
  calls[0].resolve(b); await writing;
  assert.equal(queue.acceptsSnapshot("chat", beforeWrite), false);
  assert.equal(queue.acceptsSnapshot("chat", duringWrite), false);
  assert.deepEqual(queue.resolve("chat", a, beforeWrite), b);
  assert.deepEqual(queue.resolve("chat", a, duringWrite), b);
  const fresh = queue.revision("chat");
  assert.equal(queue.acceptsSnapshot("chat", fresh), true);
  assert.deepEqual(queue.resolve("chat", a, fresh), a, "fresh external server changes remain observable");
});

test("stale reads restore confirmed rollback after failure even after leaving and returning to the same chat", async () => {
  const { queue, calls } = fixture();
  const writing = queue.save("chat-a", b, a);
  const read = queue.revision("chat-a");
  assert.deepEqual(queue.resolve("chat-b", b), b);
  assert.deepEqual(queue.resolve("chat-a", a), b);
  calls[0].reject(new Error("rejected"));
  await writing;
  assert.deepEqual(queue.resolve("chat-a", b, read), a);
  assert.deepEqual(queue.resolve("chat-b", b), b);
});

test("input, writer, result and restored snapshots cannot mutate the coordinator state", async () => {
  const { queue, calls } = fixture();
  const next = selection("model", "high", "custom-context", "off");
  const writing = queue.save("chat", next, a);
  next.modelParams[0].value = "caller-mutation";
  assert.equal(calls[0].selection.modelParams[0].value, "high");
  calls[0].selection.modelParams[0].value = "writer-mutation";
  const snapshot = queue.resolve("chat", a);
  assert.equal(snapshot.modelParams[0].value, "high");
  snapshot.modelParams[0].value = "snapshot-mutation";
  const canonical = selection("model", "canonical", "canonical-context", "canonical-speed");
  const read = queue.revision("chat");
  calls[0].resolve(canonical);
  const result = await writing;
  canonical.modelParams[0].value = "response-mutation";
  result.selection.modelParams[0].value = "result-mutation";
  assert.equal(queue.resolve("chat", a, read).modelParams[0].value, "canonical");
});

test("ending an authentication session aborts active requests and prevents queued writes or late confirmation", async () => {
  let finish!: (selection: ChatModelSettingsSelection) => void;
  let signal: AbortSignal | undefined;
  let calls = 0;
  const queue = createChatModelSettingsQueue((_id, _selection, cancellation) => {
    calls++; signal = cancellation;
    return new Promise(resolve => { finish = resolve; });
  });
  const first = queue.save("shared-chat", b, a);
  const second = queue.save("shared-chat", { modelId: "next-model", modelParams: [] }, b);
  const during = queue.revision("shared-chat");
  queue.dispose();
  assert.equal(signal?.aborted, true);
  assert.equal(queue.pending("shared-chat"), false);
  finish(b);
  assert.equal((await first).current, false);
  assert.equal((await second).current, false);
  assert.equal(calls, 1, "the queued write must not run with another account cookie");
  assert.deepEqual(queue.resolve("shared-chat", a, during), a);
  const ignored = await queue.save("shared-chat", b, a);
  assert.equal(ignored.current, false); assert.equal(ignored.error, undefined); assert.equal(calls, 1);
});

test("aborting a network writer is a cancelled outcome instead of a user-facing save error", async () => {
  const queue = createChatModelSettingsQueue((_id, _selection, signal) => new Promise((_resolve, reject) => {
    signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const pending = queue.save("chat", b, a);
  queue.dispose();
  const result = await pending;
  assert.equal(result.current, false); assert.equal(result.error, undefined);
  assert.deepEqual(result.selection, a);
});

test("empty parameter arrays stay explicit and malformed server confirmation is a failed save", async () => {
  const { queue, calls } = fixture();
  const next = { modelId: "model-with-defaults", modelParams: [] };
  const first = queue.save("chat", next, a);
  assert.deepEqual(calls[0].selection, next);
  calls[0].resolve(next); assert.deepEqual((await first).selection, next);
  const invalid = queue.save("chat", b, next);
  calls[1].resolve({ modelId: "", modelParams: [] });
  const result = await invalid;
  assert.match(result.error!.message, /Invalid/);
  assert.deepEqual(result.selection, next);
});
