import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { initializeChatVersionIndexes, readChatVersion } from "../lib/chat-version-index";

const dir = mkdtempSync(path.join(os.tmpdir(), "metis-targeted-reads-"));
Object.assign(process.env, { CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"), AI_CHAT_ROOT: dir });
const loaded = Promise.all([import("../lib/auth"), import("../lib/db-store"), import("../lib/sqlite"), import("../lib/chat-memory-view"), import("../lib/db-questions"), import("../app/api/chat/answer/route")]);
let modules: Awaited<typeof loaded>;
before(async () => { modules = await loaded; });
after(() => rmSync(dir, { recursive: true, force: true }));

function observeReadBytes(db: DatabaseSync) {
  const prepare = db.prepare;
  let bytes = 0;
  db.prepare = function (...args: Parameters<DatabaseSync["prepare"]>) {
    const stmt = Reflect.apply(prepare, db, args);
    for (const method of ["get", "all"] as const) {
      const original = stmt[method];
      Object.defineProperty(stmt, method, { value: (...values: unknown[]) => {
        const result = Reflect.apply(original, stmt, values);
        const rows = Array.isArray(result) ? result : [result];
        for (const row of rows) if (row && typeof row === "object")
          for (const value of Object.values(row)) if (typeof value === "string") bytes += Buffer.byteLength(value);
        return result;
      }});
    }
    return stmt;
  };
  return { bytes: () => bytes, restore: () => { db.prepare = prepare; } };
}

test("covering versions initialize per connection and preserve metadata/checkpoint cache invalidation", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  for (let i = 0; i < 2; i++) {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE chats(id TEXT PRIMARY KEY,data TEXT,updated_at TEXT); CREATE TABLE chat_page_state(chat_id TEXT PRIMARY KEY,revision INTEGER,metadata TEXT)");
      db.prepare("INSERT INTO chats VALUES(?,?,?)").run("chat", "large-blob", "one");
      assert.deepEqual({ ...readChatVersion(db, "chat") }, { updatedAt: "one", revision: 0 });
      db.prepare("INSERT INTO chat_page_state VALUES(?,?,?)").run("chat", 7, "metadata");
      assert.deepEqual({ ...readChatVersion(db, "chat") }, { updatedAt: "one", revision: 7 });
      db.prepare("UPDATE chats SET updated_at=? WHERE id=?").run("two", "chat");
      assert.equal(readChatVersion(db, "chat")?.updatedAt, "two");
      initializeChatVersionIndexes(db);
      const plan = db.prepare("EXPLAIN QUERY PLAN SELECT c.updated_at,s.revision FROM chats c INDEXED BY chats_reference_version LEFT JOIN chat_page_state s INDEXED BY chat_pages_reference_revision ON s.chat_id=c.id WHERE c.id=?").all("chat");
      assert.equal(plan.filter(row => String(row.detail).includes("COVERING INDEX")).length, 2);
      assert.equal(readChatVersion(db, "missing"), undefined);
    } finally { db.close(); }
  }
});

