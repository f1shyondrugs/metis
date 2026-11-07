import assert from "node:assert/strict";
import test from "node:test";
import {
  composerLiveText,
  decideComposerSend,
  isDuplicateComposerSend,
  mergeQueuedFollowUps,
  shouldAcceptRemoteComposerInput,
  shouldAutoDrainQueue,
  shouldIgnoreComposerEnter,
  shouldStartQueuedFollowUp,
  shouldCommitComposerParentState,
  shouldSyncComposerDom,
  composerTranscriptInsert,
  composerTranscriptFinalizer,
  stripComposerPlaceholderLeak,
} from "../lib/composer-send";

test("composerLiveText prefers non-empty DOM text over stale React state", () => {
  assert.equal(composerLiveText("hello from editor", ""), "hello from editor");
  assert.equal(composerLiveText("\n", "draft"), "draft");
  assert.equal(composerLiveText("  ", "draft"), "draft");
});

test("composerLiveText ignores a leaked Message Metis placeholder", () => {
  assert.equal(composerLiveText("Message Metis…", ""), "");
  assert.equal(composerLiveText("Message Metis…", "draft"), "draft");
  assert.equal(stripComposerPlaceholderLeak("Message Metis…"), "");
  assert.equal(stripComposerPlaceholderLeak("hello"), "hello");
});

test("shouldCommitComposerParentState only flips when the field becomes empty or nonempty", () => {
  assert.equal(shouldCommitComposerParentState("", "h"), true);
  assert.equal(shouldCommitComposerParentState("h", "he"), false);
  assert.equal(shouldCommitComposerParentState("hello", "hell"), false);
  assert.equal(shouldCommitComposerParentState("hello", ""), true);
  assert.equal(shouldCommitComposerParentState("  ", "x"), true);
});

test("shouldSyncComposerDom never overwrites a focused editor without force", () => {
  assert.equal(shouldSyncComposerDom("hello", "", true), false);
  assert.equal(shouldSyncComposerDom("hello", "", true, true), true);
  assert.equal(shouldSyncComposerDom("h", "", true), false);
  assert.equal(shouldSyncComposerDom("hel", "he", true), false);
  assert.equal(shouldSyncComposerDom("hello", "hello", true), false);
  assert.equal(shouldSyncComposerDom("hello", "other draft", true), false);
  assert.equal(shouldSyncComposerDom("hello", "other draft", false), true);
});

test("shouldSyncComposerDom inserts a forced voice transcript while focused", () => {
  assert.equal(shouldSyncComposerDom("", "spoken text", true), false);
  assert.equal(shouldSyncComposerDom("", "spoken text", true, true), true);
  assert.equal(shouldSyncComposerDom("draft", "draft spoken text", true, true), true);
});

test("composerTranscriptInsert appends spoken text to the live draft", () => {
  assert.equal(composerTranscriptInsert("", "hello there"), "hello there");
  assert.equal(composerTranscriptInsert("draft", "hello"), "draft hello");
  assert.equal(composerTranscriptInsert("  draft  ", "  hello  "), "draft hello");
  assert.equal(composerTranscriptInsert("draft", "   "), "draft");
});

test("final streaming text replaces only the untouched voice insertion and preserves existing text", () => {
  let current = { text: "Draft spoken", chatId: "a", epoch: 4, editedAt: "now" };
  const finalize = composerTranscriptFinalizer("Draft", () => current, text => { current = { ...current, text }; });
  finalize("spoken words.");
  assert.equal(current.text, "Draft spoken words.");
  finalize("duplicate");
  assert.equal(current.text, "Draft spoken words.");
});

test("late streaming finalization cannot overwrite edits, sends, chat switches or another recording", () => {
  const inserted = { text: "Draft spoken", chatId: "a", epoch: 4, editedAt: "now" };
  for (const change of [
    { text: "User edited" }, { text: "" }, { chatId: "b" }, { epoch: 5 },
    { editedAt: "later" },
  ]) {
    let current = { ...inserted };
    let applied = false;
    const finalize = composerTranscriptFinalizer("Draft", () => current, () => { applied = true; });
    current = { ...current, ...change };
    finalize("spoken words.");
    assert.equal(applied, false, JSON.stringify(change));
  }
});

test("empty final STT result retains the streamed draft", () => {
  let text = "spoken";
  const finalize = composerTranscriptFinalizer("", () => ({ text, chatId: null, epoch: 1, editedAt: "" }), value => { text = value; });
  finalize("");
  assert.equal(text, "spoken");
});

