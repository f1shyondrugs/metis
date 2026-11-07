import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { mergeQueuedFollowUps, shouldStartQueuedFollowUp } from "../lib/composer-send";
import { saveQueuedFollowUps, updateChatQueue, type ChatQueueState, type ChatQueueUpdate } from "../lib/queue-client";

const file = ts.createSourceFile("app-shell.tsx", readFileSync("components/app-shell.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers: Record<string, string> = {};
function find(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ["sendQueuedMessage", "applyServerQueuedMessages", "persistQueuedFollowUps"].includes(node.name?.text ?? "")) handlers[node.name!.text] = node.getText(file);
  ts.forEachChild(node, find);
}
find(file);
assert.equal(Object.keys(handlers).length, 3);
const js = ts.transpileModule(Object.values(handlers).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function fixture() {
  const first = { id: "first", text: "first queued", files: [] };
  const second = { id: "second", text: "second queued", files: [] };
  let queueState: ChatQueueState<typeof first> = { chatId: "chat", messages: [first, second] };
  let queue = queueState.messages;
  let aborts = 0;
  const calls: Array<{ args: unknown[]; finish: () => void }> = [];
  const queueDrainRef = { current: false };
  const queueDrainBlockedRef = { current: false };
  const queuedSendRef = { current: new Set<string>() };
  const saved: Array<{ queuedMessages: typeof queue }> = [];
  const urls: string[] = [];
  const context = {
    activeChatId: "chat", loadingChatId: null, queuedState: queueState, queuedMessages: queue,
    activeChatIdRef: { current: "chat" },
    runtimeRef: { current: new Map([["chat", { abortController: { abort: () => { aborts++; } } }]]) },
    busy: true, busyRef: { current: true },
    modelId: "unit-test-selection",
    pendingQuestion: null as { questionId: string } | null, pendingQuestionIdRef: { current: null as string | null }, answeringQuestion: false,
    sendInFlightKeysRef: { current: new Set<string>() }, queueDrainRef, queueDrainBlockedRef, queuedSendRef,
    shouldStartQueuedFollowUp, mergeQueuedFollowUps, saveQueuedFollowUps, updateChatQueue,
    stateRef: { current: { chatId: "chat", queueChatId: "chat", loadingChatId: null as string | null, messages: [] as Array<{ id: string; role: string }> } },
    removedIdsFor: () => new Set<string>(),
    fetch: async (url: string, request: { body: string }) => { urls.push(url); saved.push(JSON.parse(request.body)); return Response.json({}); },
    setQueuedState: (update: (current: typeof queueState) => typeof queueState) => {
      queueState = update(queueState); queue = queueState.messages;
      context.queuedState = queueState; context.queuedMessages = queue;
    },
    setQueuedMessages: (update: ChatQueueUpdate<typeof first>) => {
      queueState = updateChatQueue(queueState, "chat", update); queue = queueState.messages;
      context.queuedState = queueState; context.queuedMessages = queue;
    },
    setSendLockTick: () => {}, setPendingQuestion: () => {}, setPendingApproval: () => {},
    toast: { info: () => {}, error: () => {} },
    send: (...args: unknown[]) => new Promise<void>((resolve) => { calls.push({ args, finish: resolve }); }),
  };
  const methods = vm.runInNewContext(js + "; ({ sendQueuedMessage, applyServerQueuedMessages, persistQueuedFollowUps })", context) as {
    sendQueuedMessage: (message: typeof first) => Promise<void>;
    applyServerQueuedMessages: (chatId: string, messages: typeof queue) => void;
    persistQueuedFollowUps: (chatId: string, messages: typeof queue) => void;
  };
  return { first, second, context, calls, saved, urls, queueDrainRef, queuedSendRef, ...methods,
    applyServerQueuedMessages: (items: typeof queue, chatId = "chat") => methods.applyServerQueuedMessages(chatId, items),
    persistQueuedFollowUps: (items: typeof queue, chatId = "chat") => methods.persistQueuedFollowUps(chatId, items),
    switchChat: (id: string, items: typeof queue) => {
      context.activeChatIdRef.current = id;
      context.stateRef.current.chatId = id; context.stateRef.current.queueChatId = id;
      queueState = { chatId: id, messages: items }; queue = items;
      context.queuedState = queueState; context.queuedMessages = queue;
    },
    queue: () => queue, aborts: () => aborts };
}

test("the real Send now handler submits during a running run and releases its lock on acceptance", async () => {
  const f = fixture();
  const first = f.sendQueuedMessage(f.first);
  assert.equal(f.calls.length, 1);
  assert.equal(f.aborts(), 1);
  assert.equal(f.calls[0].args[9], true, "API receives the explicit Send now intent");
  assert.equal(f.queuedSendRef.current.has(f.first.id), true);
  assert.deepEqual(f.queue(), [f.first, f.second], "Keep the message until accepted");
  (f.calls[0].args[7] as () => void)();
  assert.deepEqual(f.queue(), [f.second]);
  assert.equal(f.queueDrainRef.current, false, "Do not lock Send now for the entire SSE stream");
  assert.equal(f.context.pendingQuestionIdRef.current, null);
  const second = f.sendQueuedMessage(f.second);
  assert.equal(f.calls.length, 2);
  f.calls[0].finish();
  await first;
  assert.equal(f.queueDrainRef.current, true, "Old stream cleanup cannot release the newer POST lock");
  assert.equal(f.queuedSendRef.current.has(f.second.id), true);
  (f.calls[1].args[7] as () => void)();
  f.calls[1].finish();
  await second;
  assert.equal(f.queuedSendRef.current.size, 0);
});

test("a double click before acceptance submits only once", async () => {
  const f = fixture();
  const sending = f.sendQueuedMessage(f.first);
  await f.sendQueuedMessage(f.first);
  await f.sendQueuedMessage(f.second);
  assert.equal(f.calls.length, 1);
  f.calls[0].finish();
  await sending;
  assert.deepEqual(f.queue(), [f.first, f.second], "Unaccepted messages remain queued");
});

test("no selected model leaves the queue and the live stream intact", async () => {
  const f = fixture();
  f.context.modelId = "";
  await f.sendQueuedMessage(f.first);
  assert.equal(f.calls.length, 0);
  assert.equal(f.aborts(), 0);
  assert.deepEqual(f.queue(), [f.first, f.second]);
});

test("live sync and autosave retain an unaccepted queued submission even with its optimistic user message", async () => {
  const f = fixture();
  const sending = f.sendQueuedMessage(f.first);
  f.context.stateRef.current.messages = [{ id: f.first.id, role: "user" }];
  f.applyServerQueuedMessages([f.first, f.second]);
  assert.equal(f.queue().length, 2);
  f.persistQueuedFollowUps(f.queue());
  assert.deepEqual(f.saved[0].queuedMessages.map((message) => message.id), [f.first.id, f.second.id]);
  (f.calls[0].args[7] as () => void)();
  f.applyServerQueuedMessages([f.first, f.second]);
  assert.equal(f.queue().length, 1);
  assert.equal(f.queue()[0].id, f.second.id);
  f.calls[0].finish();
  await sending;
});

for (const waitingState of ["question", "sync-ref", "answer-submit"] as const) {
  test(`queued UI messages stay untouched while waiting for ${waitingState}`, async () => {
    const f = fixture();
    if (waitingState === "question") f.context.pendingQuestion = { questionId: "open-question" };
    if (waitingState === "sync-ref") f.context.pendingQuestionIdRef.current = "open-question";
    if (waitingState === "answer-submit") f.context.answeringQuestion = true;
    await f.sendQueuedMessage(f.first);
    assert.equal(f.calls.length, 0);
    assert.equal(f.aborts(), 0);
    assert.deepEqual(f.queue(), [f.first, f.second]);
    assert.equal(f.queueDrainRef.current, false);
    f.context.pendingQuestion = null;
    f.context.pendingQuestionIdRef.current = null;
    f.context.answeringQuestion = false;
    const resumed = f.sendQueuedMessage(f.first);
    assert.equal(f.calls.length, 1);
    f.calls[0].finish();
    await resumed;
  });
}


test("an outgoing chat's delayed autosave cannot PATCH the newly active chat", () => {
  const f = fixture();
  const outgoing = f.queue();
  f.context.activeChatIdRef.current = "other-chat";
  // Navigation changes the ref before React replaces the outgoing state.
  f.persistQueuedFollowUps(outgoing);
  assert.deepEqual(f.urls, []);
  f.switchChat("other-chat", [{ id: "other", text: "other chat queue", files: [] }]);
  f.persistQueuedFollowUps(outgoing);
  assert.deepEqual(f.urls, []);
  assert.equal(f.queue()[0].id, "other");
});

test("hydrating a destination chat must precede persisting its queue", () => {
  const f = fixture();
  f.context.stateRef.current.queueChatId = "outgoing-chat";
  f.persistQueuedFollowUps(f.queue());
  assert.deepEqual(f.urls, []);
  f.context.stateRef.current.queueChatId = "chat";
  f.persistQueuedFollowUps(f.queue());
  assert.deepEqual(f.urls, ["/api/chats/chat"]);
});

test("a late live-sync response from another chat cannot merge queues", () => {
  const f = fixture();
  f.switchChat("other-chat", [{ id: "other", text: "stay here", files: [] }]);
  f.applyServerQueuedMessages([f.first, f.second]);
  assert.equal(f.queue().length, 1);
  assert.equal(f.queue()[0].id, "other");
});

test("an old Send now acknowledgement cannot remove items from the newly active queue", async () => {
  const f = fixture();
  const sending = f.sendQueuedMessage(f.first);
  const destination = [{ ...f.first, text: "different chat owns this item" }];
  f.switchChat("other-chat", destination);
  (f.calls[0].args[7] as () => void)();
  assert.deepEqual(f.queue(), destination);
  f.calls[0].finish();
  await sending;
});

test("a stale queue click during navigation cannot send to or interrupt the destination", async () => {
  const f = fixture();
  f.context.activeChatIdRef.current = "other-chat";
  await f.sendQueuedMessage(f.first);
  assert.equal(f.calls.length, 0);
  assert.equal(f.aborts(), 0);
  assert.deepEqual(f.queue(), [f.first, f.second]);
});
