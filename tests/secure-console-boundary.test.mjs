import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import test from "node:test";

test("Linux protected console rejects the credential interceptor and fragment leaks", {
  skip: process.platform !== "linux" ? "The protected console service is Linux-only" : false,
}, () => {
  const result = spawnSync("python3", [fileURLToPath(new URL("./secure-console-boundary.test.py", import.meta.url))], {
    encoding: "utf8", timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 5 tests/);
});