test("shouldAcceptRemoteComposerInput rejects a stale draft after local clear", () => {
  assert.equal(
    shouldAcceptRemoteComposerInput({
      dirtyUntil: 0,
      now: 2_000,
      localUpdatedAt: "2026-09-09T14:00:01.000Z",
      remoteUpdatedAt: "2026-09-09T14:00:00.000Z",
      remoteInput: "hello",
    }),
    false,
  );
  assert.equal(
    shouldAcceptRemoteComposerInput({
      dirtyUntil: 1_500,
      now: 1_000,
      remoteInput: "hello",
    }),
    false,
  );
  assert.equal(
    shouldAcceptRemoteComposerInput({
      dirtyUntil: 0,
      now: 2_000,
      localUpdatedAt: "2026-09-09T14:00:00.000Z",
      remoteUpdatedAt: "2026-09-09T14:00:02.000Z",
      remoteInput: "newer",
    }),
    true,
  );
});

test("shouldIgnoreComposerEnter skips IME confirmation and key repeat", () => {
  assert.equal(shouldIgnoreComposerEnter({ key: "Enter", shiftKey: false, isComposing: true }), true);
  assert.equal(shouldIgnoreComposerEnter({ key: "Enter", shiftKey: false, keyCode: 229 }), true);
  assert.equal(shouldIgnoreComposerEnter({ key: "Enter", shiftKey: false, repeat: true }), true);
  assert.equal(shouldIgnoreComposerEnter({ key: "Enter", shiftKey: true }), false);
  assert.equal(shouldIgnoreComposerEnter({ key: "Enter", shiftKey: false }), false);
});

test("isDuplicateComposerSend blocks same-text Enter spam without blocking later retries", () => {
  const last = { text: "hi", at: 1000 };
  assert.equal(isDuplicateComposerSend("hi", last, 1500), true);
  assert.equal(isDuplicateComposerSend("hi", last, 2000), false);
  assert.equal(isDuplicateComposerSend("other", last, 1100), false);
});

test("decideComposerSend queues follow-ups while a run is in flight instead of dropping them", () => {
  assert.equal(
    decideComposerSend({
      force: false,
      isOverride: false,
      hasContent: true,
      sendInFlight: true,
      busy: false,
      waitingForQuestion: false,
      duplicate: false,
    }),
    "queue",
  );
  assert.equal(
    decideComposerSend({
      force: false,
      isOverride: false,
      hasContent: true,
      sendInFlight: true,
      busy: false,
      waitingForQuestion: false,
      duplicate: true,
    }),
    "ignore",
  );
  assert.equal(
    decideComposerSend({
      force: false,
      isOverride: false,
      hasContent: true,
      sendInFlight: false,
      busy: false,
      waitingForQuestion: false,
      duplicate: false,
    }),
    "send",
  );
  assert.equal(
    decideComposerSend({
      force: false,
      isOverride: false,
      hasContent: true,
      sendInFlight: false,
      busy: true,
      waitingForQuestion: true,
      duplicate: false,
    }),
    "queue",
  );
  assert.equal(
    decideComposerSend({
      force: true,
      isOverride: true,
      hasContent: true,
      sendInFlight: true,
      busy: false,
      waitingForQuestion: false,
      duplicate: false,
    }),
    "ignore",
  );
});

test("decideComposerSend queues when the same chat already has a live runtime", () => {
  assert.equal(
    decideComposerSend({
      force: false,
      isOverride: false,
      hasContent: true,
      sendInFlight: false,
      busy: false,
      waitingForQuestion: false,
      duplicate: false,
      hasActiveRuntime: true,
    }),
    "queue",
  );
});

test("shouldStartQueuedFollowUp allows only one queued send at a time", () => {
  assert.equal(
    shouldStartQueuedFollowUp({
      drainInFlight: true,
      sendInFlight: false,
      busy: false,
      waitingForQuestion: false,
    }),
    false,
  );
  assert.equal(
    shouldStartQueuedFollowUp({
      drainInFlight: false,
      sendInFlight: false,
      busy: false,
      waitingForQuestion: false,
      hasActiveRuntime: true,
    }),
    false,
  );
  assert.equal(
    shouldStartQueuedFollowUp({
      drainInFlight: false,
      sendInFlight: false,
      busy: false,
      waitingForQuestion: false,
    }),
    true,
  );
});

