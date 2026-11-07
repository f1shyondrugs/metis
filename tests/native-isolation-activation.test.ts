import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync, mkdirSync, rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {Agent} from "@cursor/sdk";
import {nativeIsolationEnabled, protectedLoginMode, requireProtectedLoginIsolation} from "../lib/native-isolation-policy";

test("ordinary installations preserve native execution; credential input requires explicit isolation", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "metis-isolation-opt-in-"));
  const home = path.join(directory, "home");
  mkdirSync(home);
  const keys = ["HOME", "AGENT_CWD", "AI_CHAT_ROOT", "CHAT_DATA_DIR", "AI_CHAT_MCP_STATE_DIR", "METIS_NATIVE_ISOLATION", "METIS_PROTECTED_LOGIN_MODE"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {HOME: home, AGENT_CWD: home, AI_CHAT_ROOT: process.cwd(),
    CHAT_DATA_DIR: path.join(directory, "data"), AI_CHAT_MCP_STATE_DIR: path.join(directory, "mcp")});
  delete process.env.METIS_NATIVE_ISOLATION;
  delete process.env.METIS_PROTECTED_LOGIN_MODE;
  try {
    const {withNativeRuntime, nativeRuntimeScope, nativeSandboxLaunch} = await import("../lib/providers/native-sandbox");
    const {isolatedCursor} = await import("../lib/providers/cursor-runtime");
    const {browserLoginRequest} = await import("../lib/browser-login-client");
    assert.equal(nativeIsolationEnabled(), false);
    assert.equal(isolatedCursor("alice", home), Agent);
    assert.equal(withNativeRuntime("alice", home, () => nativeRuntimeScope()), undefined);
    const ordinary = nativeSandboxLaunch(process.execPath, ["--version"], {HOME: home});
    assert.equal(ordinary.command, process.execPath);
    assert.equal(ordinary.env.HOME, home);
    assert.throws(requireProtectedLoginIsolation, /explicitly enabled Linux/);
    await assert.rejects(browserLoginRequest("alice", "chat", "prepare"), error =>
      error instanceof Error && "code" in error && error.code === "isolation_required");

    process.env.METIS_PROTECTED_LOGIN_MODE = "unexpected";
    assert.equal(protectedLoginMode(), null);
    assert.throws(requireProtectedLoginIsolation, /Linux credential deployment/);
    process.env.METIS_PROTECTED_LOGIN_MODE = "trusted-root";
    if (process.platform === "linux") assert.doesNotThrow(requireProtectedLoginIsolation);
    else assert.throws(requireProtectedLoginIsolation, /Linux/);
    assert.equal(protectedLoginMode(), "trusted-root");
    assert.equal(nativeIsolationEnabled(), false);
    assert.equal(isolatedCursor("alice", home), Agent);
    assert.equal(withNativeRuntime("alice", home, () => nativeRuntimeScope()), undefined);
    const trusted = nativeSandboxLaunch(process.execPath, ["--version"], {HOME: home});
    assert.equal(trusted.command, process.execPath);
    assert.equal(trusted.env.HOME, home, "Trusted root keeps the configured HOME workspace");

    process.env.METIS_NATIVE_ISOLATION = "1";
    assert.equal(protectedLoginMode(), "isolated", "Explicit isolation never falls back to trusted execution");
    assert.equal(nativeIsolationEnabled(), true);
    if (process.platform === "linux") {
      assert.doesNotThrow(requireProtectedLoginIsolation);
      // Enabling isolation never silently falls back for an unsafe old layout.
      assert.throws(() => withNativeRuntime("alice", home, () =>
        nativeSandboxLaunch(process.execPath, ["--version"])), /overlaps protected application data/);
      assert.throws(() => nativeSandboxLaunch(process.execPath, ["--version"]), /account scope/);
    } else {
      assert.throws(requireProtectedLoginIsolation, /Linux/);
      assert.throws(() => isolatedCursor("alice", home), /requires Linux/);
    }
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(directory, {recursive: true, force: true});
  }
});
