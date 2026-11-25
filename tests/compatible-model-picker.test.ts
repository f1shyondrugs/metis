import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("successful keyless compatible discovery feeds the authenticated model picker without widening access", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "metis-compatible-picker-"));
  Object.assign(process.env, {
    AI_CHAT_ROOT: dir, AI_CHAT_INSTALL_DIR: dir, CHAT_DATA_DIR: dir,
    CHAT_DB_PATH: path.join(dir, "chat.sqlite"), AGENT_CWD: dir,
    AI_CHAT_SECRETS_KEY: "ab".repeat(32), CHAT_PASSWORD: "",
    METIS_AI_BOOTSTRAP_PASSWORD: "", CHAT_LEGACY_HEADER_AUTH: "false",
  });
  const [auth, connections, discovery, access, models, check, sqlite] = await Promise.all([
    import("../lib/auth"), import("../lib/provider-connections"),
    import("../lib/providers/discovery"), import("../lib/model-access"),
    import("../app/api/models/route"), import("../app/api/providers/[id]/test/route"),
    import("../lib/sqlite"),
  ]);
  const db = sqlite.getDatabase();
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const owner = auth.createUser("picker-owner", "synthetic-pw").id;
  const other = auth.createUser("picker-other", "synthetic-pw").id;
  const restricted = auth.createUser("picker-restricted", "synthetic-pw").id;
  // Isolate this case from automatically assigned wildcard permission.
  db.prepare("DELETE FROM user_model_permissions WHERE user_id = ?").run(restricted);
  access.ensureAllModelAccess(owner);
  access.ensureAllModelAccess(other);
  const cookie = (user: string) => "ai_chat_auth=" + auth.authenticateUser(user, "synthetic-pw")!.token;
  const ownerCookie = cookie("picker-owner");
  const add = (slug: string, user=owner, providerKey="compatible", enabled=true, purpose="chat") =>
    connections.upsertProviderConnection(user, {
      providerKey, authType: "api_key", slug, label: slug, enabled,
      baseUrl: "https://compatible-fixture.test/v1", config: { purpose },
    })!.id;
  const id = add("keyless-chat");
  const disabled = add("disabled-chat", owner, "compatible", false);
  const voice = add("voice-only", owner, "compatible", true, "voice");
  const gated = add("key-required", owner, "openai");
  const damaged = add("invalid-stored-key");
  const foreign = add("other-owner", other);
  const limited = add("no-model-grant", restricted);
  db.prepare("UPDATE provider_connections SET secret_blob = ? WHERE id = ?").run("invalid-fixture-ciphertext", damaged);
  for (const excluded of [disabled, voice, gated, damaged, foreign, limited]) {
    discovery.persistDiscoveredModels(excluded, [{ id: "fixture-private", displayName: "Excluded" }]);
  }

  let discoveryRequests=0;
  t.mock.method(globalThis, "fetch", async (url: string | URL, options?: RequestInit) => {
    discoveryRequests++;
    assert.equal(String(url), "https://compatible-fixture.test/v1/models");
    assert.equal(new Headers(options?.headers).has("authorization"), false);
    return Response.json({ data: [{ id:"fixture-one" }, { id:"fixture-two" }] });
  });
  const req = (path: string, value?: string) => new Request("http://localhost" + path, {
    headers: value ? { cookie: value } : {},
  });
  const tested = await check.POST(req("/api/providers/" + id + "/test", ownerCookie), { params: Promise.resolve({ id }) });
  assert.equal(tested.status, 200);
  assert.deepEqual(await tested.json(), { ok: true, detail: "2 models available." });
  const result = await models.GET(req("/api/models", ownerCookie));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.deepEqual(body.models.map((model: { id: string }) => model.id).sort(), [
    `compatible:${id}:fixture-one`, `compatible:${id}:fixture-two`,
  ]);
  assert.deepEqual(body.providers.map((provider: {id: string}) => provider.id), [id]);
  assert.ok(body.models.every((model: {id: string}) => access.isModelAllowed(owner,model.id)));
  assert.equal((await models.GET(req("/api/models"))).status, 401);
  const restrictedModels = await (await models.GET(req("/api/models", cookie("picker-restricted")))).json();
  assert.deepEqual(restrictedModels.models, []);
  assert.equal(discoveryRequests, 1, "picker uses the already verified discovery results");
});
