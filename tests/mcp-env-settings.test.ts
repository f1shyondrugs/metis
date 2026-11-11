import assert from "node:assert/strict";
import test from "node:test";
import { configuredEnvironmentKeys, ownedMcpServer, parseMcpEnvironmentPatch, sanitizeMcpServer } from "../lib/mcp-env-settings";

test("metadata preserves configured keys without exposing values or runtime errors", () => {
  const result = sanitizeMcpServer({ id: "test", name: "Test", kind: "stdio", env: { TOKEN: "secret-canary" }, headers: { Authorization: "secret-canary" }, configured_env_keys: ["OTHER"], probe: { error: "secret-canary" }, arbitrary: "secret-canary" });
  assert.deepEqual(result?.configured_env_keys, ["OTHER", "TOKEN"]);
  assert.deepEqual(result?.configured_header_keys, ["Authorization"]);
  assert.ok(!JSON.stringify(result).includes("secret-canary"));
  assert.deepEqual(configuredEnvironmentKeys({ configured_env_keys: ["TOKEN", "TOKEN", 123] }), ["TOKEN"]);
});
test("patch preserves blanks, retains exact replacement bytes and removes explicitly", () => {
  const result = parseMcpEnvironmentPatch({ set: { KEEP: "", NEW: "  value=one\nnext  " }, remove: ["OLD"] });
  assert.deepEqual(Object.entries(result.set), [["NEW", "  value=one\nnext  "]]);
  assert.deepEqual(result.remove, ["OLD"]);
  assert.deepEqual(Object.entries(parseMcpEnvironmentPatch({}).set), []);
});
test("patch rejects malformed, conflicting, oversized and prototype keys with safe errors", () => {
  for (const body of [null, [], { set: [] }, { set: { "BAD-NAME": "secret-canary" } }, { set: { KEY: 1 } }, { set: { KEY: "\0" } }, { remove: ["KEY", "KEY"] }, { set: { KEY: "" }, remove: ["KEY"] }, { ownerId: "other" }, JSON.parse('{"set":{"__proto__":"secret-canary"}}'), { set: { KEY: "x".repeat(65537) } }, { remove: Array.from({ length: 101 }, (_, i) => "KEY_" + i) }]) {
    assert.throws(() => parseMcpEnvironmentPatch(body), error => error instanceof Error && !error.message.includes("secret-canary"));
  }
});
test("ownership never falls back to global entries or another account", () => {
  const servers = [{ id: "same", ownerId: "other" }, { id: "global" }, { id: "same", ownerId: "owner" }];
  assert.equal(ownedMcpServer(servers, "same", "owner"), servers[2]);
  assert.equal(ownedMcpServer(servers, "same", "stranger"), undefined);
  assert.equal(ownedMcpServer(servers, "global", "owner"), undefined);
});
