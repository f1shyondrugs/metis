import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { removeQueuedFollowUp } from "../lib/queue-client";

// Execute the actual event handlers with a deferred DELETE, not a copy of them.
const source = ts.createSourceFile("app-shell.tsx", readFileSync("components/app-shell.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers: string[] = [];
function find(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ["removeMessageFromQueue", "editQueuedMessage", "send"].includes(node.name?.text || "")) handlers.push(node.getText(source));
  ts.forEachChild(node, find);
}
find(source);
assert.equal(handlers.length, 3);
const js = ts.transpileModule(handlers.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function fixture(chatId: string | null = "chat") {
  const message = { id: "q", text: "Edit me", files: [{ name: "local.txt" }],
    referenceText: "Context", references: [{ kind: "chat", id: "source", label: "Source" }],
    storedAttachments: [{ id: "stored", name: "stored.txt" }] };
  const kept = { ...message, id: "keep", text: "Keep queued" };
  let queue = [message, kept], input = "Previous draft", focuses = 0, nonce = 0;
  let files = [] as typeof message.files, references = [] as typeof message.references;
  let attachments = [] as typeof message.storedAttachments, referenceText = "";
  let calls = 0, finish!: (response: Response) => void;
  const removed = new Set<string>(), errors: string[] = [], cancelled: number[] = [], timers: Array<() => void> = [];
  const context = {
    activeChatId: chatId, activeChatIdRef: { current: chatId }, loadingChatId: null as string | null,
    queuedState: { chatId }, queuedMessages: queue, queuedSendRef: { current: new Set<string>() },
    removedIdsFor: () => removed, removeQueuedFollowUp,
    sendInFlightKeysRef: { current: new Set<string>() }, setSendLockTick: () => {},
    chatCacheRef: { current: new Map() }, chatCacheScope: "fixture",
    writeClientChatSnapshot: () => {}, deleteClientChatSnapshot: () => {},
    setQueuedMessages: (update: (items: typeof queue) => typeof queue) => {
      queue = update(queue); context.queuedMessages = queue;
    },
    handleComposerInputChange: (value: string) => { context.draftInputRef.current = value; context.stateRef.current.input = value; },
    draftInputRef: { current: input }, stateRef: { current: { input } },
    inputCommitTimerRef: { current: 42 },
    setInput: (value: string) => { input = value; },
    setComposerSyncNonce: (update: (value: number) => number) => { nonce = update(nonce); },
    setReferenceText: (value: string) => { referenceText = value; },
    setReferences: (value: typeof references) => { references = value; },
    setPendingFiles: (value: typeof files) => { files = value; },
    setRestoredAttachments: (value: typeof attachments) => { attachments = value; },
    setReferenceMenu: () => {}, setSlashQuery: () => {},
    fileInputRef: { current: { value: "previous-file" } },
    textareaRef: { current: { focus: () => { focuses++; } } },
    window: { clearTimeout: (timer: number) => { cancelled.push(timer); }, setTimeout: (callback: () => void) => { timers.push(callback); } },
    chainSelectionBusyRef: { current: false }, reverting: false,
    toast: { error: (error: string) => { errors.push(error); }, info: () => {} },
  };
  // The real removal helper uses fetch; inject the transport without replacing its behavior.
  context.removeQueuedFollowUp = (options: Parameters<typeof removeQueuedFollowUp>[0]) => removeQueuedFollowUp({
    ...options, request: async () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); },
  });
  const methods = vm.runInNewContext(js + "; ({editQueuedMessage, send})", context) as {
    editQueuedMessage: (item: typeof message) => Promise<void>;
    send: () => Promise<void>;
  };
  return { message, kept, context, errors, cancelled, removed, ...methods,
    finish: (ok = true) => finish(Response.json({}, {status: ok ? 200 : 500})),
    type: (value: string) => { input = value; context.draftInputRef.current = value; context.stateRef.current.input = value; },
    flushFocus: () => { timers.splice(0).forEach(callback => callback()); },
    read: () => ({queue, input, files, references, referenceText, attachments, calls, focuses, nonce}),
  };
}

test("queued text, references and files reach the composer before the DELETE acknowledgement", async () => {
  const f = fixture();
  const pending = f.editQueuedMessage(f.message);
  const state = f.read();
  assert.equal(state.input, f.message.text);
  assert.equal(f.context.draftInputRef.current, f.message.text);
  assert.equal(f.context.stateRef.current.input, f.message.text);
  assert.deepEqual(state.queue, [f.kept]);
  assert.equal(state.files, f.message.files);
  assert.equal(state.references, f.message.references);
  assert.equal(state.attachments, f.message.storedAttachments);
  assert.equal(state.referenceText, f.message.referenceText);
  assert.equal(state.calls, 1);
  assert.equal(f.context.sendInFlightKeysRef.current.has("chat"), true, "Sending waits for original removal while editing remains immediate");
  assert.deepEqual(f.cancelled, [42]);
  assert.equal(f.context.inputCommitTimerRef.current, 0);
  f.type("Already editing while offline");
  await f.send();
  assert.equal(f.read().calls, 1, "Submitting cannot queue or send a second copy before removal");
  assert.equal(f.read().input, "Already editing while offline");
  f.finish();
  await pending;
  assert.equal(f.read().input, "Already editing while offline");
  assert.equal(f.read().nonce, 1, "No late force-sync may clobber typed edits");
  assert.equal(f.context.sendInFlightKeysRef.current.size, 0);
});

test("a failed removal restores the queue while preserving the edited draft and reports it", async () => {
  const f = fixture();
  const pending = f.editQueuedMessage(f.message);
  f.type("Edited during the request");
  f.finish(false);
  await pending;
  assert.deepEqual(Array.from(f.read().queue), [f.message, f.kept]);
  assert.equal(f.read().input, "Edited during the request");
  assert.equal(f.removed.has(f.message.id), false);
  assert.equal(f.context.sendInFlightKeysRef.current.size, 0, "A failed DELETE cannot leave submission locked");
  assert.match(f.errors[0], /still queued; your draft has been kept/);
});

test("navigation before acknowledgement cannot insert text or focus the destination chat", async () => {
  const f = fixture();
  const pending = f.editQueuedMessage(f.message);
  f.context.activeChatIdRef.current = "destination";
  f.type("Destination draft");
  f.flushFocus();
  f.finish();
  await pending;
  assert.equal(f.read().input, "Destination draft");
  assert.equal(f.read().focuses, 0);
});

test("draft chats edit locally without a server request", async () => {
  const f = fixture(null);
  await f.editQueuedMessage(f.message);
  assert.equal(f.read().calls, 0);
  assert.equal(f.read().input, f.message.text);
});

test("double click cannot replace edits or issue another DELETE", async () => {
  const f = fixture();
  const pending = f.editQueuedMessage(f.message);
  f.type("New edit");
  await f.editQueuedMessage(f.message);
  assert.equal(f.read().calls, 1);
  assert.equal(f.read().input, "New edit");
  f.finish();
  await pending;
});

test("outgoing, loading and already-sending queue items cannot replace a draft", async () => {
  for (const guard of ["outgoing", "loading", "sending", "missing"] as const) {
    const f = fixture();
    if (guard === "outgoing") f.context.activeChatIdRef.current = "destination";
    if (guard === "loading") f.context.loadingChatId = "chat";
    if (guard === "sending") f.context.queuedSendRef.current.add(f.message.id);
    if (guard === "missing") f.context.queuedMessages = [f.kept];
    await f.editQueuedMessage(f.message);
    assert.equal(f.read().input, "Previous draft", guard);
    assert.equal(f.read().calls, 0, guard);
  }
});
