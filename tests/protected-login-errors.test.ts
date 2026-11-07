import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { browserLoginRequest } from "../lib/browser-login-client";
import { ProtectedLoginError, protectedLoginFailure } from "../lib/protected-login-errors";

test("protected-login diagnostics discard untrusted codes and raw exception messages", () => {
  const secret = "TEST-PRIVATE-DIAGNOSTIC";
  for (const code of [undefined, null, {}, "constructor", "__proto__", secret]) {
    const error = new ProtectedLoginError(code);
    assert.equal(error.code, "protected_login_unavailable");
    assert(!error.message.includes(secret));
  }
  assert.deepEqual(protectedLoginFailure(new Error(secret)), protectedLoginFailure(undefined));
  assert.equal(protectedLoginFailure(new ProtectedLoginError("unsafe_target")).code, "unsafe_target");
});

test("private-browser transport reconstructs only fixed diagnostics and preserves successful readiness", async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "metis-login-errors-"));
  const socket = path.join(dir, "test.sock");
  const previous = process.env.METIS_BROWSER_LOGIN_SOCKET;
  const isolation = process.env.METIS_NATIVE_ISOLATION;
  process.env.METIS_NATIVE_ISOLATION = "1";
  t.after(() => { if (isolation === undefined) delete process.env.METIS_NATIVE_ISOLATION; else process.env.METIS_NATIVE_ISOLATION = isolation; });
  let status = 403;
  let reply: unknown = { code: "unsafe_target", error: "TEST-PRIVATE-MESSAGE" };
  let malformed = false;
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume the isolated fixture request */ }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(malformed ? "TEST-PRIVATE-MALFORMED" : JSON.stringify(reply));
  });
  await new Promise<void>(resolve => server.listen(socket, resolve));
  process.env.METIS_BROWSER_LOGIN_SOCKET = socket;
  t.after(async () => {
    if (previous === undefined) delete process.env.METIS_BROWSER_LOGIN_SOCKET;
    else process.env.METIS_BROWSER_LOGIN_SOCKET = previous;
    await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
    rmSync(dir, { recursive: true, force: true });
  });
  const request = () => browserLoginRequest("fixture-owner", "fixture-chat", "prepare", {});
  await assert.rejects(request, error => error instanceof ProtectedLoginError
    && error.code === "unsafe_target" && !error.message.includes("TEST-PRIVATE"));
  reply = { code: "TEST-PRIVATE-CODE", error: "TEST-PRIVATE-MESSAGE" };
  await assert.rejects(request, error => error instanceof ProtectedLoginError
    && error.code === "protected_login_unavailable" && !error.message.includes("TEST-PRIVATE"));
  malformed = true;
  await assert.rejects(request, error => error instanceof ProtectedLoginError
    && error.code === "protected_login_unavailable" && !error.message.includes("TEST-PRIVATE"));
  malformed = false; status = 200;
  reply = { status: "protected_browser_ready", code: "credential_fields_not_visible", missingFields: ["username", "password"] };
  assert.deepEqual(await request(), reply);
  process.env.METIS_BROWSER_LOGIN_SOCKET = path.join(dir, "unreachable.sock");
  await assert.rejects(request, error => error instanceof ProtectedLoginError
    && error.code === "protected_login_unavailable");
});
