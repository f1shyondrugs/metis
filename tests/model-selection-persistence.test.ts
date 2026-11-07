import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { parseModelKey as parseAccountModelKey } from "../lib/providers/types";
import { modelForSelection } from "../lib/model-selection";
import type { ProjectModelSelection } from "../lib/project-model";
import { modelParametersForModel, sanitizeModelParams } from "../lib/model-params";
import { createChatModelSettingsQueue } from "../lib/chat-model-settings";

const source = ts.createSourceFile("app-shell.tsx", readFileSync("components/app-shell.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Map<string, ts.FunctionDeclaration>();
const wanted = ["applyChatModelSelection", "saveChatModelSelection", "applyModelParams", "selectModel"];
let initialization: ts.IfStatement | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && wanted.includes(node.name.text)) handlers.set(node.name.text, node);
  if (ts.isIfStatement(node) && node.getText(source).startsWith("if (!chatModelSettingsRef.current)")) initialization = node;
  ts.forEachChild(node, visit);
}
visit(source);
for (const name of wanted) assert.ok(handlers.has(name), "Real handler missing: " + name);
assert.ok(initialization);
const js = ts.transpileModule([initialization.getText(source), ...wanted.map(name => handlers.get(name)!.getText(source))].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
type Params = ProjectModelSelection["modelParams"];
type ModelSelectionRequest = { version: number; chatId: string | null; chatVersion: number; pending: boolean; confirmed: ProjectModelSelection };
function fixture(chatId: string | null = "chat") {
  const calls: Array<{ url: string; body: ProjectModelSelection; resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
  const errors: string[] = [];
  const preferenceWrites: unknown[] = [];
  const storage = new Map<string, string>();
  const writtenSnapshots = new Map<string, ProjectModelSelection>();
  const initial = { modelId: "p/a", modelParams: [{ id: "effort", value: "low" }] };
  const context = {
    Error, modelForSelection, createChatModelSettingsQueue,
    projectModel: null as ProjectModelSelection | null, modelId: initial.modelId, modelParams: initial.modelParams as Params,
    modelParamsByModel: {} as Record<string, Params>, lastModelByProvider: {} as Record<string, string>,
    models: ["p/b", "p/c"].map(id => ({ id, defaultParams: [{ id: "effort", value: "high" }] })),
    activeChatIdRef: { current: chatId }, chatLoadRequestRef: { current: 1 }, loadingChatId: null as string | null,
    modelSelectionRequestRef: { current: null as ModelSelectionRequest | null },
    chatModelSettingsRef: { current: null as ReturnType<typeof createChatModelSettingsQueue> | null },
    stateRef: { current: { chatId, ...initial } },
    chatCacheRef: { current: new Map<string, ProjectModelSelection & { incognito?: boolean }>(chatId ? [[chatId, { ...initial, incognito: false }]] : []) },
    chatCacheScope: "fixture-account",
    writeClientChatSnapshot: (_scope: string, id: string, snapshot: ProjectModelSelection) => { writtenSnapshots.set(id, structuredClone(snapshot)); return Promise.resolve(); },
    parseModelKey: (id: string) => ({ providerKey: id.split("/")[0] }),
    MODEL_STORAGE_KEY: "model", PARAMS_STORAGE_KEY: "params",
    localStorage: { setItem: (key: string, value: string) => storage.set(key, value) },
    setModelId: (id: string) => { context.modelId = id; },
    setModelParams: (params: Params) => { context.modelParams = params; },
    setAgentId: (_id: string | undefined) => {},
    setModelParamsByModel: (map: Record<string, Params>) => { context.modelParamsByModel = map; },
    setLastModelByProvider: (map: Record<string, string>) => { context.lastModelByProvider = map; },
    persistModelParamsByModel: (map: Record<string, Params>) => { context.modelParamsByModel = map; },
    toast: { error: (message: string) => errors.push(message) },
    fetch: (url: string, init: { body: string }) => {
      if (url === "/api/preferences") { preferenceWrites.push(JSON.parse(init.body)); return Promise.resolve(Response.json({})); }
      return new Promise<Response>((resolve, reject) => calls.push({ url, body: JSON.parse(init.body) as ProjectModelSelection, resolve, reject }));
    },
  };
  const functions = vm.runInNewContext(js + "; ({ selectModel, applyModelParams, saveChatModelSelection })", context) as {
    selectModel: (id: string) => Promise<void>;
    applyModelParams: (params: Params) => void;
    saveChatModelSelection: (id: string, next: ProjectModelSelection, baseline: ProjectModelSelection) => Promise<void>;
  };
  const switchTo = (id: string, selection: ProjectModelSelection) => {
    context.activeChatIdRef.current = id; context.chatLoadRequestRef.current++;
    context.modelId = selection.modelId; context.modelParams = selection.modelParams;
    context.stateRef.current = { chatId: id, ...selection };
    if (!context.chatCacheRef.current.has(id)) context.chatCacheRef.current.set(id, selection);
  };
  const flush = async () => {
    for (let attempt = 0; attempt < 20 && context.chatModelSettingsRef.current?.pending(context.activeChatIdRef.current || ""); attempt++) await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  };
  return { context, select: functions.selectModel, applyParams: functions.applyModelParams, save: functions.saveChatModelSelection, calls, errors, storage, preferenceWrites, writtenSnapshots, switchTo, flush };
}
const success = (modelId: string, modelParams: Params = []) => Response.json({ chat: { modelId, modelParams } });

test("failed HTTP and network restore the confirmed chat model and params without changing account defaults", async () => {
  for (const failure of ["http", "network"]) {
    const f = fixture();
    const before = f.context.modelParams;
    const pending = f.select("p/b");
    assert.equal(f.context.modelId, "p/b");
    if (failure === "http") f.calls[0].resolve(Response.json({ error: "denied" }, { status: 500 }));
    else f.calls[0].reject(new Error("Network unavailable"));
    await pending;
    assert.equal(f.context.modelId, "p/a"); assert.deepEqual(f.context.modelParams, before);
    assert.deepEqual(JSON.parse(JSON.stringify(f.context.chatCacheRef.current.get("chat")?.modelParams)), before);
    assert.equal(f.storage.size, 0); assert.equal(f.preferenceWrites.length, 0); assert.equal(f.errors.length, 1);
  }
});

test("successful chat PATCH applies canonical model and params, then becomes rollback baseline", async () => {
  const f = fixture();
  const canonical = [{ id: "effort", value: "canonical" }];
  const first = f.select("p/b"); f.calls[0].resolve(success("p/canonical", canonical)); await first;
  assert.equal(f.context.modelId, "p/canonical"); assert.deepEqual(f.context.modelParams, canonical);
  assert.deepEqual(f.writtenSnapshots.get("chat")?.modelParams, canonical);
  assert.deepEqual(f.context.lastModelByProvider, {}); assert.equal(f.storage.size, 0);
  const second = f.select("p/c"); f.calls[1].reject(new Error("offline")); await second;
  assert.equal(f.context.modelId, "p/canonical"); assert.deepEqual(f.context.modelParams, canonical);
});

test("rapid A to B to C serializes server writes and ignores obsolete successes and failures", async () => {
  for (const obsoleteFailure of [false, true]) {
    const f = fixture();
    const b = f.select("p/b"); const c = f.select("p/c");
    assert.equal(f.context.modelId, "p/c"); assert.equal(f.calls.length, 1, "C waits for B persistence");
    if (obsoleteFailure) f.calls[0].reject(new Error("obsolete failure"));
    else f.calls[0].resolve(success("p/b"));
    await b; await Promise.resolve();
    assert.equal(f.context.modelId, "p/c"); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].body.modelId, "p/c");
    f.calls[1].resolve(success("p/c")); await c;
    assert.equal(f.context.modelId, "p/c"); assert.equal(f.errors.length, 0);
    assert.equal(f.context.chatCacheRef.current.get("chat")?.modelId, "p/c");
  }
});