test("targeted messages use current checkpoints, reject foreign access and recover stale projections", () => {
  const [auth, store, sqlite] = modules;
  const owner = auth.createUser("targeted-owner", "test-password").id;
  const foreign = auth.createUser("targeted-foreign", "test-password").id;
  const chat = store.createChat("Targeted", undefined, owner);
  store.appendMessage(chat.id, { id: "assistant", role: "assistant", content: "Before" }, owner);
  assert.equal(store.getChatMessage(chat.id, "assistant", owner)?.content, "Before");
  store.getChat(chat.id, owner); // Populate the full-chat cache before a checkpoint changes only the page revision.
  store.checkpointAssistantMessage(chat.id, { id: "assistant", role: "assistant", content: "After checkpoint" });
  assert.equal(store.getChatMessage(chat.id, "assistant", owner)?.content, "After checkpoint");
  assert.equal(store.getChat(chat.id, owner)?.messages[0].content, "After checkpoint");
  assert.equal(store.getChatMessage(chat.id, "assistant", foreign), null);
  assert.equal(store.getChatMessage(chat.id, "missing", owner), null);
  assert.equal(store.getChatMessage("../invalid", "assistant", owner), null);
  const db = sqlite.getDatabase();
  // Make only the projection stale: fallback must retain checkpoint overlay semantics.
  db.prepare("UPDATE chat_page_state SET ready_revision=0 WHERE chat_id=?").run(chat.id);
  assert.equal(store.getChatMessage(chat.id, "assistant", owner)?.content, "After checkpoint");
  const expired = store.createChat("Expired", undefined, owner, undefined, { incognito: true });
  db.prepare("UPDATE chat_list SET expires_at=? WHERE id=?").run("2000-01-01T00:00:00Z", expired.id);
  assert.equal(store.getChatMessage(expired.id, "anything", owner), null);
});

test("metadata views and a single-message lookup do not transfer unrelated transcript data", () => {
  const [auth, store, sqlite, views] = modules;
  const owner = auth.createUser("bounded-read-owner", "test-password").id;
  const chat = store.createChat("Large transcript", undefined, owner);
  store.appendMessage(chat.id, { id: "large", role: "user", content: "x".repeat(4 * 1024 * 1024) }, owner);
  store.appendMessage(chat.id, { id: "small", role: "assistant", content: "Only this message" }, owner);
  store.clearStoreCaches();
  const probe = observeReadBytes(sqlite.getDatabase());
  try {
    assert.equal(store.getChatMessage(chat.id, "small", owner)?.content, "Only this message");
    assert.equal(views.loadChatMemoryView(chat.id, owner)?.chatId, chat.id);
    assert(probe.bytes() < 128 * 1024, "Small reads must not transfer the multi-megabyte transcript");
  } finally { probe.restore(); }
});

test("answer submission reads a large transcript once and retries use only the indexed answer", async () => {
  const [auth, store, sqlite, , questions, answer] = modules;
  const owner = auth.createUser("large-answer-owner", "test-password").id;
  const cookie = "ai_chat_auth=" + auth.authenticateUser("large-answer-owner", "test-password")!.token;
  const chat = store.createChat("Large answer", undefined, owner);
  store.appendMessage(chat.id, { id: "old", role: "user", content: "x".repeat(8 * 1024 * 1024) }, owner);
  const pending = questions.createPendingQuestion([{ question: "Choice", key: "choice", type: "text" }], chat.id, owner);
  store.appendMessage(chat.id, { id: "ask", role: "assistant", content: "Before", parts: [
    { type: "text", content: "Before" }, { type: "tool", id: "ask-tool", name: "ask_user", status: "running" },
  ] }, owner);
  store.updateChat(chat.id, { pendingQuestion: { ...pending, status: "waiting_for_user" } }, owner, { metadataProjection: true });
  store.clearStoreCaches();
  const submit = () => answer.POST(new Request("http://localhost/api/chat/answer", { method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ questionId: pending.questionId, values: { choice: "Accepted" }, version: 1 }) }));
  let probe = observeReadBytes(sqlite.getDatabase());
  try {
    const response = await submit();
    assert.equal(response.status, 200);
    const first = await response.json();
    assert.equal(first.message.questionAnswer.toolCallId, "ask-tool");
    assert(probe.bytes() < 9 * 1024 * 1024, "Initial answer may transfer the transcript only once for its exact anchor");
    probe.restore();
    probe = observeReadBytes(sqlite.getDatabase());
    const repeated = await submit();
    assert.equal(repeated.status, 200);
    assert.deepEqual((await repeated.json()).message, first.message);
    assert(probe.bytes() < 128 * 1024, "Idempotent retry must read only the existing answer and metadata");
    assert.deepEqual(await pending.promise, ["Accepted"]);
  } finally { probe.restore(); pending.stop(); }
});
