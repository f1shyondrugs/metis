import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { mergeQueuedFollowUps } from "../lib/composer-send";
import * as queueClient from "../lib/queue-client";

const source = ts.createSourceFile(
  "app-shell.tsx",
  readFileSync("components/app-shell.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const handlers: string[] = [];
let lifecycle = "";
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) &&
      ["queueCurrentMessage", "persistQueuedFollowUps"].includes(node.name?.text ?? "")) {
    handlers.push(node.getText(source));
  }
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect") {
    const callback = node.arguments[0];
    const body = callback?.getText(source);
    if (body?.includes('addEventListener("pagehide", flush)') &&
        body.includes('addEventListener("visibilitychange",')) {
      lifecycle = body;
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(handlers.length, 2, "Exercise the actual AppShell queue handlers");
assert.ok(lifecycle, "Exercise the actual page-hide persistence effect");
const js = ts.transpileModule(
  handlers.join("\n") + "\nconst installLifecycle = " + lifecycle + ";",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

type Item = {
  id: string;
  text: string;
  files: unknown[];
  uploadIds?: string[];
  storedAttachments?: unknown[];
};
type Update = Item[] | ((current: Item[]) => Item[]);

function fixture(failures = 0) {
  let queue: Item[] = [];
  let cleared = 0;
  const removed = new Set<string>();
  const deferred: Update[] = [];
  const requests: Array<{ url: string; init: RequestInit; body: { queuedMessages: Item[] } }> = [];
  const errors: string[] = [];
  const listeners = new Map<string, () => void>();
  const context: any = {
    activeChatId: "chat",
    activeChatIdRef: { current: "chat" },
    loadingChatId: null,
    queuedState: { chatId: "chat", messages: queue },
    queuedMessages: queue,
    stateRef: { current: {
      chatId: "chat", queueChatId: "chat", loadingChatId: null,
      messages: [], queuedMessages: queue,
    } },
    queuedSendRef: { current: new Set<string>() },
    removedIdsFor: () => removed,
    referenceText: "", references: [], restoredAttachments: [],
    getCompletedUploadResult: () => undefined,
    fetch: async (url: string, init: RequestInit) => {
      requests.push({ url, init, body: JSON.parse(String(init.body)) });
      if (failures-- > 0) throw new TypeError("Temporarily offline");
      return Response.json({});
    },
    // React is allowed to evaluate functional updaters during a later render.
    // No render, timer, effect or updater runs during the simulated click.
    setQueuedMessages: (update: Update) => { deferred.push(update); },
    setInputGuarded: () => { cleared++; },
    setComposerSyncNonce: () => {},
    setReferenceText: () => {},
    setReferences: () => {},
    clearPendingFiles: () => {},
    setRestoredAttachments: () => {},
    fileInputRef: { current: null },
    toast: { error: (message: string) => errors.push(message) },
    persistActiveSnapshot: () => {},
    draftInputLoadedRef: { current: false },
    document: {
      visibilityState: "visible",
      addEventListener: (name: string, callback: () => void) => { listeners.set(name, callback); },
      removeEventListener: (name: string) => { listeners.delete(name); },
    },
    window: {
      addEventListener: (name: string, callback: () => void) => { listeners.set(name, callback); },
      removeEventListener: (name: string) => { listeners.delete(name); },
    },
    ...queueClient,
    mergeQueuedFollowUps,
  };
  const methods = vm.runInNewContext(js + "; ({ queueCurrentMessage, persistQueuedFollowUps, installLifecycle })", context) as {
    queueCurrentMessage: (text: string, files: unknown[]) => void;
    persistQueuedFollowUps: (chatId: string | null, items: Item[], keepalive?: boolean) => void;
    installLifecycle: () => (() => void);
  };
  methods.installLifecycle();
  return {
    context, requests, errors, removed, ...methods,
    cleared: () => cleared,
    queue: () => queue,
    hide: () => {
      context.document.visibilityState = "hidden";
      assert.ok(listeners.get("visibilitychange"));
      listeners.get("visibilitychange")!();
    },
    recover: (event: string) => {
      context.document.visibilityState = "visible";
      assert.ok(listeners.get(event), `The actual effect must listen for ${event}`);
      listeners.get(event)!();
    },
    flushReact: () => {
      for (const update of deferred.splice(0)) queue = typeof update === "function" ? update(queue) : update;
      context.queuedMessages = queue;
      context.queuedState = { chatId: "chat", messages: queue };
    },
  };
}

test("queue click starts persistence before React evaluates a deferred state updater", () => {
  const f = fixture();
  f.queueCurrentMessage("Continue while I switch tabs", []);
  assert.equal(f.queue().length, 0, "The render is deliberately still deferred");
  assert.equal(f.requests.length, 1, "The click itself must hand off the queue to the server");
  assert.equal(f.requests[0].body.queuedMessages[0].text, "Continue while I switch tabs");
  assert.equal(f.context.stateRef.current.queuedMessages[0].text, "Continue while I switch tabs");
  f.flushReact();
  assert.equal(f.queue().length, 1);
  assert.equal(f.requests.length, 1, "Rendering must not perform a second network side effect");
});

test("two enqueues before a render persist both messages in order", () => {
  const f = fixture();
  f.queueCurrentMessage("First follow-up", []);
  f.queueCurrentMessage("Second follow-up", []);
  assert.equal(f.queue().length, 0);
  assert.deepEqual(
    f.requests.at(-1)?.body.queuedMessages.map(item => item.text),
    ["First follow-up", "Second follow-up"],
  );
  assert.equal(f.context.stateRef.current.queuedMessages.length, 2);
  f.flushReact();
  assert.deepEqual(Array.from(f.queue(), item => item.text), ["First follow-up", "Second follow-up"]);
});

test("an already-installed hide listener flushes the newest queue before a render", () => {
  const f = fixture();
  f.queueCurrentMessage("Do not wait for reload", []);
  const clicks = f.requests.length;
  f.hide();
  assert.ok(f.requests.length > clicks, "The hide event must flush the queue through the existing effect");
  assert.equal(f.requests.at(-1)?.body.queuedMessages[0].text, "Do not wait for reload");
  assert.equal(f.requests.at(-1)?.init.keepalive, true, "Lifecycle flush survives a page transition");
  assert.equal(f.queue().length, 0);
});

for (const ownerKey of ["chatId", "queueChatId"]) {
  test(`a newly rendered chat cannot enqueue from an outgoing ${ownerKey} snapshot`, () => {
    const f = fixture();
    const outgoing = [{ id: "outgoing", text: "Belongs to another chat", files: [] }];
    f.context.stateRef.current[ownerKey] = "outgoing-chat";
    f.context.stateRef.current.queuedMessages = outgoing;
    f.queueCurrentMessage("New chat follow-up", []);
    assert.equal(f.requests.length, 0);
    assert.equal(f.cleared(), 0, "Keep the composer while queue ownership changes");
    assert.equal(f.context.stateRef.current.queuedMessages, outgoing, "Do not mutate a snapshot owned by another chat");
    f.flushReact();
    assert.equal(f.queue().length, 0, "Do not mix outgoing queue entries into the rendered chat");
  });
}

test("re-queueing text after removal cannot reuse a stale removed item before rendering", () => {
  const f = fixture();
  f.context.stateRef.current.queuedMessages = [
    { id: "removed", text: "Queue this again", files: [] },
  ];
  f.removed.add("removed");
  f.queueCurrentMessage("Queue this again", []);
  assert.equal(f.requests.length, 1, "The removed item cannot suppress a new enqueue");
  assert.equal(f.requests[0].body.queuedMessages.length, 1);
  assert.notEqual(f.requests[0].body.queuedMessages[0].id, "removed");
  assert.equal(f.context.stateRef.current.queuedMessages.length, 1);
  assert.equal(f.cleared(), 1);
  f.flushReact();
  assert.equal(f.queue().length, 1);
  assert.notEqual(f.queue()[0].id, "removed");
});

for (const event of ["visibilitychange", "online", "focus", "pageshow"]) {
  test(`a transient failed save retries on ${event} without a reload or render`, async () => {
    const f = fixture(1);
    f.queueCurrentMessage("Retry after connection returns", []);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.requests.length, 1);
    assert.equal(f.errors.length, 1);
    assert.equal(f.context.stateRef.current.queuedMessages.length, 1);
    f.recover(event);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].body.queuedMessages[0].id, f.requests[0].body.queuedMessages[0].id);
    assert.equal(f.requests[1].body.queuedMessages[0].text, "Retry after connection returns");
    assert.equal(f.requests[1].init.keepalive, undefined, "Recovery uses an ordinary fetch");
    assert.equal(f.errors.length, 1, "The replay succeeds");
    assert.equal(f.queue().length, 0, "The test still has not rendered");
  });
}
