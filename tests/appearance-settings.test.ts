import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAX_APPEARANCE_STATE_BYTES,
  createCustomTheme,
  createDefaultAppearanceState,
  type AppearanceState,
} from "../lib/appearance-storage";

const directory = mkdtempSync(path.join(os.tmpdir(), "metis-account-appearance-"));
const databasePath = path.join(directory, "chat.sqlite");
const repository = fileURLToPath(new URL("..", import.meta.url));
Object.assign(process.env, {
  CHAT_DATA_DIR: directory,
  CHAT_DB_PATH: databasePath,
  AI_CHAT_ROOT: directory,
  AGENT_CWD: directory,
});
delete process.env.CHAT_LEGACY_HEADER_AUTH;
const modules = Promise.all([
  import("../lib/sqlite"),
  import("../lib/appearance-settings"),
  import("../app/api/appearance/route"),
]);
test.after(() => rmSync(directory, { recursive: true, force: true }));

type Account = { id: string; token: string };

async function account(expired = false): Promise<Account> {
  const [{ getDatabase, databasePath: actualPath }] = await modules;
  assert.equal(actualPath, databasePath, "Every account test must use its isolated database.");
  const db = getDatabase();
  const id = randomUUID(), token = randomUUID();
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "appearance-" + id, "unused-fixture-hash", new Date().toISOString());
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(createHash("sha256").update(token).digest("hex"), id, expired ? "2000-01-01T00:00:00Z" : "2099-01-01T00:00:00Z");
  return { id, token };
}

function request(owner?: Account, body?: unknown, url = "http://test/api/appearance"): Request {
  return new Request(url, {
    method: body === undefined ? "GET" : "PATCH",
    headers: { "content-type": "application/json", ...(owner ? { cookie: "ai_chat_auth=" + owner.token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function change(owner: Account, state: AppearanceState, revision: number, extra: Record<string, unknown> = {}) {
  return request(owner, { ownerId: owner.id, state, revision, ...extra });
}

function custom(name = "Account theme"): AppearanceState {
  return createCustomTheme(createDefaultAppearanceState(), {
    format: "metis-theme", version: 1, name, mode: "light",
    variables: { "--background": "#eeeeee", "--account-extra": "2rem", "--radius": "calc(1rem + 2px)" },
  }, "custom-" + randomUUID());
}

function noStore(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}

function childSource(body: string) {
  return 'const {getAppearanceSettings, saveAppearanceSettings} = require("./lib/appearance-settings.ts");\n' + body;
}

async function runChild(source: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "-e", source], {
      cwd: repository,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error("Isolated appearance process failed: " + stderr));
      else {
        try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      }
    });
  });
}

test("GET and PATCH require a live authenticated session and never cache responses", async () => {
  const [, , api] = await modules;
  const expired = await account(true);
  for (const owner of [undefined, expired, { id: randomUUID(), token: "invalid-token" }]) {
    const get = await api.GET(request(owner));
    assert.equal(get.status, 401);
    noStore(get);
    const patch = await api.PATCH(request(owner, { ownerId: owner?.id, state: createDefaultAppearanceState(), revision: 0 }));
    assert.equal(patch.status, 401);
    noStore(patch);
  }
});

test("stored Metis account selection migrates on read without losing custom themes or revision", async () => {
  const [{getDatabase},store,api] = await modules;
  const owner = await account(),state = {...custom(),selected:"metis"};
  const raw = JSON.stringify({version:1,revision:4,state});
  getDatabase().prepare("INSERT INTO settings (key,owner_id,data) VALUES (?,?,?)").run("appearance:"+owner.id,owner.id,raw);
  const response = await api.GET(request(owner));
  assert.equal(response.status,200);
  const migrated = {...state,selected:"midnight"};
  assert.deepEqual(await response.json(),{ownerId:owner.id,state:migrated,revision:4});
  assert.equal((getDatabase().prepare("SELECT data FROM settings WHERE key=?").get("appearance:"+owner.id) as {data:string}).data,raw);
  const saved = await api.PATCH(change(owner,migrated,4));
  assert.equal(saved.status,200);
  assert.deepEqual(store.getAppearanceSettings(owner.id),{ownerId:owner.id,state:migrated,revision:5});
});

test("absent settings permit one migration; canonical state persists independently per account", async () => {
  const [, store, api] = await modules;
  const owner = await account(), other = await account();
  const initial = await api.GET(request(owner));
  noStore(initial);
  assert.deepEqual(await initial.json(), { ownerId: owner.id, state: null, revision: 0 });
  const state = custom();
  const saved = await api.PATCH(change(owner, state, 0));
  assert.equal(saved.status, 200);
  noStore(saved);
  assert.deepEqual(await saved.json(), { ownerId: owner.id, state, revision: 1 });
  assert.deepEqual(store.getAppearanceSettings(other.id), { ownerId: other.id, state: null, revision: 0 });
  const otherState = { ...createDefaultAppearanceState(), selected: "graphite" };
  assert.equal((await api.PATCH(change(other, otherState, 0))).status, 200);
  const ownerGet = await api.GET(request(owner, undefined, "http://test/api/appearance?ownerId=" + other.id));
  assert.deepEqual(await ownerGet.json(), { ownerId: owner.id, state, revision: 1 });
  assert.deepEqual(store.getAppearanceSettings(other.id), { ownerId: other.id, state: otherState, revision: 1 });

  const restarted = spawnSync(process.execPath, ["--import", "tsx", "-e", childSource(
    "process.stdout.write(JSON.stringify([getAppearanceSettings(" + JSON.stringify(owner.id) + "),getAppearanceSettings(" + JSON.stringify(other.id) + ")]));",
  )], { cwd: repository, env: process.env, encoding: "utf8", timeout: 20_000 });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout), [
    { ownerId: owner.id, state, revision: 1 },
    { ownerId: other.id, state: otherState, revision: 1 },
  ]);
});