test("overlapping failures roll back to A, while a completed B is the rollback baseline for failed C", async () => {
  for (const bSucceeded of [false, true]) {
    const f = fixture(); const b = f.select("p/b"); const c = f.select("p/c");
    if (bSucceeded) f.calls[0].resolve(success("p/b")); else f.calls[0].reject(new Error("B failed"));
    await b; await Promise.resolve();
    f.calls[1].reject(new Error("C failed")); await c;
    assert.equal(f.context.modelId, bSucceeded ? "p/b" : "p/a"); assert.equal(f.errors.length, 1);
  }
});

test("late chat saves update the originating cache and never overwrite a different chat", async () => {
  for (const returnToChat of [false, true]) {
    for (const fail of [false, true]) {
      const f = fixture(); const pending = f.select("p/b");
      f.switchTo(returnToChat ? "chat" : "other", { modelId: "p/other", modelParams: [{ id: "effort", value: "other" }] });
      if (fail) f.calls[0].reject(new Error("old chat failure")); else f.calls[0].resolve(success("p/b"));
      await pending;
      assert.equal(f.context.modelId, returnToChat ? fail ? "p/a" : "p/b" : "p/other");
      assert.equal(f.context.chatCacheRef.current.get("chat")?.modelId, fail ? "p/a" : "p/b");
      assert.equal(f.calls[0].url, "/api/chats/chat"); assert.equal(f.preferenceWrites.length, 0);
    }
  }
});

test("chat switch while response JSON is pending cannot overwrite the new chat selection", async () => {
  const f = fixture(); let finish!: (data: unknown) => void; let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const pending = f.select("p/b");
  f.calls[0].resolve({ ok: true, json: () => new Promise(resolve => { finish = resolve; started(); }) } as Response);
  await reading;
  f.switchTo("other", { modelId: "p/other", modelParams: [] });
  finish({ chat: { modelId: "p/b", modelParams: [] } }); await pending;
  assert.equal(f.context.modelId, "p/other"); assert.equal(f.context.chatCacheRef.current.get("chat")?.modelId, "p/b");
});

