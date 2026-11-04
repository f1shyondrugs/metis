import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { replaceBrowserFrameUrl } from "../lib/browser-frame-url";
import { closeBrowserResources } from "../lib/browser-resource-cleanup";
import { BoundedChatSnapshotCache, estimateChatSnapshotBytes, writeClientChatSnapshot, clearClientChatSnapshots, deleteClientChatSnapshot } from "../lib/client-chat-cache";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("10000 superseded livestream frames keep only one Blob URL without load events", () => {
  const oldCreate = URL.createObjectURL;
  const oldRevoke = URL.revokeObjectURL;
  const live = new Set<string>();
  let serial = 0;
  URL.createObjectURL = () => { const url = `blob:test-${++serial}`; live.add(url); return url; };
  URL.revokeObjectURL = (url) => { live.delete(url); };
  try {
    const image = { src: "", onload: null, onerror: null };
    const blob = new Blob(["frame"]);
    let current: string | null = null;
    for (let index = 0; index < 10000; index++) {
      current = replaceBrowserFrameUrl(current, blob, image);
      assert.equal(live.size, 1);
    }
    assert.equal(replaceBrowserFrameUrl(current, blob, null), null);
    assert.equal(live.size, 0);
    const brokenImage = { set src(_value: string) { throw new Error("detached image"); }, get src() { return ""; }, onload: null, onerror: null };
    assert.throws(() => replaceBrowserFrameUrl(null, blob, brokenImage), /detached image/);
    assert.equal(live.size, 0);
  } finally { URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; }
});

test("10000 cache inserts stay bounded and protect the active chat", () => {
  const cache = new BoundedChatSnapshotCache<string, { content: string }>(() => ["active"], 8, 4096);
  cache.set("active", { content: "active transcript" });
  for (let index = 0; index < 10000; index++) {
    cache.set(`prefetch-${index}`, { content: "x".repeat(150) });
    assert.ok(cache.size <= 8);
    assert.ok([...cache.values()].reduce((sum, value) => sum + estimateChatSnapshotBytes(value), 0) <= 4096);
    assert.ok(cache.has("active"));
  }
  cache.set("oversized", { content: "x".repeat(4096) });
  assert.equal(cache.has("oversized"), false);
  cache.clear();
  cache.set("fresh", { content: "new" });
  assert.equal(cache.size, 1);
});

test("cache sizing bounds cyclic and unusually wide data without serializing a copy", () => {
  const cyclic: { self?: unknown; content: string } = { content: "text" };
  cyclic.self = cyclic;
  assert.ok(estimateChatSnapshotBytes(cyclic) < 1024);
  assert.ok(estimateChatSnapshotBytes({ content: "x".repeat(2000) }, 1000) > 1000);
  assert.ok(estimateChatSnapshotBytes(Array.from({ length: 100000 }, () => 0)) > 16 * 1024 * 1024);
});

test("hung, throwing and rejected browser closes do not block remaining cleanup", async () => {
  let closed = 0;
  const started = Date.now();
  await closeBrowserResources([
    { close: () => new Promise(() => {}) },
    { close: async () => { throw new Error("dead pipe"); } },
    { close: () => { throw new Error("synchronous dead pipe"); } },
    { close: async () => { closed++; } },
  ], 15);
  assert.equal(closed, 1);
  assert.ok(Date.now() - started < 1000);
});

