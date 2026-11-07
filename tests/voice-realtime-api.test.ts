import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-voice-realtime-"));
Object.assign(process.env, {
  CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"),
  AI_CHAT_ROOT: root, AGENT_CWD: root, AI_CHAT_SECRETS_KEY: "00".repeat(32),
  CHAT_PASSWORD: "", METIS_AI_BOOTSTRAP_PASSWORD: "", CHAT_LEGACY_HEADER_AUTH: "false",
  OPENAI_API_KEY: "fixture-environment-key",
});
after(() => rmSync(root, { recursive: true, force: true }));

async function fixture() {
  const { getDatabase } = await import("../lib/sqlite");
  const { upsertProviderConnection } = await import("../lib/provider-connections");
  const { POST } = await import("../app/api/voice/realtime/route");
  const ownerId = randomUUID();
  getDatabase().prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(ownerId, ownerId, "unused", new Date().toISOString());
  const token = randomUUID();
  getDatabase().prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(createHash("sha256").update(token).digest("hex"), ownerId, new Date(Date.now() + 60_000).toISOString());
  const connection = upsertProviderConnection(ownerId, {
    providerKey: "openai", slug: "voice-openai", label: "Voice", authType: "api_key",
    secret: "fixture-selected-key", config: { purpose: "voice" },
  })!;
  return { POST, connection, token };
}
function request(token: string, body: unknown) {
  return new Request("http://localhost/api/voice/realtime", {
    method: "POST", headers: { cookie: "ai_chat_auth=" + token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("authenticated owner creates a transcription-only session with their selected key", async (t) => {
  const f = await fixture();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/realtime/client_secrets");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fixture-selected-key");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      session: { type: "transcription", audio: { input: {
        transcription: { model: "gpt-realtime-whisper" }, turn_detection: null,
      } } },
    });
    assert.ok(init?.signal);
    return Response.json({ value: "ek-test", session: { type: "transcription" } });
  };
  const response = await f.POST(request(f.token, { modelId: "gpt-realtime-whisper", connectionId: f.connection.id }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).value, "ek-test");
});

test("unauthenticated, foreign-connection and malformed requests never call OpenAI", async (t) => {
  const f = await fixture();
  const other = await fixture();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error("Must not call OpenAI"); };
  assert.equal((await f.POST(request("", {}))).status, 401);
  const foreign = await f.POST(request(f.token, { modelId: "gpt-realtime-whisper", connectionId: other.connection.id }));
  assert.equal(foreign.status, 400, "a foreign ID must not fall back to the server key");
  assert.equal((await f.POST(request(f.token, null))).status, 400);
  assert.equal((await f.POST(request(f.token, []))).status, 400);
});

test("provider errors, malformed success and network failure return useful JSON errors", async (t) => {
  const f = await fixture();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const body = { modelId: "gpt-realtime-whisper", connectionId: f.connection.id };
  globalThis.fetch = async () => Response.json({ error: { message: "Model access denied" } }, { status: 403 });
  let response = await f.POST(request(f.token, body));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "Model access denied");
  globalThis.fetch = async () => Response.json({});
  response = await f.POST(request(f.token, body));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /no realtime client secret/);
  globalThis.fetch = async () => { throw new Error("network unavailable"); };
  response = await f.POST(request(f.token, body));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Could not reach/);
});
