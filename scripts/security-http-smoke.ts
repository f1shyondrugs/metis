import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";

async function main() {
  const root = process.cwd();
  const slot = process.env.METIS_SECURITY_BUILD_SLOT || ".next-b";
  assert.ok([".next-a", ".next-b"].includes(slot));
  assert.ok(existsSync(path.join(root, slot, "BUILD_ID")));
  const fixture = mkdtempSync(path.join(os.tmpdir(), "metis-security-http-"));
  const source = path.join(fixture, "source");
  mkdirSync(source);
  // Copy the candidate sources, never .env, runtime data or production DB.
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root })
    .toString().split("\0").filter(Boolean);
  for (const file of files) {
    if (!existsSync(path.join(root, file)) || file.startsWith("docs/security-audit-2026-10-08-evidence/")) continue;
    assert.ok(!file.startsWith(".env") || file === ".env.example");
    assert.ok(!file.startsWith("data/"));
    mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    copyFileSync(path.join(root, file), path.join(source, file));
  }
  symlinkSync(path.join(root, "node_modules"), path.join(source, "node_modules"), "dir");
  symlinkSync(path.join(root, slot), path.join(source, slot), "dir");
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const base = "http://127.0.0.1:" + port;
  let output = "";
  const child = spawn(process.execPath, ["--import", "tsx", "server.mjs"], { cwd: source, env: {
    NODE_ENV: "production", PATH: process.env.PATH, PORT: String(port), AI_CHAT_HOST: "127.0.0.1",
    NEXT_DIST_DIR: slot, AI_CHAT_ROOT: source, AI_CHAT_INSTALL_DIR: source,
    CHAT_DATA_DIR: path.join(fixture, "data"), CHAT_DB_PATH: path.join(fixture, "data", "chat.sqlite"),
    AI_CHAT_MCP_STATE_DIR: path.join(fixture, "mcp"), AGENT_CWD: path.join(fixture, "workspace"),
    AI_CHAT_PUBLIC_URL: base, AI_CHAT_INTERNAL_ORIGIN: base,
    AI_CHAT_SECRETS_KEY: "c".repeat(64), MCP_BEARER_TOKEN: "synthetic-http-test-bearer",
    AI_CHAT_ALLOW_ROOT_AGENTS: "true", AI_CHAT_TRUSTED_PROXIES: "",
  }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  mkdirSync(path.join(fixture, "workspace"), { recursive: true });
  const request = (route: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + route, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) throw new Error("Isolated server exited: " + output);
      try { if ((await fetch(base + "/api/setup")).ok) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, "isolated server became ready");
    const status = await (await fetch(base + "/api/setup")).json();
    assert.deepEqual(status.osUsers, []);
    const file = path.join(fixture, "data", "setup-token");
    const token = readFileSync(file, "utf8").trim();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.ok(!output.includes(token), "secret never logged");
    console.log("HTTP_PRIVATE_TOKEN_BEFORE_LISTEN_PASS");
    assert.equal((await request("/api/setup", { action: "check-token", setupToken: "invalid" }, { origin: base })).status, 403);
    const checked = await request("/api/setup", { action: "check-token", setupToken: token }, { origin: base });
    assert.equal(checked.status, 200);
    assert.equal(checked.headers.get("set-cookie"), null);
    assert.deepEqual(await checked.json(), { ok: true });
    assert.equal((await (await fetch(base + "/api/setup")).json()).hasUsers, false);
    assert.ok(existsSync(file));
    console.log("HTTP_TOKEN_CHECK_NO_ACCOUNT_PASS");
    assert.equal((await request("/api/setup", { action: "bootstrap", username: "synthetic-admin", password: "synthetic-password" })).status, 403);
    const bootstrap = await request("/api/setup", { action: "bootstrap", setupToken: token, username: "synthetic-admin", password: "synthetic-password", osUsername: os.userInfo().username });
    assert.equal(bootstrap.status, 201);
    const cookie = bootstrap.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await request("/api/setup", { action: "bootstrap", setupToken: token, username: "other", password: "synthetic-password" })).status, 409);
    assert.ok(!existsSync(file));
    console.log("HTTP_SETUP_AND_OS_DISCLOSURE_PASS");
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await request("/api/auth", { username: "synthetic-bruteforce", password: "wrong" }, {
        "x-real-ip": "198.51.100." + attempt, "x-forwarded-for": "203.0.113." + attempt, "x-metis-network": "forged.fake",
      });
      assert.equal(response.status, attempt < 10 ? 401 : 429);
    }
    console.log("HTTP_ROTATING_IP_LIMIT_PASS");
    assert.equal((await request("/api/process-a", { topic: "synthetic", languages: ["en"] })).status, 404);
    console.log("HTTP_LLM_ROUTE_REMOVED_PASS");
    const wsStatus = (origin: string, cookieHeader?: string) => new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(base.replace("http:", "ws:") + "/api/browser/stream?chatId=synthetic", {
        headers: { Origin: origin, ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
      });
      ws.on("unexpected-response", (_req, res) => { res.resume(); resolve(res.statusCode!); });
      ws.on("open", () => { ws.close(); reject(new Error("Unexpected browser stream accepted")); });
      ws.on("error", reject);
    });
    assert.equal(await wsStatus("https://evil.example", cookie), 403);
    assert.equal(await wsStatus("null", cookie), 403);
    assert.equal(await wsStatus(base), 401);
    console.log("HTTP_WS_ORIGIN_PASS");
    assert.equal((await fetch(base + "/api/chats", { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(base + "/api/auth", { method: "DELETE", headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(base + "/api/chats", { headers: { Cookie: cookie } })).status, 401);
    console.log("HTTP_LOGOUT_REVOKED_PASS");
    console.log("SECURITY_HTTP_SMOKE_PASS");
  } finally {
    // Only the child started here is terminated; no systemd or other services.
    const exit = child.exitCode === null ? once(child, "exit") : Promise.resolve();
    child.kill("SIGTERM");
    await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 8_000))]);
    if (child.exitCode === null) { child.kill("SIGKILL"); await exit; }
    rmSync(fixture, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
