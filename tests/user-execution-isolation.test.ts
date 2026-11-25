import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { isolationFixture } from "./isolation-fixture";

const fixture = isolationFixture(true);
test("legacy mappings are guarded without changing root admin access or DB rows", async (t) => {
  try {
    const { getDatabase } = await import("../lib/sqlite");
    const { config } = await import("../lib/config");
    const { requireUserExecutionIdentity, getUserExecutionIdentity, getUserAccess, ensureUserAccess, isHostAdmin } = await import("../lib/user-access");
    const db = getDatabase();
    const user = (id: string, admin = false, username = id) => db.prepare(
      "INSERT INTO users(id, username, password_hash, created_at, is_admin) VALUES(?, ?, 'test', ?, ?)"
    ).run(id, username, new Date().toISOString(), Number(admin));
    const mapping = (id: string, workspace: string, name?: string, uid?: number, gid = uid) => db.prepare(
      "INSERT INTO user_workspace_access(user_id,workspace_root,os_username,uid,gid,created_at,updated_at) VALUES(?,?,?,?,?,'test','test')"
    ).run(id, workspace, name ?? null, uid ?? null, gid ?? null);
    user("admin", true); mapping("admin", "/root/virtual-metis", "root", 0);
    user("unsafe"); mapping("unsafe", "/root/virtual-metis");
    const snapshot = () => db.prepare("SELECT * FROM user_workspace_access ORDER BY user_id").all();
    db.prepare("UPDATE user_workspace_access SET os_username=NULL, uid=NULL, gid=NULL WHERE user_id='admin'").run();
    const before = snapshot();
    assert.equal(requireUserExecutionIdentity("admin").uid, 0, "explicit admin alone receives root fallback");
    assert.throws(() => requireUserExecutionIdentity("unsafe"), /no valid OS user mapping/);
    assert.equal(getUserExecutionIdentity(), undefined);
    assert.equal(getUserExecutionIdentity("unknown"), undefined);
    assert.deepEqual(snapshot(), before, "execution does not auto-repair mappings");
    db.prepare("UPDATE user_workspace_access SET os_username='root',uid=0,gid=0 WHERE user_id='unsafe'").run();
    assert.throws(() => requireUserExecutionIdentity("unsafe"), /explicitly configured/);
    assert.equal(requireUserExecutionIdentity("admin").uid, 0, "legacy root collision must not cut off explicit admin");
    // Neither username/env nor being the first account grants root execution.
    process.env.METIS_AI_ADMIN_USERNAMES = "unsafe";
    assert.equal(isHostAdmin("unsafe"), false, "username/env cannot promote a persisted nonadmin");
    assert.throws(() => requireUserExecutionIdentity("unsafe"), /explicitly configured/);
    delete process.env.METIS_AI_ADMIN_USERNAMES;
    db.prepare("DELETE FROM users WHERE id='unsafe'").run();
    user("alice"); mapping("alice", "/isolated/alice", "alice", 12001);
    assert.equal(requireUserExecutionIdentity("alice").uid, 12001);
    assert.ok(fixture.state.probes.at(-1)?.paths.includes(config.databasePath));
    assert.ok(fixture.state.probes.at(-1)?.paths.includes(config.mcpStateDir));
    assert.ok(fixture.state.probes.at(-1)?.paths.includes("/root"));
    assert.ok(fixture.state.probes.at(-1)?.paths.includes(`${config.root}/.env`));
    fixture.state.mode = 0o40755;
    assert.throws(() => requireUserExecutionIdentity("alice"), /access by others/);
    fixture.state.mode = 0o40750; fixture.state.owner = 12002;
    assert.throws(() => requireUserExecutionIdentity("alice"), /owned/);
    fixture.state.owner = 12001; fixture.state.groups = "alice docker";
    assert.throws(() => requireUserExecutionIdentity("alice"), /unprivileged/);
    fixture.state.groups = "alice"; fixture.state.groupIds = "12001 0";
    assert.throws(() => requireUserExecutionIdentity("alice"), /supplementary groups/);
    fixture.state.groupIds = "12001"; fixture.state.sudoAllowed = true;
    assert.throws(() => requireUserExecutionIdentity("alice"), /sudo policy/);
    fixture.state.sudoAllowed = false;
    for (const status of [0, 1]) {
      fixture.state.sudoPolicy = { status, output: "User alice is not allowed to run sudo on virtual-host.\n" };
      assert.equal(requireUserExecutionIdentity("alice").uid, 12001, `explicit denial with exit ${status} is accepted`);
    }
    for (const output of ["", "User bob is not allowed to run sudo on virtual-host.\n", "User alice may run the following commands: (ALL) ALL\n", "User alice is not allowed to run sudo on virtual-host.\n(ALL) ALL\n"]) {
      fixture.state.sudoPolicy = { status: 0, output };
      assert.throws(() => requireUserExecutionIdentity("alice"), /sudo policy/, "ambiguous, foreign or privileged output is rejected");
    }
    fixture.state.sudoPolicy = { status: 2, output: "User alice is not allowed to run sudo on virtual-host.\n" };
    assert.throws(() => requireUserExecutionIdentity("alice"), /sudo policy/, "unexpected failure is rejected");
    fixture.state.sudoPolicy = undefined; fixture.state.probe = "UNSAFE";
    assert.throws(() => requireUserExecutionIdentity("alice"), /shared DB/);
    fixture.state.probe = "ISOLATED";
    db.prepare("UPDATE user_workspace_access SET uid=0 WHERE user_id='alice'").run();
    assert.throws(() => requireUserExecutionIdentity("alice"), /no valid OS user mapping/);
    db.prepare("UPDATE user_workspace_access SET uid=12001 WHERE user_id='alice'").run();
    user("alias"); mapping("alias", "/isolated/alias", "alias", 12001);
    assert.equal(requireUserExecutionIdentity("alice").uid, 12001);
    assert.equal(requireUserExecutionIdentity("alias").uid, 12001);
    assert.ok(!fixture.state.probes.at(-1)?.paths.includes("/isolated/alice"));
    db.prepare("DELETE FROM users WHERE id='alias'").run();
    user("bob"); mapping("bob", "/isolated/alice/sub", "bob", 12002);
    assert.throws(() => requireUserExecutionIdentity("alice"), /distinct/);
    db.prepare("DELETE FROM users WHERE id='bob'").run();
    user("service"); mapping("service", "/isolated/service", "service", 12003);
    const originalGetuid = process.getuid;
    process.getuid = () => 12003;
    try { assert.throws(() => requireUserExecutionIdentity("service"), /service identity/); }
    finally { process.getuid = originalGetuid; }
    // Docker must not bypass missing/unsafe mappings.
    const mutable = config as unknown as { docker: boolean };
    mutable.docker = true;
    user("dockeruser");
    assert.throws(() => requireUserExecutionIdentity("dockeruser"), /no valid OS user mapping/);
    mutable.docker = false;
    // Windows names alone do not establish nonadmin isolation.
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try { assert.throws(() => ensureUserAccess("alice", "/isolated/alice", "root"), /Windows nonadmin isolation/); }
    finally { Object.defineProperty(process, "platform", platform); }
    assert.equal(requireUserExecutionIdentity("admin").uid, 0);
    // Root is a valid configured workspace, without provisioning/chown of the volume.
    const { resolveManagedWorkspaceRoot } = await import("../lib/user-access");
    const { getUserAgentCwd } = await import("../lib/mcp");
    assert.equal(resolveManagedWorkspaceRoot(" / "), "/");
    ensureUserAccess("admin", "/", "root");
    user("otheradmin", true);
    ensureUserAccess("otheradmin", "/", "root");
    assert.equal(requireUserExecutionIdentity("admin").workspaceRoot, "/");
    assert.equal(requireUserExecutionIdentity("otheradmin").workspaceRoot, "/");
    assert.equal(requireUserExecutionIdentity("alice").uid, 12001);
    assert.ok(!fixture.state.probes.at(-1)?.paths.includes("/"));
    const mkdir = t.mock.method(fs, "mkdirSync", () => undefined);
    const chown = t.mock.method(fs, "chownSync", () => undefined);
    assert.equal(getUserAgentCwd("admin"), "/");
    assert.equal(mkdir.mock.callCount(), 0);
    assert.equal(chown.mock.callCount(), 0);
    assert.throws(() => ensureUserAccess("alice", "/", "root"), /explicitly configured/);
    assert.equal(getUserAccess("alice").workspaceRoot, "/isolated/alice");
  } finally { fixture.restore(); }
});
