import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

test("environment API authenticates, scopes owners, returns keys only and rejects unsafe writes", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-mcp-env-"));
  const state = path.join(root, "mcp-state");
  Object.assign(process.env, { AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: root, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"), AI_CHAT_MCP_STATE_DIR: state, METIS_AI_BOOTSTRAP_PASSWORD: "", METIS_AI_ADMIN_USERNAMES: "", CHAT_LEGACY_HEADER_AUTH: "false", AI_CHAT_SECRETS_KEY: "04".repeat(32) });
  mkdirSync(state, { recursive: true });
  writeFileSync(path.join(state, "registry.json"), JSON.stringify({ version: 1, servers: [
    { id: "owned", name: "Owned", kind: "stdio", command: "echo", ownerId: "owner", env: { TOKEN: "secret-canary" }, enabled: false },
    { id: "global", name: "Global", kind: "stdio", command: "echo", env: { TOKEN: "secret-canary" }, enabled: false },
  ] }));
  const { getDatabase } = await import("../lib/sqlite");
  const db = getDatabase();
  try {
    for (const id of ["owner", "stranger"]) {
      db.prepare("INSERT INTO users(id,username,password_hash,created_at,is_admin) VALUES(?,?,?,?,?)").run(id, id, "test-only", new Date().toISOString(), 0);
      db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(createHash("sha256").update(id).digest("hex"), id, new Date(Date.now() + 60000).toISOString());
    }
    const route = await import("../app/api/mcp-servers/[id]/env/route");
    const collection = await import("../app/api/mcp-servers/route");
    const req = (token?: string, body?: unknown, origin?: string) => new Request("http://localhost/api/mcp-servers/owned/env", {
      method: body === undefined ? "GET" : "PATCH", headers: { ...(token ? { cookie: "ai_chat_auth=" + token } : {}), "Content-Type": "application/json", origin:origin||"http://localhost" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const params = (id = "owned") => ({ params: Promise.resolve({ id }) });
    const listing = await collection.GET(req("owner"));
    assert.equal(listing.status, 200);
    const listed = await listing.json();
    const entry = listed.servers.find((server: { id: string }) => server.id === "owned");
    assert.deepEqual(entry.configured_env_keys, ["TOKEN"]);
    assert.equal(entry.can_edit_environment, true);
    assert.ok(!JSON.stringify(listed).includes("secret-canary"));
    assert.equal(listed.servers.find((server: { id: string }) => server.id === "global").can_edit_environment, false);
    assert.equal((await route.GET(req(), params())).status, 401);
    assert.equal((await route.PATCH(req(undefined, {}), params())).status, 401);
    assert.equal((await route.GET(req("stranger"), params())).status, 404);
    assert.equal((await route.GET(req("owner"), params("global"))).status, 404);
    const response = await route.GET(req("owner"), params());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const metadata = await response.json();
    assert.deepEqual(metadata.keys, [{ key: "TOKEN", configured: true }]);
    assert.match(metadata.revision, /^[a-f0-9]{64}$/);
    const updated = await route.PATCH(req("owner", { revision: metadata.revision, set: { TOKEN: "", NEW: "replacement-canary" }, remove: [] }), params());
    assert.equal(updated.status, 200);
    const next = await updated.json();
    assert.ok(!JSON.stringify(next).includes("replacement-canary"));
    assert.equal((await route.PATCH(req("owner", { revision: metadata.revision, remove: ["TOKEN"] }), params())).status, 409);
    const removed = await route.PATCH(req("owner", { revision: next.revision, remove: ["NEW"] }), params());
    assert.equal(removed.status, 200);
    const preserved = await route.GET(req("owner"), params());
    assert.deepEqual((await preserved.json()).keys, [{ key: "TOKEN", configured: true }]);
    assert.equal((await route.PATCH(req("stranger", {}), params())).status, 404);
    assert.equal((await route.PATCH(req("owner", {}, "https://evil.example"), params())).status, 403);
    const invalid = await route.PATCH(req("owner", { set: { "BAD-NAME": "secret-canary" } }), params());
    assert.equal(invalid.status, 400);
    assert.ok(!(await invalid.text()).includes("secret-canary"));
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
