import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createChatModelSettingsQueue } from "../lib/chat-model-settings";

const source = ts.createSourceFile("app-shell.tsx", readFileSync("components/app-shell.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map<string, string>();
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
    ["loadChat", "persistActiveSnapshot", "refreshActiveChatFromServer"].includes(node.name.text) &&
    node.initializer && ts.isCallExpression(node.initializer)) {
    callbacks.set(node.name.text, node.initializer.arguments[0].getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
function callback(name: string, context: Record<string, unknown>) {
  assert.ok(callbacks.has(name), name);
  const js = ts.transpileModule("const callback = " + callbacks.get(name) + "; callback;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(js, {
    chatModelSettingsRef: { current: createChatModelSettingsQueue(async (_id, selection) => selection) },
    ...context,
  });
}

for (const mismatch of ["render", "queue", "loading"] as const) {
  test(`snapshot flush skips ${mismatch} state while navigation has changed chats`, () => {
    const calls: unknown[] = [];
    const state = {
      chatId: mismatch === "render" ? "outgoing" : "destination",
      queueChatId: mismatch === "queue" ? "outgoing" : "destination",
      loadingChatId: mismatch === "loading" ? "destination" : null,
    };
    const persist = callback("persistActiveSnapshot", {
      activeChatIdRef: { current: "destination" }, activeChatIncognito: false,
      stateRef: { current: state },
      chatCacheRef: { current: { set: (...args: unknown[]) => calls.push(args) } },
      fetch: (...args: unknown[]) => calls.push(args),
    });
    persist();
    assert.deepEqual(calls, [], "Neither cache nor server may receive mixed-chat state");
  });
}

test("an outgoing disk-cache read cannot resume loading over a newer chat selection", async () => {
  const reads = new Map<string, (snapshot: null) => void>();
  const activeChatIdRef = { current: "original" };
  const chatLoadRequestRef = { current: 0 };
  const selected: string[] = [];
  const context: Record<string, unknown> = {
    activeChatIdRef, chatLoadRequestRef, activeChatIncognito: false,
    window: {
      matchMedia: () => ({ matches: false }),
      setTimeout: () => 0,
    },
    isMobileChatViewport: () => false,
    persistActiveSnapshot: () => {},
    composerPersistChatRef: { current: "original" },
    composerDirtyUntilRef: { current: 0 },
    inputUpdatedAtRef: { current: "" },
    stickToBottomRef: { current: true },
    userDetachedFromBottomRef: { current: false },
    enteringChatRef: { current: false },
    chatLoadAbortRef: { current: null },
    chatCacheRef: { current: new Map() },
    chatCacheScope: "isolated-fixture",
    readClientChatSnapshot: (_scope: string, id: string) => new Promise<null>(resolve => reads.set(id, resolve)),
    clearUnread: () => {},
    navigateChat: () => {},
    AbortController,
    setActiveChatId: (id: string) => selected.push(id),
  };
  for (const match of callbacks.get("loadChat")!.matchAll(/\b(set[A-Z]\w*)\(/g)) {
    if (!(match[1] in context)) context[match[1]] = () => {};
  }
  const load = callback("loadChat", context) as (id: string) => Promise<boolean>;
  const outgoing = load("outgoing");
  const destination = load("destination");
  assert.equal(activeChatIdRef.current, "destination");
  reads.get("outgoing")!(null);
  assert.equal(await outgoing, false);
  assert.deepEqual(selected, ["outgoing", "destination"], "Navigation selects immediately; the old cache continuation must not select again");
  activeChatIdRef.current = "newest";
  chatLoadRequestRef.current++;
  reads.get("destination")!(null);
  assert.equal(await destination, false);
  assert.deepEqual(selected, ["outgoing", "destination"], "The destination cache continuation must not override the newest selection");
});

test("fresh ETag applies persisted queue and model even when activity and updatedAt are unchanged", async () => {
  const selected: string[] = [], queues: unknown[] = [], checks: boolean[] = [];
  const etags = { current: new Map([["chat", "old-etag"]]) };
  const context: Record<string, unknown> = {
    document: { visibilityState: "visible" },
    chatRefreshInFlightRef: { current: new Set() },
    chatRefreshEtagRef: etags,
    activeChatIdRef: { current: "chat" },
    CHAT_MESSAGE_LOAD_LIMIT: 10,
    fetchReadWithRetry: async () => ({
      status: 200, ok: true, headers: { get: () => "new-etag" },
      json: async () => ({ chat: { updatedAt: "unchanged", modelId: "saved-model", modelParams: [],
        messages: [], queuedMessages: [{ id: "saved-follow-up", text: "Durable queue" }] } }),
    }),
    stateRef: { current: { messages: [] } },
    chatProgramEventsChanged: () => false,
    acceptServerSnapshot: (_id: string, _version: string, skipUnchanged: boolean) => {
      checks.push(skipUnchanged); return !skipUnchanged;
    },
    runtimeRef: { current: new Map() }, modelParamsByModel: {},
    setModelId: (id: string) => selected.push(id),
    setModelParams: () => {},
    renderedActivityRef: { current: new Map() },
    mapApiMessages: (messages: unknown) => messages,
    mergeMessages: (_before: unknown, next: unknown) => next,
    applyServerQueuedMessagesRef: { current: (_id: string, queue: unknown) => queues.push(queue) },
    localStorage: { setItem: () => {} }, MODE_STORAGE_KEY: "mode", RUNTIME_MODE_STORAGE_KEY: "runtime",
    normalizeRuntimeMode: () => "default", workspacesFromChat: () => [],
    pendingQuestionIdRef: { current: null }, notifiedQuestionRef: { current: null },
  };
  for (const match of callbacks.get("refreshActiveChatFromServer")!.matchAll(/\b(set[A-Z]\w*)\(/g)) {
    if (!(match[1] in context)) context[match[1]] = () => {};
  }
  const refresh = callback("refreshActiveChatFromServer", context) as (id: string) => Promise<void>;
  await refresh("chat");
  assert.deepEqual(checks, [false], "Metadata revision must bypass the unchanged activity timestamp");
  assert.deepEqual(selected, ["saved-model"]);
  assert.deepEqual(JSON.parse(JSON.stringify(queues)), [[{ id: "saved-follow-up", text: "Durable queue" }]]);
  assert.equal(etags.current.get("chat"), "new-etag");
});