test("active parameter changes save the entire chat selection and never borrow account model presets", async () => {
  const f = fixture();
  f.context.modelParamsByModel = { "p/a": [{ id: "effort", value: "unrelated-account" }] };
  const params = [{ id: "effort", value: "chat-specific" }, { id: "context", value: "fixture-context" }, { id: "fast", value: "fixture-speed" }];
  f.applyParams(params);
  assert.deepEqual(f.calls[0].body, { modelId: "p/a", modelParams: params });
  f.calls[0].resolve(success("p/a", params)); await f.flush();
  assert.deepEqual(f.context.modelParams, params);
  assert.deepEqual(f.context.modelParamsByModel["p/a"], [{ id: "effort", value: "unrelated-account" }]);
  assert.equal(f.storage.size, 0); assert.equal(f.preferenceWrites.length, 0);
  const change = f.select("p/b");
  assert.deepEqual(f.calls[1].body.modelParams, f.context.models[0].defaultParams);
  f.calls[1].resolve(success("p/b", f.context.models[0].defaultParams)); await change;
});

test("loading and project locks reject changes while drafts retain their own remembered defaults", async () => {
  const f = fixture(); f.context.loadingChatId = "other"; await f.select("p/b"); f.applyParams([]);
  assert.equal(f.calls.length, 0); assert.equal(f.context.modelId, "p/a");
  f.context.loadingChatId = null; f.context.projectModel = { modelId: "p/a", modelParams: [] };
  await f.select("p/b"); f.applyParams([]); assert.equal(f.calls.length, 0);
  const draft = fixture(null); await draft.select("p/b");
  assert.equal(draft.calls.length, 0); assert.equal(draft.context.modelId, "p/b"); assert.equal(draft.storage.get("model"), "p/b");
  draft.context.projectModel = { modelId: "p/b", modelParams: draft.context.modelParams }; await draft.select("p/c");
  assert.equal(draft.context.modelId, "p/b");
});

test("new-chat selection remembers the same model separately for each provider account", async () => {
  const f = fixture(null); f.context.parseModelKey = parseAccountModelKey;
  await f.select("codex:personal:shared-model"); await f.select("codex:work:shared-model");
  assert.equal(f.context.lastModelByProvider["codex:personal"], "codex:personal:shared-model");
  assert.equal(f.context.lastModelByProvider["codex:work"], "codex:work:shared-model");
  assert.equal(f.context.modelId, "codex:work:shared-model"); assert.equal(f.storage.get("model"), "codex:work:shared-model");
});

test("legacy keys recover the active accounts advertised reasoning contract without changing identity", () => {
  const a = { id: "codex:personal:shared", parameters: [{ id: "effort", values: [{ value: "personal-effort" }] }] };
  const b = { id: "codex:work:shared", legacyIds: ["codex:shared"], parameters: [{ id: "effort", values: [{ value: "work-effort" }] }] };
  const models = [a, b]; const legacy = modelForSelection(models, "codex:shared");
  assert.equal(legacy, b); assert.equal(modelForSelection([...models].reverse(), "codex:shared"), b);
  assert.deepEqual(modelParametersForModel(legacy!), b.parameters.map(p => ({ ...p, displayName: "Reasoning" })));
  assert.deepEqual(sanitizeModelParams(legacy!, [{ id: "effort", value: "work-effort" }, { id: "effort", value: "personal-effort" }]), [{ id: "effort", value: "work-effort" }]);
  assert.equal(modelForSelection(models, a.id), a); assert.equal(modelForSelection(models, "codex:removed:shared"), undefined);
  assert.equal(modelForSelection(models, "openai:shared"), undefined);
});

test("metadata aliases stay explicit, unique and preserve opaque provider-native IDs", () => {
  const model = { id: "ollama:local:fixture:tag", legacyIds: ["ollama:fixture:tag"] };
  assert.equal(modelForSelection([model], "ollama:fixture:tag"), model);
  assert.equal(modelForSelection([{ id: "fixture:scoped", legacyIds: ["raw-model"] }], "raw-model")?.id, "fixture:scoped");
  assert.equal(modelForSelection([{ id: "codex:work:shared" }], "codex:shared"), undefined);
  assert.equal(modelForSelection([{ id: "a", legacyIds: ["legacy"] }, { id: "b", legacyIds: ["legacy"] }], "legacy"), undefined);
  const exact = { id: "legacy" };
  assert.equal(modelForSelection([model, { id: "b", legacyIds: ["legacy"] }, exact], "legacy"), exact);
  assert.equal(modelForSelection([model], ""), undefined); assert.equal(modelForSelection([model], undefined), undefined);
});

test("the real draft selection callback loads defaults through a legacy alias and preserves its saved key", async () => {
  const f = fixture(null);
  const meta = { id: "cursor:account:legacy", legacyIds: ["legacy"], defaultParams: [{ id: "effort", value: "live-advertised" }] };
  f.context.models = [meta]; await f.select("legacy");
  assert.equal(f.context.modelId, "legacy"); assert.deepEqual(f.context.modelParams, meta.defaultParams);
  assert.equal(f.storage.get("model"), "legacy");
});
