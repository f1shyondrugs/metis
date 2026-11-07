import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createChatModelSettingsQueue } from "../lib/chat-model-settings";
import { readClientChatSnapshot, writeClientChatSnapshot } from "../lib/client-chat-cache";
import { mergeQueuedFollowUps } from "../lib/composer-send";
import { removeQueuedFollowUp, saveQueuedFollowUps } from "../lib/queue-client";

const source = ts.createSourceFile("app-shell.tsx", readFileSync("components/app-shell.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks: string[] = [];
const setters = new Set<string>();
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ["loadChat", "applySnapshot"].includes(node.name.getText(source)) && node.initializer && ts.isCallExpression(node.initializer)) {
    callbacks.push(`const ${node.name.getText(source)} = ${node.initializer.arguments[0].getText(source)};`);
  }
  if (ts.isFunctionDeclaration(node) && ["applyServerQueuedMessages", "persistQueuedFollowUps", "removeMessageFromQueue"].includes(node.name?.text ?? "")) callbacks.push(node.getText(source));
  if (ts.isIdentifier(node) && /^set[A-Z]/.test(node.text)) setters.add(node.text);
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(callbacks.length, 5);
const js = ts.transpileModule(callbacks.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const queued = (id: string) => ({ id, text: id, files: [] });
const snap = (queue = [queued("stale")]) => ({
  messages: [{ id: "history", role: "assistant" }], queuedMessages: queue,
  incognito: false, modelId: "", modelParams: [], workspaces: [],
  sessionState: {}, browserContext: {}, messageOffset: 0, hasEarlierMessages: false,
});

function fixture() {
  const state = { active: "old", queue: { chatId: "old" as string | null, messages: [queued("old")] }, loading: null as string | null };
  const saved: any[] = [];
  const removed = new Map<string, Set<string>>();
  const c: any = Object.fromEntries([...setters].map(name => [name, () => {}]));
  Object.assign(c, {
    window: { matchMedia: () => ({ matches: false }), setTimeout },
    MODE_STORAGE_KEY: "mode", RUNTIME_MODE_STORAGE_KEY: "runtime", MODEL_STORAGE_KEY: "model",
    AbortController, DOMException, localStorage: { getItem: () => null, setItem: () => {} },
    activeChatIncognito: false, activeChatIdRef: { current: "old" },
    composerPersistChatRef: { current: "old" }, composerDirtyUntilRef: { current: 0 }, inputUpdatedAtRef: { current: "" },
    chatLoadAbortRef: { current: null }, chatLoadRequestRef: { current: 0 },
    stickToBottomRef: {}, userDetachedFromBottomRef: {}, enteringChatRef: {},
    loadedChatIdsRef: { current: new Set() }, renderedActivityRef: { current: new Map() }, seenChatUpdatedAtRef: { current: new Map() },
    browserInputDirtyRef: {}, runtimeRef: { current: new Map() }, pendingQuestionIdRef: { current: null },
    removedQueueIdsRef: { current: removed }, queuedSendRef: { current: new Set() },
    stateRef: { current: { chatId: "old", queueChatId: "old", messages: [], loadingChatId: null } },
    removedIdsFor: (id: string) => { if (!removed.has(id)) removed.set(id, new Set()); return removed.get(id); },
    mergeQueuedFollowUps, saveQueuedFollowUps, removeQueuedFollowUp: (options: Parameters<typeof removeQueuedFollowUp>[0]) => removeQueuedFollowUp({ ...options, request: c.fetch }), toast: { error: (message: string) => { throw new Error(message); } },
    deleteClientChatSnapshot: async () => {},
    acceptServerSnapshot: () => true, clearUnread: () => {},
    normalizeBrowserContext: () => ({ tabs: [], activeTabId: "" }), normalizeRuntimeMode: () => "agent",
    normalizeWorkspaceTab: () => "files", workspaceOpenFromSession: () => false,
    normalizeTerminalTabs: () => [{ id: "terminal", cwd: "/workspace" }], normalizeWorkDirectory: () => "/workspace",
    restoreQuestionDraft: () => ({ answers: [], custom: [], customActive: [] }), modelParamsByModel: {}, workspaceDefaultCwd: "/workspace",
    chatCacheRef: { current: new Map() }, chatCacheScope: "account",
    chatModelSettingsRef: { current: createChatModelSettingsQueue(async (_chatId, selection) => selection) },
    readClientChatSnapshot: async () => null, writeClientChatSnapshot: async () => {},
    fetchReadWithRetry: () => new Promise(() => {}), CHAT_MESSAGE_LOAD_LIMIT: 30,
    isMobileChatViewport: () => false, navigateChat: () => {}, persistActiveSnapshot: () => {},
    fetch: async (url: string, options: any) => { saved.push({ url, body: JSON.parse(options.body) }); return Response.json({}); },
    setActiveChatId: (id: string) => { state.active = id; c.stateRef.current.chatId = id; },
    setQueuedState: (update: any) => {
      state.queue = typeof update === "function" ? update(state.queue) : update;
      c.stateRef.current.queueChatId = state.queue.chatId;
    },
    setLoadingChatId: (id: string | null) => { state.loading = id; c.stateRef.current.loadingChatId = id; },
    setMessages: (messages: any) => { if (Array.isArray(messages)) c.stateRef.current.messages = messages; },
  });
  const methods = vm.runInNewContext(js + "; ({loadChat, applySnapshot, applyServerQueuedMessages, persistQueuedFollowUps, removeMessageFromQueue})", c);
  return { c, state, saved, ...methods };
}

test("navigation clears the outgoing queue before awaiting IndexedDB", async () => {
  const f = fixture();
  let resolve!: (value: unknown) => void;
  f.c.readClientChatSnapshot = () => new Promise(yes => { resolve = yes; });
  const loading = f.loadChat("target");
  assert.equal(f.state.active, "target");
  assert.equal(f.state.loading, "target");
  assert.equal(f.state.queue.messages.length, 0);
  f.persistQueuedFollowUps("target", [queued("old")]);
  assert.equal(f.saved.length, 0);
  resolve(snap());
  assert.equal(await loading, true);
  assert.equal(f.state.queue.chatId, null);
  assert.equal(f.state.queue.messages.length, 0);
});

test("a cached queue cannot render, autosave or survive an empty server queue", () => {
  const f = fixture();
  f.applySnapshot("target", snap(), "cache");
  assert.equal(f.state.queue.chatId, null);
  assert.equal(f.state.queue.messages.length, 0);
  f.persistQueuedFollowUps("target", [queued("stale")]);
  assert.equal(f.saved.length, 0);
  f.applyServerQueuedMessages("target", []);
  assert.equal(f.state.queue.chatId, "target");
  assert.equal(f.state.queue.messages.length, 0);
});

test("server hydration restores only the destination queue and its attachments", () => {
  const f = fixture();
  f.applySnapshot("target", snap(), "cache");
  const attachment = { id: "image" };
  f.applyServerQueuedMessages("old", [queued("foreign")]);
  assert.equal(f.state.queue.chatId, null);
  f.applyServerQueuedMessages("target", [{ ...queued("real"), attachments: [attachment] }]);
  assert.equal(f.state.queue.messages.length, 1);
  assert.equal(f.state.queue.messages[0].id, "real");
  assert.equal(f.state.queue.messages[0].storedAttachments[0], attachment);
  f.persistQueuedFollowUps("target", f.state.queue.messages);
  assert.equal(f.saved[0].url, "/api/chats/target");
  assert.equal(f.saved[0].body.queuedMessages[0].id, "real");
});

test("already consumed messages are filtered when a server snapshot is restored", () => {
  const f = fixture();
  const snapshot = snap([queued("consumed"), queued("pending")]);
  snapshot.messages = [{ id: "consumed", role: "user" }];
  f.applySnapshot("target", snapshot, "server");
  assert.deepEqual(Array.from(f.state.queue.messages, (item: any) => item.id), ["pending"]);
});

test("a late IndexedDB result cannot restore an outgoing chat after a second navigation", async () => {
  const f = fixture();
  const resolves: Record<string, (value: unknown) => void> = {};
  f.c.readClientChatSnapshot = (_scope: string, id: string) => new Promise(yes => { resolves[id] = yes; });
  const first = f.loadChat("first"), second = f.loadChat("second");
  resolves.first(snap([queued("first-stale")]));
  assert.equal(await first, false);
  resolves.second(snap([queued("second-stale")]));
  assert.equal(await second, true);
  assert.equal(f.state.active, "second");
  assert.equal(f.state.queue.messages.length, 0);
});

test("removing a hydrated item works when its cached history has no queue field", async () => {
  const f = fixture(), item = queued("remove");
  f.applySnapshot("target", snap(), "cache");
  f.applyServerQueuedMessages("target", [item]);
  f.c.activeChatId = "target"; f.c.loadingChatId = null;
  f.c.queuedState = f.state.queue; f.c.queuedMessages = f.state.queue.messages;
  f.c.setQueuedMessages = (update: any) => { f.state.queue.messages = update(f.state.queue.messages); };
  f.c.chatCacheRef.current.set("target", { messages: [] });
  f.c.fetch = async (url: string, options: RequestInit) => {
    f.saved.push({ url, method: options.method }); return Response.json({});
  };
  assert.equal(await f.removeMessageFromQueue(item), true);
  assert.equal(f.state.queue.messages.length, 0);
  assert.equal(f.saved[0].method, "DELETE");
  assert.equal(f.saved[0].url, "/api/chats/target/queue/remove");
});

test("IndexedDB reads discard legacy queue data and new writes omit it without mutating the input", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const value = { ...snap(), removedQueuedMessageIds: ["removed"] };
  let row: any = { cachedAt: Date.now(), value };
  const request = (result: unknown) => {
    const req: any = { result };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };
  const db = {
    objectStoreNames: { contains: () => true }, close() {},
    transaction: () => {
      const tx: any = { objectStore: () => ({
        get: () => request(row), count: () => request(1),
        put: (next: any) => { row = next; queueMicrotask(() => tx.oncomplete?.()); },
      }) };
      return tx;
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { indexedDB: { open: () => request(db) } } });
  try {
    const loaded = await readClientChatSnapshot<any>("account", "target");
    assert.equal(loaded.queuedMessages, undefined);
    assert.equal(loaded.removedQueuedMessageIds, undefined);
    assert.equal(loaded.messages[0].id, "history");
    await writeClientChatSnapshot("account", "target", value);
    assert.equal(row.value.queuedMessages, undefined);
    assert.equal(row.value.removedQueuedMessageIds, undefined);
    assert.equal(value.queuedMessages.length, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
