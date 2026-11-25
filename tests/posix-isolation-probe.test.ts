import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isolationFixture } from "./isolation-fixture";

// Real effective-permission test, confined to disposable directories. Uses an
// existing unprivileged UID only inside a short-lived child; no account changes.
const enabled = process.platform === "linux" && process.getuid?.() === 0;
const nobody = enabled ? fs.readFileSync("/etc/passwd", "utf8").split("\n")
  .find(line => line.startsWith("nobody:"))?.split(":") : undefined;
test("POSIX probe checks effective access to separate shared directories and config", { skip: !nobody }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-permission-probe-"));
  const workspace = path.join(dir, "workspace");
  const data = path.join(dir, "shared-data");
  const code = path.join(dir, "code");
  const envFile = path.join(code, ".env");
  fs.chmodSync(dir, 0o711);
  fs.mkdirSync(workspace, { mode: 0o750 });
  fs.chmodSync(workspace, 0o750);
  fs.chownSync(workspace, Number(nobody![2]), Number(nobody![3]));
  fs.mkdirSync(data, { mode: 0o700 });
  fs.mkdirSync(code, { mode: 0o755 });
  fs.chmodSync(code, 0o755);
  fs.writeFileSync(envFile, "TEST_ONLY", { mode: 0o600 });
  const fixture = isolationFixture();
  try {
    const { createManagedUser } = await import("../lib/admin-users");
    createManagedUser({ username: "adminone", password: "password1", workspaceRoot: fixture.dir });
    createManagedUser({ username: "aliceweb", password: "password1", workspaceRoot: "/isolated/alice", osUsername: "alice" });
    const input = { username: nobody![0], uid: Number(nobody![2]), gid: Number(nobody![3]),
      workspace, paths: [data, envFile], codeDirectories: [code] };
    const run = () => fixture.originalExec(process.execPath, ["-e", fixture.state.script, JSON.stringify(input)],
      { encoding: "utf8", env: { NODE_ENV: "test" }, cwd: workspace, stdio: ["ignore", "pipe", "ignore"] });
    assert.equal(run(), "ISOLATED");
    fs.chmodSync(data, 0o755);
    assert.throws(run, "readable shared data must block execution even with an allowed 0750 workspace");
    fs.chmodSync(data, 0o700); fs.chmodSync(envFile, 0o644);
    assert.throws(run, "readable env must block execution");
    fs.chmodSync(envFile, 0o600); fs.chmodSync(code, 0o777);
    assert.throws(run, "writable code/config parent must block execution");
    fs.chmodSync(code, 0o755);
    assert.equal(run(), "ISOLATED");
  } finally { fixture.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
});
