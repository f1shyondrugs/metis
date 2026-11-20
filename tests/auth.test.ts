import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LOGIN_CREDENTIAL_ERROR,
  LOGIN_RATE_LIMIT_ERROR,
  LOGIN_SERVER_ERROR,
  loginErrorMessage,
} from "../lib/login-error";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-auth-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;
process.env.CHAT_PASSWORD = "shared-migration-password";
process.env.CHAT_USERNAME = "first-user";
delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;

test("login errors distinguish bad credentials, rate limits, and server storage failures", () => {
  assert.equal(loginErrorMessage(401), LOGIN_CREDENTIAL_ERROR);
  assert.equal(loginErrorMessage(429), LOGIN_RATE_LIMIT_ERROR);
  assert.equal(loginErrorMessage(500), LOGIN_SERVER_ERROR);
  assert.equal(loginErrorMessage(undefined), LOGIN_SERVER_ERROR);
  assert.equal(loginErrorMessage(400, "SQLITE_CANTOPEN: unable to open database file"), LOGIN_SERVER_ERROR);
  assert.doesNotMatch(loginErrorMessage(500), /wrong username or password/i);
});

test("auth route keeps credential failures at 401 and maps storage exceptions to 500", async () => {
  const { POST } = await import("../app/api/auth/route");
  const response = await POST(new Request("http://localhost/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "198.51.100.23" },
    body: JSON.stringify({ username: "missing-user", password: "not-the-password" }),
  }));
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, "Invalid username or password");
  assert.equal(body.code, "invalid_credentials");

  const routeSource = readFileSync(path.join(process.cwd(), "app", "api", "auth", "route.ts"), "utf8");
  assert.match(routeSource, /catch \(error\)[\s\S]*Authentication storage is unavailable[\s\S]*status: 500/);
});

test("legacy header authentication is off unless CHAT_LEGACY_HEADER_AUTH=true", async () => {
  const { createUser, getAuthenticatedUser, isAuthenticated } = await import("../lib/auth");
  const second = createUser("second-user-created", "password-two");

  const explicitUsername = new Request("http://localhost", {
    headers: {
      "x-chat-password": "shared-migration-password",
      "x-chat-username": second.username,
    },
  });
  assert.equal(await getAuthenticatedUser(explicitUsername), null);
  assert.equal(await isAuthenticated(explicitUsername), false);
});

test("legacy header authentication requires an explicit existing username when enabled", async () => {
  process.env.CHAT_LEGACY_HEADER_AUTH = "true";
  const { createUser, getAuthenticatedUser, isAuthenticated } = await import("../lib/auth");
  const first = createUser("first-user-created", "password-one");
  const second = createUser("second-user-enabled", "password-two");

  const missingUsername = new Request("http://localhost", {
    headers: { "x-chat-password": "shared-migration-password" },
  });
  assert.equal(await getAuthenticatedUser(missingUsername), null);
  assert.equal(await isAuthenticated(missingUsername), false);

  const unknownUsername = new Request("http://localhost", {
    headers: {
      "x-chat-password": "shared-migration-password",
      "x-chat-username": "does-not-exist",
    },
  });
  assert.equal(await getAuthenticatedUser(unknownUsername), null);

  const explicitUsername = new Request("http://localhost", {
    headers: {
      "x-chat-password": "shared-migration-password",
      "x-chat-username": second.username,
    },
  });
  assert.equal((await getAuthenticatedUser(explicitUsername))?.id, second.id);
  assert.equal((await getAuthenticatedUser(explicitUsername))?.id === first.id, false);
  assert.equal(await isAuthenticated(explicitUsername), true);
  delete process.env.CHAT_LEGACY_HEADER_AUTH;
});
