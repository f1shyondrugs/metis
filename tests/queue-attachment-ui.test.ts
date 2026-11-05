import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { mergeQueuedFollowUps } from "../lib/composer-send";
import { saveQueuedFollowUps, updateChatQueue } from "../lib/queue-client";

const file = ts.createSourceFile("app-shell.tsx", readFileSync("components/app-shell.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["queueCurrentMessage", "persistQueuedFollowUps", "applyServerQueuedMessages"];
const handlers: string[] = [];
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? "")) handlers.push(node.getText(file));
  ts.forEachChild(node, visit);
}
visit(file);
const js = ts.transpileModule(handlers.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
type Item = { id: string; text: string; files: Array<{ id: string; uploadTaskId: string; file: File }>; uploadIds?: string[]; storedAttachments?: unknown[] };
function fixture() {
  let queue: Item[] = [], cleared = 0;
  const saved: Array<{ queuedMessages: Array<Record<string, unknown>> }> = [], errors: string[] = [];
  const context: any = {
    activeChatId: "chat", activeChatIdRef: { current: "chat" }, loadingChatId: null,
    queuedState: { chatId: "chat", messages: queue }, queuedMessages: queue,
    stateRef: { current: { chatId: "chat", queueChatId: "chat", messages: [], queuedMessages: queue } },
    queuedSendRef: { current: new Set() }, removedIdsFor: () => new Set(),
    referenceText: "", references: [], restoredAttachments: [],
    getCompletedUploadResult: (id: string) => id === "task" ? { id: "server-upload" } : undefined,
    fetch: async (_url: string, request: RequestInit) => { saved.push(JSON.parse(String(request.body))); return Response.json({}); },
    setQueuedMessages: (update: Item[] | ((current: Item[]) => Item[])) => { queue = typeof update === "function" ? update(queue) : update; context.queuedMessages = queue; context.queuedState.messages = queue; },
    setQueuedState: (updater: any) => { context.queuedState = updater(context.queuedState); queue = context.queuedState.messages; context.queuedMessages = queue; context.stateRef.current.queuedMessages = queue; },
    setInputGuarded: () => { cleared++; }, setComposerSyncNonce: () => {}, setReferenceText: () => {},
    setReferences: () => {}, clearPendingFiles: () => {}, setRestoredAttachments: () => {},
    fileInputRef: { current: null }, toast: { error: (s: string) => errors.push(s) },
    mergeQueuedFollowUps, saveQueuedFollowUps, updateChatQueue,
  };
  const methods = vm.runInNewContext(js + "; ({queueCurrentMessage, persistQueuedFollowUps, applyServerQueuedMessages})", context);
  return { context, saved, errors, queue: () => queue, cleared: () => cleared, ...methods };
}
for (const state of ["empty", "consumed", "removed"] as const) {
  test(`queue persistence skips ${state} follow-ups without a request or error toast`, async () => {
    const f = fixture();
    const item = { id: "queued", text: "follow-up", files: [] };
    if (state === "consumed") f.context.stateRef.current.messages = [{ id: item.id, role: "user" }];
    if (state === "removed") f.context.removedIdsFor = () => new Set([item.id]);
    f.persistQueuedFollowUps("chat", state === "empty" ? [] : [item]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.saved.length, 0, "An empty pending queue must not trigger a PATCH");
    assert.equal(f.errors.length, 0);
  });
}

test("the real queue handler persists a finished photo upload with its prompt and clears only after attaching it", () => {
  const f = fixture();
  const photo = { id: "pending", uploadTaskId: "task", file: new File(["photo"], "photo.png", { type: "image/png" }) };
  f.queueCurrentMessage("Inspect photo", [photo]);
  assert.equal(f.queue().length, 1);
  assert.deepEqual(Array.from(f.queue()[0].uploadIds!), ["server-upload"]);
  assert.deepEqual(f.saved[0].queuedMessages[0].uploadIds, ["server-upload"]);
  assert.equal(f.queue()[0].files[0], photo);
  assert.equal(f.cleared(), 1);
});
for (const failure of ["http", "network"]) {
  test(`queue persistence reports ${failure} failures without dropping the local message`, async () => {
    const f = fixture();
    f.context.fetch = async () => {
      if (failure === "network") throw new Error("offline");
      return Response.json({ error: "busy" }, { status: 503 });
    };
    f.queueCurrentMessage("keep this follow-up", []);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.errors.length, 1);
    assert.equal(f.queue()[0].text, "keep this follow-up");
  });
}
test("unfinished or missing upload results keep the composer instead of enqueuing a text-only prompt", () => {
  const f = fixture();
  f.queueCurrentMessage("Inspect photo", [{ id: "p", uploadTaskId: "pending-task", file: new File(["p"], "photo.png") }]);
  assert.equal(f.queue().length, 0); assert.equal(f.saved.length, 0); assert.equal(f.cleared(), 0); assert.equal(f.errors.length, 1);
});
test("attachment-only prompts and two photos with identical text remain separate queue items", () => {
  const f = fixture();
  const photo = { id: "p", uploadTaskId: "task", file: new File(["p"], "photo.png") };
  f.queueCurrentMessage("", [photo]);
  f.queueCurrentMessage("Look", [photo]); f.queueCurrentMessage("Look", [photo]);
  assert.equal(f.queue().length, 3); assert.equal(f.saved.at(-1)!.queuedMessages.length, 3);
});
test("server queue snapshots restore attachments into the field used by Send now and edit", () => {
  const f = fixture(), attachment = { id: "photo", name: "photo.png", storedName: "photo.png", kind: "image", mimeType: "image/png", size: 10 };
  f.applyServerQueuedMessages("chat", [{ id: "q", text: "", attachments: [attachment] }]);
  assert.equal(f.queue()[0].files.length, 0);
  assert.equal(f.queue()[0].storedAttachments![0], attachment);
  f.persistQueuedFollowUps("chat", f.queue());
  assert.deepEqual(f.saved.at(-1)!.queuedMessages[0].attachments, [attachment]);
});
