import assert from "node:assert/strict";
import test from "node:test";
import { codexEventsUntilCompleted, isCodexReconnectNotice } from "../lib/providers/codex-events";

async function* events(values: Array<{ type: string; message?: string }>) { yield* values; }
async function collect(values: Array<{ type: string; message?: string }>, signal?: AbortSignal) {
  const result = [];
  for await (const e of codexEventsUntilCompleted(events(values), signal)) result.push(e);
  return result;
}
test("Codex native reconnect progress can recover without aborting a healthy turn", async () => {
  const values = [{ type: "thread.started" }, { type: "error", message: "Reconnecting 2/5… stream disconnected" }, { type: "item.completed" }, { type: "turn.completed" }];
  assert.equal(isCodexReconnectNotice(values[1].message!), true);
  assert.equal(isCodexReconnectNotice("Reconnecting... 3/8"), true);
  assert.equal(isCodexReconnectNotice("Invalid API key"), false);
  assert.deepEqual(await collect(values), values);
});
test("a Codex stream that dies during reconnecting produces a retryable run error", async () => {
  await assert.rejects(collect([{ type: "error", message: "Reconnecting 2/5" }]), /Reconnecting 2\/5/);
  await assert.rejects(collect([{ type: "thread.started" }]), /ended before the turn completed/);
});
test("explicit stop remains an abort rather than an EOF retry", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(collect([{ type: "turn.completed" }], controller.signal), error => (error as Error).name === "AbortError");
});
