import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { GET as discovery } from "../app/api/system/client-compatibility/route";
import { initializeRequestNetwork, stampRequestNetwork } from "../lib/request-network";

test("client discovery is public, static, and does not create a session", async () => {
  const response = discovery();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("set-cookie"), false);
  assert.deepEqual(await response.json(), { service: "metis", schemaVersion: 1, supportedVersions: [1] });
});

test("versioned and legacy clients keep the same protected login and logout contract", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "metis-client-login-contract-"));
  Object.assign(process.env, {
    AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: root, CHAT_DATA_DIR: root,
    CHAT_DB_PATH: path.join(root, "chat.sqlite"), AI_CHAT_MCP_STATE_DIR: path.join(root, "mcp-state"),
    METIS_AI_BOOTSTRAP_PASSWORD: "", METIS_AI_ADMIN_USERNAMES: "", CHAT_LEGACY_HEADER_AUTH: "false",
    AI_CHAT_TRUSTED_PROXIES: "127.0.0.1",
  });
  initializeRequestNetwork();
  const { getDatabase } = await import("../lib/sqlite");
  const { createUser } = await import("../lib/auth");
  const auth = await import("../app/api/auth/route");
  const chats = await import("../app/api/chats/route");
  const db = getDatabase();
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });

  const username = "login-contract-fixture";
  const password = "only-a-local-fixture-12345";
  createUser(username, password);
  const publicOrigin = "https://contract.test";

  for (const proxied of [false, true]) {
    await t.test(proxied ? "trusted TLS-terminating proxy" : "direct HTTPS", async () => {
      const req = (route: string, init: RequestInit = {}) => {
        if (!proxied) return new Request(publicOrigin + route, init);
        const peer = {
          socket: { remoteAddress: "127.0.0.1" },
          headers: { "x-forwarded-proto": "https", "x-forwarded-for": "192.0.2.20" },
        } as unknown as IncomingMessage;
        stampRequestNetwork(peer);
        const headers = new Headers(init.headers);
        for (const [key, value] of Object.entries(peer.headers)) {
          if (typeof value === "string") headers.set(key, value);
        }
        return new Request("http://internal.test" + route, { ...init, headers });
      };
      const login = (candidate: string) => auth.POST(req("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: publicOrigin },
        body: JSON.stringify({ username, password: candidate }),
      }));
      const malformed = await auth.POST(req("/api/auth", { method: "POST", body: "not JSON" }));
      assert.equal(malformed.status, 400);
      assert.deepEqual(await malformed.json(), { error: "Invalid JSON", code: "invalid_request" });

      const rejected = await login("wrong-fixture-password");
      assert.equal(rejected.status, 401);
      assert.equal(rejected.headers.has("set-cookie"), false);
      assert.deepEqual(await rejected.json(), { error: "Invalid username or password", code: "invalid_credentials" });

      const accepted = await login(password);
      assert.equal(accepted.status, 200);
      assert.deepEqual(await accepted.json(), { ok: true });
      const setCookie = accepted.headers.get("set-cookie") ?? "";
      assert.match(setCookie, /^ai_chat_auth=/);
      assert.match(setCookie, /;\s*HttpOnly\b/i);
      assert.match(setCookie, /;\s*Secure\b/i);
      assert.match(setCookie, /;\s*Path=\/(?:;|$)/i);
      const cookie = setCookie.split(";", 1)[0];
      assert.equal((await chats.GET(req("/api/chats", { headers: { cookie } }))).status, 200);
      assert.equal((await auth.DELETE(req("/api/auth", { method: "DELETE", headers: { cookie } }))).status, 200);
      assert.equal((await chats.GET(req("/api/chats", { headers: { cookie } }))).status, 401);
    });
  }

  const limitedUser = "isolated-rate-limit-fixture";
  let limited: Response | undefined;
  // Test only the local fixture, including the original Retry-After behavior.
  for (let attempt = 0; attempt < 11; attempt++) {
    limited = await auth.POST(new Request(publicOrigin + "/api/auth", {
      method: "POST", body: JSON.stringify({ username: limitedUser, password: "wrong-fixture-password" }),
    }));
  }
  assert.equal(limited?.status, 429);
  assert.match(limited?.headers.get("retry-after") ?? "", /^\d+$/);
  assert.deepEqual(await limited?.json(), {
    error: "Too many login attempts. Please try again later.", code: "rate_limited",
  });
});
