import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-native-root-setup-"));
const rootHome = os.userInfo().homedir;
Object.assign(process.env, {
  CHAT_DATA_DIR: dataDir, CHAT_DB_PATH: path.join(dataDir, "test.sqlite"),
  AI_CHAT_ROOT: dataDir, AGENT_CWD: dataDir,
  CHAT_LEGACY_HEADER_AUTH: "false",
});
delete process.env.AI_CHAT_ALLOW_ROOT_AGENTS;
delete process.env.AI_CHAT_SETUP_TOKEN;
delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;

test("native root default supports first admin discovery, bootstrap and execution identity",
  {skip:process.platform !== "linux" || process.getuid?.() !== 0}, async t => {
    const { GET, POST } = await import("../app/api/setup/route");
    const tokens = await import("../lib/setup-token");
    const { getDatabase } = await import("../lib/sqlite");
    const { getUserExecutionIdentity, ensureUserAccess } = await import("../lib/user-access");
    const db = getDatabase();
    tokens.initializeSetupToken();
    const secret = readFileSync(tokens.setupTokenFile, "utf8").trim();
    const post = (body:object) => POST(new Request("http://localhost/api/setup", {
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
    }));
    await t.test("root is listed only after operator authentication", async () => {
      assert.deepEqual((await (await GET(new Request("http://localhost/api/setup"))).json()).osUsers, []);
      assert.equal((await post({action:"os-users",setupToken:"wrong"})).status,403);
      const response = await post({action:"os-users",setupToken:secret});
      assert.equal(response.status,200);
      const body = await response.json();
      assert.ok(body.osUsers.some((u:{username:string})=>u.username===os.userInfo().username));
      assert.equal(body.suggestedOsUsername,"");
      assert.equal(tokens.validSetupToken(secret),true);
    });
    let adminId="";
    await t.test("first admin can select root even when the installer starts in another directory", async () => {
      const response = await post({action:"bootstrap",setupToken:secret,
        username:"rootoperator",password:"isolated-test-password",osUsername:os.userInfo().username});
      assert.equal(response.status,201);
      const body = await response.json();
      adminId=body.user.id;
      assert.equal(body.user.isAdmin,true);
      assert.equal(body.user.osUsername,os.userInfo().username);
      const identity = getUserExecutionIdentity(adminId);
      assert.equal(identity?.uid,0);
      assert.equal(identity?.workspaceRoot,path.resolve(rootHome));
      assert.equal(tokens.validSetupToken(secret),false);
    });
    await t.test("root default still rejects workspaces outside the root home", () => {
      assert.throws(()=>ensureUserAccess(adminId,dataDir,os.userInfo().username),/Root agent execution is disabled/);
      assert.equal(getUserExecutionIdentity(adminId)?.workspaceRoot,path.resolve(rootHome));
    });
    await t.test("root default does not grant root execution to a nonadmin", () => {
      db.prepare("UPDATE users SET is_admin=0 WHERE id=?").run(adminId);
      assert.throws(()=>getUserExecutionIdentity(adminId),/Root agent execution is disabled/);
      db.prepare("UPDATE users SET is_admin=1 WHERE id=?").run(adminId);
      assert.equal(getUserExecutionIdentity(adminId)?.uid,0);
    });
  });
