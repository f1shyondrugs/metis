import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync, rmSync} from "node:fs";
import path from "node:path";
import os from "node:os";
import {randomUUID} from "node:crypto";

test("cancelling a protected question needs no broker and never persists submitted secrets", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "metis-secure-cancel-"));
  Object.assign(process.env, {CHAT_DATA_DIR: directory, CHAT_DB_PATH: path.join(directory, "chat.sqlite"),
    AI_CHAT_ROOT: directory, AGENT_CWD: directory});
  delete process.env.METIS_NATIVE_ISOLATION;
  const auth = await import("../lib/auth");
  const store = await import("../lib/db-store");
  const questions = await import("../lib/db-questions");
  const {POST} = await import("../app/api/chat/answer/route");
  const user = auth.createUser("secure-cancel-fixture", "SYNTHETIC-ACCOUNT-PW");
  const cookie = "ai_chat_auth=" + auth.authenticateUser("secure-cancel-fixture", "SYNTHETIC-ACCOUNT-PW")!.token;
  const chat = store.createChat("Protected question", undefined, user.id);
  const pending = questions.createPendingQuestion({
    questions: [{key: "secure_login", question: "Enter credentials securely", type: "text", required: false}],
  }, chat.id, user.id, {secureBrowserInput: {requestId: randomUUID(), origin: "https://example.test",
    expiresAt: new Date(Date.now() + 60000).toISOString()}});
  try {
    const response = await POST(new Request("http://localhost/api/chat/answer", {method: "POST",
      headers: {cookie, "content-type": "application/json"},
      body: JSON.stringify({questionId: pending.questionId, version: pending.version, cancelled: true,
        values: {secure_login: "SYNTHETIC-DO-NOT-PERSIST"}})}));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cancelled, true);
    const resolved = questions.getPendingQuestion(pending.questionId, user.id)!;
    assert.deepEqual(resolved.values, {});
    assert.equal(resolved.summary, "User cancelled");
    assert(!JSON.stringify(store.getChat(chat.id, user.id)).includes("SYNTHETIC-DO-NOT-PERSIST"));
  } finally {
    pending.stop();
    rmSync(directory, {recursive: true, force: true});
  }
});
