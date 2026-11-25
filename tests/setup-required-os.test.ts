import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test("first admin cannot skip selecting an OS user, even when root is allowed", async (t) => {
  const data = mkdtempSync(path.join(os.tmpdir(), "metis-setup-required-os-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const token = "synthetic-operator-token-with-at-least-32-characters";
  Object.assign(process.env, {
    CHAT_DATA_DIR: data, CHAT_DB_PATH: path.join(data, "test.sqlite"), AI_CHAT_ROOT: data,
    AGENT_CWD: os.userInfo().homedir, AI_CHAT_ALLOW_ROOT_AGENTS: "true", AI_CHAT_SETUP_TOKEN: token,
  });
  delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;
  const { POST } = await import("../app/api/setup/route");
  const { getDatabase } = await import("../lib/sqlite");
  const { validSetupToken } = await import("../lib/setup-token");

  for (const osUsername of [undefined, null, "", "   ", 0]) {
    const reply = await POST(new Request("http://localhost/api/setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "bootstrap", setupToken: token, username: "fixture-admin", password: "fixture-password", osUsername,
      }),
    }));
    assert.equal(reply.status, 400);
    assert.match((await reply.json()).error, /Enter the OS username/);
    assert.equal(reply.headers.get("set-cookie"), null);
    assert.equal(validSetupToken(token), true);
  }
  assert.deepEqual(getDatabase().prepare("SELECT id FROM users").all(), []);
  assert.deepEqual(getDatabase().prepare("SELECT user_id FROM user_workspace_access").all(), []);
});