test("a stale account request cannot overwrite a newly authenticated account at a matching revision", async () => {
  const [, store, api] = await modules;
  const owner = await account(), switched = await account();
  const oldState = custom("Old account"), switchedState = custom("New account");
  assert.equal((await api.PATCH(change(owner, oldState, 0))).status, 200);
  assert.equal((await api.PATCH(change(switched, switchedState, 0))).status, 200);
  const stale = await api.PATCH(change(switched, custom("Must never save"), 1, { ownerId: owner.id }));
  assert.equal(stale.status, 409);
  noStore(stale);
  const conflict = await stale.json();
  assert.match(conflict.error, /Account changed/);
  assert.equal(conflict.ownerId, switched.id);
  assert.equal(conflict.revision, 1);
  assert.deepEqual(conflict.state, switchedState);
  assert.deepEqual(store.getAppearanceSettings(owner.id), { ownerId: owner.id, state: oldState, revision: 1 });
  assert.deepEqual(store.getAppearanceSettings(switched.id), { ownerId: switched.id, state: switchedState, revision: 1 });
  const missing = await api.PATCH(request(switched, { state: custom(), revision: 1 }));
  assert.equal(missing.status, 400);
  noStore(missing);
});

test("simultaneous first migrations and later stale PATCHes return the latest state without lost updates", async () => {
  const [, store, api] = await modules;
  const owner = await account();
  const states = [custom("Migration A"), custom("Migration B")];
  const responses = await Promise.all(states.map((state) => api.PATCH(change(owner, state, 0))));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  responses.forEach(noStore);
  const winner = store.getAppearanceSettings(owner.id);
  assert.equal(winner.revision, 1);
  const loser = await responses.find((response) => response.status === 409)!.json();
  assert.deepEqual({ ownerId: loser.ownerId, state: loser.state, revision: loser.revision }, winner);
  const next = custom("Latest edit");
  assert.equal((await api.PATCH(change(owner, next, 1))).status, 200);
  const stale = await api.PATCH(change(owner, states[0], 1));
  assert.equal(stale.status, 409);
  assert.deepEqual((await stale.json()).state, next);
  assert.deepEqual(store.getAppearanceSettings(owner.id), { ownerId: owner.id, state: next, revision: 2 });
});

test("the first-write compare and save remains atomic across separate processes", async () => {
  const [, store] = await modules;
  const owner = await account();
  const results = await Promise.all([custom("Process A"), custom("Process B")].map((state) => runChild(childSource(
    "process.stdout.write(JSON.stringify(saveAppearanceSettings(" + JSON.stringify(owner.id) + "," + JSON.stringify(state) + ",0)));",
  )))) as Array<{ ok: boolean; record: { revision: number; state: AppearanceState } }>;
  assert.deepEqual(results.map((result) => result.ok).sort(), [false, true]);
  assert.equal(results[0].record.revision, 1);
  assert.equal(results[1].record.revision, 1);
  assert.deepEqual(results[0].record.state, results[1].record.state);
  assert.equal(store.getAppearanceSettings(owner.id).revision, 1);
});

