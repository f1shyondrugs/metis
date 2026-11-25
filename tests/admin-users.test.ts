import assert from "node:assert/strict";
import test from "node:test";
import { isolationFixture } from "./isolation-fixture";

const fixture = isolationFixture();
test("managed mappings reject unsafe creation/update atomically", async () => {
  try {
    const { createManagedUser, patchManagedUser, deleteManagedUser, listAdminUsers } = await import("../lib/admin-users");
    const { requireUserExecutionIdentity, getUserAccess } = await import("../lib/user-access");
    const { getDatabase } = await import("../lib/sqlite");
    const admin = createManagedUser({ username: "adminone", password: "password1", workspaceRoot: fixture.dir });
    assert.equal(admin.isAdmin, true);
    assert.throws(() => patchManagedUser(admin.id, { isAdmin: false }), /last admin/);
    assert.throws(() => deleteManagedUser(admin.id, "other"), /last admin/);
    const count = listAdminUsers().length;
    const create = (username: string, workspaceRoot?: string, osUsername?: string) =>
      createManagedUser({ username, password: "password1", workspaceRoot, osUsername });
    assert.throws(() => create("unmapped"), /isolated unprivileged/);
    assert.equal(listAdminUsers().length, count);
    assert.throws(() => create("missing", "/isolated/alice", "no-such-user"), /does not exist/);
    assert.throws(() => create("rootbind", "/root/virtual-metis", "root"), /explicitly configured/);
    const alice = create("aliceweb", "/isolated/alice", "alice");
    assert.equal(requireUserExecutionIdentity(alice.id).uid, 12001);
    const alias = create("aliasweb", "/isolated/alice", "alias");
    const shared = create("sharedweb", "/isolated/alice", "alice");
    assert.equal(requireUserExecutionIdentity(alias.id).uid, 12001);
    assert.equal(requireUserExecutionIdentity(shared.id).uid, 12001);
    assert.equal(getUserAccess(shared.id).workspaceRoot, "/isolated/alice");
    assert.ok(!fixture.state.probes.at(-1)?.paths.includes("/isolated/alice"), "same-identity workspaces are shared");
    fixture.state.owner = 12002;
    assert.throws(() => create("samews", "/isolated/alice", "bob"), /distinct/);
    assert.throws(() => create("nestedws", "/isolated/alice/project", "bob"), /distinct/);
    fixture.state.alias = "/isolated/alice";
    assert.throws(() => create("symlinkws", "/isolated/link", "bob"), /distinct/);
    fixture.state.alias = "";
    const bob = create("bobweb", "/isolated/bob", "bob");
    const previous = getUserAccess(bob.id);
    const hash = () => (getDatabase().prepare("SELECT password_hash AS hash FROM users WHERE id=?").get(bob.id) as { hash: string }).hash;
    const previousHash = hash();
    assert.throws(() => patchManagedUser(bob.id, { password: "newpassword", workspaceRoot: "/isolated/alice" }), /distinct/);
    assert.equal(hash(), previousHash, "failed mapping update rolls back password too");
    assert.deepEqual(getUserAccess(bob.id), previous);
    assert.throws(() => patchManagedUser(bob.id, { osUsername: null }), /isolated unprivileged/);
    fixture.state.owner = 12001;
    patchManagedUser(bob.id, { osUsername: "alice", workspaceRoot: "/isolated/alice" });
    assert.equal(requireUserExecutionIdentity(bob.id).uid, 12001);
    fixture.state.owner = 12002;
    patchManagedUser(bob.id, { osUsername: "bob", workspaceRoot: "/isolated/bob" });
    assert.equal(requireUserExecutionIdentity(bob.id).uid, 12002);
    assert.throws(() => deleteManagedUser(bob.id, bob.id), /own account/);
    // Demotion keeps the existing owner-controlled home even with group read/search.
    fixture.state.mode = 0o40750;
    const groupReadable = createManagedUser({ username: "groupreadable", password: "password1", isAdmin: true,
      workspaceRoot: "/isolated/bob", osUsername: "bob" });
    assert.equal(patchManagedUser(groupReadable.id, { isAdmin: false })?.isAdmin, false);
    assert.equal(getUserAccess(groupReadable.id).workspaceRoot, "/isolated/bob");
    assert.equal(requireUserExecutionIdentity(groupReadable.id).uid, 12002);
    patchManagedUser(groupReadable.id, { isAdmin: true });
    for (const mode of [0o40770, 0o40755]) {
      fixture.state.mode = mode;
      assert.throws(() => patchManagedUser(groupReadable.id, { isAdmin: false }), /Nonadmin workspace/);
      assert.equal(listAdminUsers().find((user) => user.id === groupReadable.id)?.isAdmin, true);
    }
    fixture.state.mode = 0o40750;
    fixture.state.owner = 12001;
    assert.throws(() => patchManagedUser(groupReadable.id, { isAdmin: false }), /owned by its OS identity/);
    assert.equal(listAdminUsers().find((user) => user.id === groupReadable.id)?.isAdmin, true);
    fixture.state.mode = 0o40700;
    fixture.state.owner = 12002;
    const secondAdmin = createManagedUser({ username: "secondadmin", password: "password1", isAdmin: true, workspaceRoot: "/" });
    assert.equal(getUserAccess(secondAdmin.id).workspaceRoot, "/");
    assert.equal(requireUserExecutionIdentity(bob.id).uid, 12002, "admin / does not block scoped accounts");
    assert.ok(!fixture.state.probes.at(-1)?.paths.includes("/"));
    assert.throws(() => patchManagedUser(secondAdmin.id, { isAdmin: false }), /isolated unprivileged/);
    assert.equal(listAdminUsers().find(user => user.id === secondAdmin.id)?.isAdmin, true);
    // A single transaction may replace the privileged mapping while demoting.
    deleteManagedUser(bob.id, admin.id);
    patchManagedUser(secondAdmin.id, { isAdmin: false, osUsername: "bob", workspaceRoot: "/isolated/bob" });
    assert.equal(requireUserExecutionIdentity(secondAdmin.id).uid, 12002);
  } finally { fixture.restore(); }
});
