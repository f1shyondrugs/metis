import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-setup-security-"));
Object.assign(process.env, {
  CHAT_DATA_DIR: dataDir, CHAT_DB_PATH: path.join(dataDir, "chat.sqlite"),
  AGENT_CWD: dataDir, AI_CHAT_ROOT: dataDir, CHAT_LEGACY_HEADER_AUTH: "false", AI_CHAT_ALLOW_ROOT_AGENTS: "true",
});
delete process.env.AI_CHAT_SETUP_TOKEN;
delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;

test("real setup route: operator-only bootstrap, one-time consumption, authorization and races", { timeout: 30_000 }, async (t) => {
  const { GET, POST } = await import("../app/api/setup/route");
  const tokens = await import("../lib/setup-token");
  const { getDatabase } = await import("../lib/sqlite");
  const { resetRateLimit } = await import("../lib/rate-limit");
  const { createManagedUser } = await import("../lib/admin-users");
  const { authenticateUser, CHAT_COOKIE } = await import("../lib/auth");
  const db = getDatabase();
  const count = () => Number((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n);
  const post = (body: object, headers: Record<string, string> = {}) => POST(new Request("http://localhost/api/setup", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
  const bootstrap = (setupToken?: unknown, username = "operator") => ({ action: "bootstrap", username, password: "secure-password-123", setupToken, osUsername: os.userInfo().username });
  let secret = "";

  await t.test("missing startup token and spoofed loopback headers fail closed", async () => {
    assert.equal((await POST(new Request("http://localhost/api/setup", { method: "POST", body: "null" }))).status, 400);
    assert.equal((await post(bootstrap())).status, 403);
    assert.equal((await post(bootstrap("wrong"), { "x-forwarded-for": "127.0.0.1", "x-real-ip": "::1", host: "localhost", "x-chat-password": "operator" })).status, 403);
    assert.equal(count(), 0);
    const body = await (await GET(new Request("http://localhost/api/setup"))).json();
    assert.deepEqual(body.osUsers, []);
    assert.equal(body.suggestedOsUsername, "");
    assert.equal(JSON.stringify(body).includes(dataDir), false);
  });

  await t.test("startup creates a persistent 256-bit mode-600 secret without returning it", () => {
    const result = tokens.initializeSetupToken();
    secret = readFileSync(tokens.setupTokenFile, "utf8").trim();
    assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(statSync(tokens.setupTokenFile).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(result).includes(secret), false);
    tokens.initializeSetupToken();
    assert.equal(readFileSync(tokens.setupTokenFile, "utf8").trim(), secret);
  });

  await t.test("token-only check is rate-limited and neither reveals OS data nor claims setup", async () => {
    const check = (setupToken?: unknown, headers?: Record<string, string>) => post({ action: "check-token", setupToken }, headers);
    assert.equal((await check()).status, 403);
    assert.equal((await check(secret, { origin: "https://unrelated.example" })).status, 403);
    const response = await check(secret, { origin: "http://localhost" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(tokens.validSetupToken(secret), true);
    assert.equal(count(), 0);
    resetRateLimit("setup:check-token");
    for (let i = 0; i < 20; i++) {
      assert.equal((await check("wrong", { "x-forwarded-for": String(i) })).status, 403);
    }
    assert.equal((await check(secret)).status, 429);
    resetRateLimit("setup:check-token");
  });

  await t.test("first-run OS suggestions require an operator token and do not consume it", async () => {
    assert.equal((await post({ action: "os-users" })).status, 403);
    assert.equal((await post({ action: "os-users", setupToken: "wrong" })).status, 403);
    const response = await post({ action: "os-users", setupToken: secret });
    assert.equal(response.status, 200);
    const body = await response.json();
    const { listHostOsUsers } = await import("../lib/user-access");
    assert.deepEqual(body.osUsers, listHostOsUsers().map(({username,home}) => ({username,home})));
    assert.equal(body.osUsersAvailable, true);
    assert.equal(JSON.stringify(body).includes(secret), false);
    assert.equal(tokens.validSetupToken(secret), true);
    assert.equal(count(), 0);
  });

  await t.test("invalid OS mappings return actionable errors and preserve first-run state", async () => {
    assert.equal((await post({ ...bootstrap(secret), osUsername: { username: "root" } })).status, 400);
    const missing = await post({ ...bootstrap(secret), osUsername: "metis_missing_diagnostic_user" });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /does not exist on this host/);
    if (process.platform === "linux") {
      const { config } = await import("../lib/config");
      const original = config.allowRootAgents;
      Object.assign(config, { allowRootAgents: false });
      try {
        const root = await post({ ...bootstrap(secret), osUsername: "root" });
        assert.equal(root.status, 400);
        assert.match((await root.json()).error, /explicitly disabled root agents/);
      } finally {
        Object.assign(config, { allowRootAgents: original });
      }
    }
    assert.equal(count(), 0);
    assert.equal(tokens.validSetupToken(secret), true);
  });

  await t.test("unsafe files, symlinks and weak explicit secrets are rejected", () => {
    chmodSync(tokens.setupTokenFile, 0o644);
    assert.equal(tokens.validSetupToken(secret), false);
    assert.throws(() => tokens.initializeSetupToken(), /0600/);
    chmodSync(tokens.setupTokenFile, 0o600);
    unlinkSync(tokens.setupTokenFile);
    const elsewhere = path.join(dataDir, "elsewhere");
    writeFileSync(elsewhere, secret, { mode: 0o600 });
    symlinkSync(elsewhere, tokens.setupTokenFile);
    assert.equal(tokens.validSetupToken(secret), false);
    assert.throws(() => tokens.initializeSetupToken());
    unlinkSync(tokens.setupTokenFile);
    writeFileSync(tokens.setupTokenFile, secret + "\n", { mode: 0o600 });
    process.env.AI_CHAT_SETUP_TOKEN = "short";
    assert.throws(() => tokens.initializeSetupToken(), /32/);
    assert.equal(tokens.validSetupToken("short"), false);
    process.env.AI_CHAT_SETUP_TOKEN = "explicit-operator-secret-with-32-characters";
    assert.equal(tokens.validSetupToken(secret), false);
    assert.equal(tokens.validSetupToken(process.env.AI_CHAT_SETUP_TOKEN), true);
    delete process.env.AI_CHAT_SETUP_TOKEN;
  });

  await t.test("failed creation rolls back user and token consumption", async () => {
    assert.equal((await post({ ...bootstrap(secret), password: "short" })).status, 400);
    assert.equal(count(), 0);
    assert.equal(tokens.validSetupToken(secret), true);
    db.exec("CREATE TRIGGER test_fail_setup BEFORE INSERT ON user_workspace_access BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
    assert.equal((await post(bootstrap(secret))).status, 400);
    db.exec("DROP TRIGGER test_fail_setup");
    assert.equal(count(), 0);
    assert.equal(tokens.validSetupToken(secret), true);
  });

  await t.test("global rate limit cannot be bypassed by changing forwarded headers", async () => {
    resetRateLimit("setup:bootstrap");
    for (let i = 0; i < 10; i++) assert.equal((await post(bootstrap("wrong"), { "x-forwarded-for": String(i) })).status, 403);
    const limited = await post(bootstrap(secret), { "x-forwarded-for": "new-address" });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("Retry-After")) > 0);
    resetRateLimit("setup:bootstrap");
  });

  await t.test("parallel processes calling the real route create exactly one admin", async () => {
    const script = `
      const route = await import("./app/api/setup/route.ts");
      const { POST } = route.default || route;
      console.log("READY");
      process.stdin.once("data", async () => {
        const response = await POST(new Request("http://localhost/api/setup", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ action:"bootstrap", username:process.env.TEST_USERNAME,
            password:"secure-password-123", setupToken:process.env.TEST_SETUP_TOKEN, osUsername:process.env.TEST_OS_USERNAME })
        }));
        console.log("RESULT:" + JSON.stringify({status:response.status, cookie:response.headers.get("set-cookie")}));
        process.exit(0);
      });
    `;
    const children = ["raceone", "racetwo", "racethree"].map((username) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        cwd: path.join(import.meta.dirname, ".."),
        env: { ...process.env, TEST_USERNAME: username, TEST_SETUP_TOKEN: secret, TEST_OS_USERNAME: os.userInfo().username },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "", errors = "";
      let readyResolve!: () => void;
      const ready = new Promise<void>((resolve) => { readyResolve = resolve; });
      child.stdout.on("data", (chunk) => { output += chunk; if (output.includes("READY")) readyResolve(); });
      child.stderr.on("data", (chunk) => { errors += chunk; });
      const result = new Promise<{ status: number; cookie: string | null }>((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (code) => {
          readyResolve();
          const match = output.match(/RESULT:(.*)/);
          if (code !== 0 || !match) reject(new Error(errors + output));
          else resolve(JSON.parse(match[1]));
        });
      });
      return { child, ready, result };
    });
    await Promise.all(children.map((entry) => entry.ready));
    for (const entry of children) entry.child.stdin.end("go");
    const results = await Promise.all(children.map((entry) => entry.result));
    assert.deepEqual(results.map((entry) => entry.status).sort(), [201, 409, 409]);
    assert.equal(count(), 1);
    assert.equal(tokens.setupTokenConsumed(), true);
    assert.equal(tokens.validSetupToken(secret), false);
    assert.equal(existsSync(tokens.setupTokenFile), false);
    const winner = results.find((entry) => entry.status === 201)!;
    assert.match(winner.cookie!, /HttpOnly/);
    assert.equal(winner.cookie!.includes(secret), false);
    const cookie = winner.cookie!.split(";")[0];
    assert.equal((await post({ action: "complete" })).status, 401);
    const adminGet = await (await GET(new Request("http://localhost/api/setup", { headers: { cookie } }))).json();
    const { listHostOsUsers } = await import("../lib/user-access");
    assert.deepEqual(adminGet.osUsers, listHostOsUsers().map(({username,home}) => ({username,home})));
    assert.equal((await post({ action: "os-user", osUsername: null }, { cookie })).status, 200);
    assert.equal((await post({ action: "complete" }, { cookie })).status, 200);
    // Authorization fixture only; no OS provisioning or external host mutation.
    const member = createManagedUser({ username: "member", password: "secure-password-123", isAdmin: true });
    db.prepare("UPDATE users SET is_admin = 0 WHERE id = ?").run(member.id);
    const session = authenticateUser(member.username, "secure-password-123")!;
    const memberCookie = CHAT_COOKIE + "=" + session.token;
    const memberGet = await (await GET(new Request("http://localhost/api/setup", { headers: { cookie: memberCookie } }))).json();
    assert.deepEqual(memberGet.osUsers, []);
    assert.equal(memberGet.suggestedOsUsername, "");
    assert.equal((await post({ action: "complete" }, { cookie: memberCookie })).status, 403);
    assert.equal((await post({ action: "os-user", osUsername: null }, { cookie: memberCookie })).status, 403);
    assert.equal((await post({ action: "os-users", setupToken: secret })).status, 409);
    assert.equal((await post({ action: "check-token", setupToken: secret })).status, 409);
    assert.equal((await post(bootstrap(secret))).status, 409);
  });

  await t.test("restart and even deleting every account never reactivate a consumed token", async () => {
    db.prepare("DELETE FROM users").run();
    process.env.AI_CHAT_SETUP_TOKEN = secret;
    assert.equal(tokens.initializeSetupToken().required, false);
    assert.equal((await post(bootstrap(secret))).status, 409);
    assert.equal(count(), 0);
    delete process.env.AI_CHAT_SETUP_TOKEN;
  });

  await t.test("an account created through another path consumes the startup token atomically", () => {
    db.prepare("DELETE FROM meta WHERE key = 'setup_token_consumed'").run();
    tokens.initializeSetupToken();
    const externalSecret = readFileSync(tokens.setupTokenFile, "utf8").trim();
    createManagedUser({ username: "externaladmin", password: "secure-password-123" });
    assert.equal(tokens.setupTokenConsumed(), true);
    assert.equal(tokens.validSetupToken(externalSecret), false);
    assert.equal(tokens.initializeSetupToken().required, false);
    assert.equal(existsSync(tokens.setupTokenFile), false);
  });
});