test("shouldAutoDrainQueue waits for sendInFlight and the drain lock", () => {
  assert.equal(
    shouldAutoDrainQueue({
      busy: false,
      sendInFlight: true,
      waitingForQuestion: false,
      drainBlocked: false,
      drainInProgress: false,
      queueLength: 1,
    }),
    false,
  );
  assert.equal(
    shouldAutoDrainQueue({
      busy: false,
      sendInFlight: false,
      waitingForQuestion: false,
      drainBlocked: false,
      drainInProgress: false,
      queueLength: 1,
    }),
    true,
  );
  assert.equal(
    shouldAutoDrainQueue({
      busy: false,
      sendInFlight: false,
      waitingForQuestion: false,
      drainBlocked: false,
      drainInProgress: false,
      queueLength: 1,
      hasActiveRuntime: true,
    }),
    false,
  );
  assert.equal(
    shouldAutoDrainQueue({
      busy: false,
      sendInFlight: false,
      waitingForQuestion: false,
      drainBlocked: false,
      drainInProgress: false,
      queueLength: 1,
      serverOwnsDrain: true,
    }),
    false,
  );
});

test("unchanged live-sync queues preserve state identity and do not restart autosave", () => {
  const empty: Array<{ id: string; text: string }> = [];
  assert.equal(mergeQueuedFollowUps(empty, []), empty);
  const local = [{ id: "q-1", text: "Keep this", files: ["local attachment"] }];
  let state = local;
  let autosaves = 0;
  for (let index = 0; index < 1000; index++) {
    const next = mergeQueuedFollowUps(state, [{ id: "q-1", text: "Keep this", files: [] }]);
    if (next !== state) autosaves++;
    state = next;
  }
  assert.equal(state, local);
  assert.equal(autosaves, 0);
  assert.notEqual(mergeQueuedFollowUps(local, [{ id: "q-2", text: "New", files: [] }]), local);
  assert.notEqual(mergeQueuedFollowUps(local, [], { consumedIds: ["q-1"] }), local);
});

test("mergeQueuedFollowUps keeps local follow-ups when a stale snapshot is empty", () => {
  const local = [{ id: "q-1", text: "later" }];
  assert.deepEqual(
    mergeQueuedFollowUps(local, []),
    local,
  );
});

test("mergeQueuedFollowUps drops follow-ups that already became user messages", () => {
  const local = [{ id: "q-1", text: "later" }, { id: "q-2", text: "after that" }];
  const server = [{ id: "q-2", text: "after that" }];
  assert.deepEqual(
    mergeQueuedFollowUps(local, server, { consumedIds: ["q-1"] }),
    [{ id: "q-2", text: "after that" }],
  );
});

test("mergeQueuedFollowUps prefers the local copy so attachments survive a GET", () => {
  const local = [{ id: "q-1", text: "with file", files: ["a"] }];
  const server = [{ id: "q-1", text: "with file" }];
  assert.deepEqual(
    mergeQueuedFollowUps(local, server),
    local,
  );
});

test("mergeQueuedFollowUps does not resurrect locally removed follow-ups", () => {
  const server = [{ id: "q-1", text: "later" }, { id: "q-2", text: "keep" }];
  assert.deepEqual(
    mergeQueuedFollowUps([{ id: "q-2", text: "keep" }], server, { removedIds: ["q-1"] }),
    [{ id: "q-2", text: "keep" }],
  );
});

import { __resetClientTelemetryForTests, __queuedClientTelemetryForTests, reportUxEvent } from "../lib/client-telemetry";

test("reportUxEvent records dedupe and lock reason telemetry without visible UI", () => {
  __resetClientTelemetryForTests();
  reportUxEvent("send_rejected", { reason: "duplicate_fingerprint", duplicate: true });
  reportUxEvent("send_rejected", { reason: "lock_held", duplicate: false });
  const queued = __queuedClientTelemetryForTests();
  assert.equal(queued.length, 2);
  assert.equal(queued[0].message, "ux:send_rejected");
  assert.equal((queued[0].context?.detail as { reason?: string })?.reason, "duplicate_fingerprint");
  assert.equal((queued[1].context?.detail as { reason?: string })?.reason, "lock_held");
  // Identical event kind+message is deduped within 60s.
  reportUxEvent("send_rejected", { reason: "duplicate_fingerprint", duplicate: true });
  assert.equal(__queuedClientTelemetryForTests().length, 2);
});