test("malformed states, revisions, CSS and duplicate IDs are rejected without changing stored state", async () => {
  const [, store, api] = await modules;
  const owner = await account();
  const state = custom();
  assert.equal((await api.PATCH(change(owner, state, 0))).status, 200);
  const invalidStates: unknown[] = [
    null, [], {}, { ...state, version: 2 }, { ...state, selected: "missing" },
    { ...state, customThemes: [state.customThemes[0], state.customThemes[0]] },
    { ...state, customThemes: [{ ...state.customThemes[0], id: "__proto__" }] },
    { ...state, customThemes: [{ id: "custom-bad", theme: { ...state.customThemes[0].theme, mode: "system" } }] },
    { ...state, customThemes: [{ id: "custom-bad", theme: { ...state.customThemes[0].theme, variables: { "--x": "url(https://example.com)" } } }] },
    JSON.parse('{"version":1,"selected":"midnight","customThemes":[],"__proto__":{}}'),
  ];
  for (const invalid of invalidStates) {
    const response = await api.PATCH(request(owner, { ownerId: owner.id, state: invalid, revision: 1 }));
    assert.equal(response.status, 400);
    noStore(response);
  }
  for (const revision of [null, "1", -1, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
    const response = await api.PATCH(request(owner, { ownerId: owner.id, state, revision }));
    assert.equal(response.status, 400);
    noStore(response);
  }
  for (const body of ["{", "null", "[]", ""]) {
    const response = await api.PATCH(new Request("http://test/api/appearance", {
      method: "PATCH", headers: { cookie: "ai_chat_auth=" + owner.token }, body,
    }));
    assert.equal(response.status, 400);
    noStore(response);
  }
  assert.deepEqual(store.getAppearanceSettings(owner.id), { ownerId: owner.id, state, revision: 1 });
});

test("request limits enforce declared and streamed byte sizes and cancel oversized streams", async () => {
  const [, store, api] = await modules;
  const owner = await account();
  const max = MAX_APPEARANCE_STATE_BYTES + 1024;
  const declared = await api.PATCH(new Request("http://test/api/appearance", {
    method: "PATCH", headers: { cookie: "ai_chat_auth=" + owner.token, "content-length": String(max + 1) }, body: "{}",
  }));
  assert.equal(declared.status, 413);
  noStore(declared);
  let canceled = false, pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(64 * 1024)); },
    cancel() { canceled = true; },
  });
  const streamed = await api.PATCH(new Request("http://test/api/appearance", {
    method: "PATCH", headers: { cookie: "ai_chat_auth=" + owner.token }, body: stream, duplex: "half",
  } as RequestInit));
  assert.equal(streamed.status, 413);
  noStore(streamed);
  assert.equal(canceled, true);
  assert.ok(pulls < 20);
  const utf8 = await api.PATCH(new Request("http://test/api/appearance", {
    method: "PATCH", headers: { cookie: "ai_chat_auth=" + owner.token }, body: new Uint8Array([0xff]),
  }));
  assert.equal(utf8.status, 400);
  noStore(utf8);
  assert.deepEqual(store.getAppearanceSettings(owner.id), { ownerId: owner.id, state: null, revision: 0 });
});

test("individual-theme and total-state bounds are enforced before a database write", async () => {
  const [, store, api] = await modules;
  const owner = await account();
  const state = custom();
  const largeVariables = Object.fromEntries(Array.from({ length: 80 }, (_, index) => ["--large-" + index, "x".repeat(3500)]));
  const tooLargeTheme = {
    ...state,
    customThemes: [{ ...state.customThemes[0], theme: { ...state.customThemes[0].theme, variables: largeVariables } }],
  };
  const response = await api.PATCH(request(owner, { ownerId: owner.id, state: tooLargeTheme, revision: 0 }));
  assert.equal(response.status, 400);
  noStore(response);
  assert.throws(() => store.saveAppearanceSettings(owner.id, tooLargeTheme, 0), /256 KiB/);
  const variables = Object.fromEntries(Array.from({ length: 45 }, (_, index) => ["--large-" + index, "x".repeat(3950)]));
  const tooLargeState = {
    version: 1,
    selected: "midnight",
    customThemes: [1, 2, 3].map((number) => ({
      id: "custom-total-" + number,
      theme: { ...state.customThemes[0].theme, variables },
    })),
  };
  assert.throws(() => store.saveAppearanceSettings(owner.id, tooLargeState, 0), /512 KiB/);
  assert.deepEqual(store.getAppearanceSettings(owner.id), { ownerId: owner.id, state: null, revision: 0 });
});

test("SQL ownership checks prevent reading or replacing a foreign-owned key", async () => {
  const [{ getDatabase }, store] = await modules;
  const owner = await account(), other = await account();
  const data = JSON.stringify({ version: 1, revision: 7, state: custom("Foreign row") });
  getDatabase().prepare("INSERT INTO settings (key, owner_id, data) VALUES (?, ?, ?)")
    .run("appearance:" + owner.id, other.id, data);
  assert.deepEqual(store.getAppearanceSettings(owner.id), { ownerId: owner.id, state: null, revision: 0 });
  assert.equal(store.saveAppearanceSettings(owner.id, createDefaultAppearanceState(), 0).ok, false);
  const row = getDatabase().prepare("SELECT owner_id, data FROM settings WHERE key = ?").get("appearance:" + owner.id);
  assert.equal(row!.owner_id, other.id);
  assert.equal(row!.data, data);
});

test("database corruption is reported without rewriting or caching the account record", async () => {
  const [{ getDatabase }, , api] = await modules;
  const owner = await account();
  getDatabase().prepare("INSERT INTO settings (key, owner_id, data) VALUES (?, ?, ?)")
    .run("appearance:" + owner.id, owner.id, "{");
  const get = await api.GET(request(owner));
  assert.equal(get.status, 500);
  noStore(get);
  const patch = await api.PATCH(change(owner, createDefaultAppearanceState(), 0));
  assert.equal(patch.status, 500);
  noStore(patch);
  assert.equal(getDatabase().prepare("SELECT data FROM settings WHERE key = ? AND owner_id = ?")
    .get("appearance:" + owner.id, owner.id)!.data, "{");
});