// Exercise the actual cleanup functions against fake resources, without launching
// Chromium or touching the production browser session registry.
function cleanupFixture() {
  const source = readFileSync(path.join(root, "lib/server-browser.ts"), "utf8");
  const start = source.indexOf("function ownerHasBrowserSessions(");
  const end = source.indexOf("export type BrowserStorageCookie", start);
  const compiled = ts.transpileModule(source.slice(start, end).replaceAll("export async", "async"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const sessions = new Map<string, { ownerId: string; lastUsed: number; tabs: Map<string, { close(): Promise<void> }>; context: { close(): Promise<void> } }>();
  const contexts = new Map<string, Promise<{ close(): Promise<void> }>>();
  const locks = new Map<string, Promise<void>>();
  const functions = new Function("sessions", "persistentContexts", "actionLocks", "sessionCreations", "closingContexts", "closeBrowserResources", "withTimeout", "pruneEphemeralCaches", "SESSION_IDLE_MS", "sessionKey", compiled + "\nreturn { closeBrowserSession, cleanupBrowserSessions };")(
    sessions, contexts, locks, new Map(), new Map(), (resources: Parameters<typeof closeBrowserResources>[0]) => closeBrowserResources(resources, 15),
    (promise: Promise<unknown>) => promise, () => {}, 1000, (owner: string, chat: string) => `${owner}:${chat}`,
  ) as { closeBrowserSession(owner: string, chat: string): Promise<void>; cleanupBrowserSessions(): Promise<void> };
  return { sessions, contexts, locks, ...functions };
}

test("closing one chat frees its pages but preserves another chat's shared browser", async () => {
  const fixture = cleanupFixture();
  let pagesClosed = 0;
  let contextsClosed = 0;
  const context = { close: async () => { contextsClosed++; } };
  fixture.contexts.set("owner", Promise.resolve(context));
  for (const chat of ["a", "b"]) fixture.sessions.set(`owner:${chat}`, {
    ownerId: "owner", lastUsed: Date.now(), context,
    tabs: new Map([["page", { close: async () => { pagesClosed++; } }]]),
  });
  await fixture.closeBrowserSession("owner", "a");
  assert.equal(pagesClosed, 1);
  assert.equal(contextsClosed, 0);
  assert.equal(fixture.sessions.has("owner:b"), true);
  await fixture.closeBrowserSession("owner", "b");
  assert.equal(pagesClosed, 2);
  assert.equal(contextsClosed, 1);
  assert.equal(fixture.contexts.size, 0);
});

test("idle cleanup frees old sessions, skips in-flight work and closes orphan contexts", async () => {
  const fixture = cleanupFixture();
  const closed: string[] = [];
  for (const name of ["idle", "working", "recent", "orphan"]) {
    const context = { close: async () => { closed.push(`${name}-context`); } };
    fixture.contexts.set(name, Promise.resolve(context));
    if (name !== "orphan") fixture.sessions.set(`${name}:chat`, {
      ownerId: name, lastUsed: name === "recent" ? Date.now() : 0, context,
      tabs: new Map([["page", { close: async () => { closed.push(`${name}-page`); } }]]),
    });
  }
  fixture.locks.set("working:chat", Promise.resolve());
  await fixture.cleanupBrowserSessions();
  assert.deepEqual(closed.sort(), ["idle-context", "idle-page", "orphan-context"]);
  assert.equal(fixture.sessions.size, 2);
  fixture.locks.clear();
  await fixture.cleanupBrowserSessions();
  assert.ok(closed.includes("working-page"));
  assert.ok(closed.includes("working-context"));
});

test("disk cache pruning reads metadata only and preserves other account scopes", async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const rows = Array.from({ length: 12 }, (_, index) => ({ key: `owner::${index}`, scope: "owner", cachedAt: index, value: { messages: ["large transcript"] } }));
  rows.push({ key: "other::secret", scope: "other", cachedAt: 1, value: { messages: ["private"] } });
  const request = (result: unknown) => {
    const req: { result: unknown; onsuccess?: () => void } = { result };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };
  let bulkReads = 0;
  const db = {
    close() {},
    transaction() {
      const tx: { oncomplete?: () => void; objectStore(): unknown } = {
        objectStore: () => ({
          put: (row: typeof rows[number]) => { rows.push(row); queueMicrotask(() => tx.oncomplete?.()); },
          count: () => request(rows.length),
          getAll: () => { bulkReads++; throw new Error("bulk transcript cloning is forbidden"); },
          delete: (key: string) => { const index = rows.findIndex((row) => row.key === key); if (index >= 0) rows.splice(index, 1); },
          openCursor: () => {
            const req: { result: unknown; onsuccess?: () => void } = { result: null };
            let index = 0;
            const advance = () => queueMicrotask(() => {
              const row = rows[index++];
              req.result = row ? { value: row, continue: advance } : null;
              req.onsuccess?.();
            });
            advance();
            return req;
          },
        }),
      };
      return tx;
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { indexedDB: { open: () => request(db) } } });
  try {
    await writeClientChatSnapshot("owner", "new", { messages: ["new"] });
    assert.equal(rows.filter((row) => row.scope === "owner").length, 8);
    assert.ok(rows.some((row) => row.key === "other::secret"));
    await clearClientChatSnapshots("owner");
    assert.deepEqual(rows.map((row) => row.key), ["other::secret"]);
    assert.equal(bulkReads, 0);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("an IndexedDB connection arriving after a blocked open is closed", async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let closed = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { indexedDB: { open: () => {
    const req: { result: unknown; onblocked?: () => void; onsuccess?: () => void } = { result: { close: () => { closed++; } } };
    queueMicrotask(() => { req.onblocked?.(); queueMicrotask(() => req.onsuccess?.()); });
    return req;
  } } } });
  try {
    await deleteClientChatSnapshot("owner", "chat");
    await Promise.resolve();
    assert.equal(closed, 1);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("50 concurrent session reads create one page and the owner tab cap rejects excess pages", async () => {
  const source = readFileSync(path.join(root, "lib/server-browser.ts"), "utf8");
  // Extract the tested declarations, independent of neighboring exported helpers.
  const parsed = ts.createSourceFile("server-browser.ts", source, ts.ScriptTarget.ES2022, true);
  const sessionFunctions = parsed.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && ["createSession", "getSession"].includes(statement.name?.text || ""));
  assert.equal(sessionFunctions.length, 2, "Session fixture must include both session functions");
  const compiled = ts.transpileModule(sessionFunctions.map(declaration => declaration.getText(parsed)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let created = 0;
  let pageCount = 0;
  const page = {};
  const context = { pages: () => Array.from({ length: pageCount }, () => page), newPage: async () => { created++; pageCount++; return page; } };
  const sessions = new Map();
  const creations = new Map();
  const getSession = new Function("getPersistentContext", "installRequestGuard", "attachPageEventTracking", "sessions", "sessionCreations", "sessionKey", "MAX_OWNER_PAGES", compiled + "\nreturn getSession;")(
    async () => context, async () => {}, () => {}, sessions, creations, (owner: string, chat: string) => `${owner}:${chat}`, 24,
  ) as (owner: string, chat: string) => Promise<unknown>;
  const results = await Promise.all(Array.from({ length: 50 }, () => getSession("owner", "same-chat")));
  assert.equal(created, 1);
  assert.ok(results.every((result) => result === results[0]));
  assert.equal(creations.size, 0);
  pageCount = 24;
  await assert.rejects(getSession("owner", "new-chat"), /At most 24/);
  assert.equal(created, 1);
  assert.equal(creations.size, 0);
});

test("session creation is shared and stale sessions close before removal", () => {
  const source = readFileSync(path.join(root, "lib/server-browser.ts"), "utf8");
  assert.match(source, /sessionCreations\.get\(key\)/);
  assert.match(source, /MAX_OWNER_PAGES = 24/);
  assert.match(source, /await closeBrowserResources\(context\.pages\(\)\)/);
  assert.match(source, /if \(state && !isContextAlive\(state\)\) \{\s*await closeBrowserSession/);
  const queue = source.slice(source.indexOf("const queued = previous.then"));
  assert.ok(queue.indexOf("try {") < queue.indexOf("await withTimeout("));
});
