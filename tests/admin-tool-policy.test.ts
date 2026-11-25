import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { hostApprovalScope } from "../lib/mcp-core/host-tool-approval.mjs";
import { settingsSearchEntries, visibleSettingsSections } from "../lib/settings-navigation";

const root = mkdtempSync(path.join(os.userInfo().homedir, ".metis-tool-policy-test-"));
const token = "synthetic-tool-policy-token";
Object.assign(process.env, {
  AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: root, CHAT_DATA_DIR: root, AGENT_CWD: root,
  CHAT_DB_PATH: path.join(root, "chat.sqlite"), AI_CHAT_MCP_STATE_DIR: path.join(root, "mcp"),
  AI_CHAT_INTERNAL_ORIGIN: "http://127.0.0.1:1", MCP_BEARER_TOKEN: token,
  METIS_AI_ADMIN_USERNAMES: "", CHAT_LEGACY_HEADER_AUTH: "false", CHAT_PASSWORD: "",
});
const dbs = import("../lib/sqlite");
test.after(async () => { (await dbs).getDatabase().close(); rmSync(root, { recursive: true, force: true }); });

test("Admin tile and search entry are not exposed to non-admins", () => {
  const id="settings-admin-tool-policy";
  assert.ok(settingsSearchEntries(true).some(entry => entry.id === id && entry.tab === "admin"));
  assert.ok(!settingsSearchEntries(false).some(entry => entry.id === id));
  assert.deepEqual(visibleSettingsSections("admin", false), []);
});

test("host policy applies at actual dispatch, keeps account boundaries and requires single-use approval", async (t) => {
  const [auth, {getDatabase}, store, jobs, admin, question, approval, approve, gateway] = await Promise.all([
    import("../lib/auth"), dbs, import("../lib/db-store"), import("../lib/db-jobs"),
    import("../app/api/admin/system/tool-policy/route"), import("../app/api/internal/mcp-question/route"),
    import("../app/api/internal/mcp-approval/route"), import("../app/api/chat/approval/route"),
    import("../lib/mcp-core/gateway-core.mjs"),
  ]);
  const me = os.userInfo();
  const password = "synthetic-fixture-password";
  const owner = auth.createUser("tool-policy-admin",password).id;
  const member = auth.createUser("tool-policy-member",password).id;
  getDatabase().prepare("UPDATE users SET is_admin=CASE WHEN id=? THEN 1 ELSE 0 END WHERE id IN (?,?)")
    .run(owner,owner,member);
  function cookie(name: string) {
    return "ai_chat_auth=" + auth.authenticateUser(name,password)!.token;
  }
  const ownerCookie=cookie("tool-policy-admin"), memberCookie=cookie("tool-policy-member");
  const origin="http://localhost";
  function req(who?:string, body?:unknown, from=origin) {
    return new Request(origin+"/api/admin/system/tool-policy",{
      ...(body===undefined?{}:{method:"PUT",body:JSON.stringify(body)}),
      headers:{...(who?{cookie:who}:{}), origin:from, "Content-Type":"application/json"},
    });
  }
  const initial={revision:0,rules:{terminal:"inherit",files:"inherit"}};
  assert.equal((await admin.GET(req())).status,401);
  assert.equal((await admin.GET(req(memberCookie))).status,403);
  assert.equal((await admin.PUT(req(memberCookie,initial))).status,403);
  assert.equal((await admin.PUT(req(ownerCookie,initial,"https://other.invalid"))).status,403);
  const before=await admin.GET(req(ownerCookie));
  assert.equal(before.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await before.json(),initial);
  assert.deepEqual(await (await admin.PUT(req(ownerCookie,initial))).json(),initial);
  assert.equal(getDatabase().prepare("SELECT 1 FROM meta WHERE key='host_tool_policy_v1'").get(),undefined);
  assert.equal((await admin.PUT(req(ownerCookie,{revision:0,rules:{terminal:"allow-all",files:"inherit"}}))).status,400);

  const chat=store.createChat("Policy fixture",undefined,owner);
  store.updateChat(chat.id,{runtimeMode:"full-access", approvedPatterns:["write_file:"]},owner);
  const job=jobs.enqueueJob({chatId:chat.id,userId:owner,message:"Synthetic fixture"});
  const lease=jobs.claimNextJob({workerId:"tool-policy-worker"})!;
  assert.equal(lease.id,job.id);
  t.after(() => jobs.updateJob(job.id,{status:"cancelled"}));
  const leaseHeaders={
    authorization:"Bearer "+token, "x-ai-chat-id":chat.id, "x-ai-chat-user-id":owner,
    "x-ai-chat-job-id":job.id, "x-ai-chat-worker-id":lease.leaseOwner!,
    "x-ai-chat-lease-token":lease.leaseToken!,
  };
  const questionUrl=origin+"/api/internal/mcp-question";
  assert.equal((await question.GET(new Request(questionUrl,{headers:leaseHeaders}))).status,200);
  const selected={revision:0,rules:{terminal:"block",files:"confirm"}};
  assert.equal((await admin.PUT(req(ownerCookie,selected))).status,200);
  assert.equal((await admin.PUT(req(ownerCookie,selected))).status,409);
  assert.equal((await question.GET(new Request(questionUrl,{headers:leaseHeaders}))).status,409,
               "old gateways cannot ignore an active policy");
  assert.equal((await question.GET(new Request(questionUrl,{headers:{...leaseHeaders,"x-ai-chat-user-id":member}}))).status,401);

  let creates=0, denied=false, changeWhileWaiting=false;
  t.mock.method(globalThis,"fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request=new Request(input,init);
    const url=new URL(request.url);
    if (url.pathname.endsWith("/mcp-question")) return question.GET(request);
    assert.ok(url.pathname.endsWith("/mcp-approval"), request.url);
    if (request.method==="POST") {
      creates++;
      const payload=await request.clone().json();
      assert.equal(payload.sessionScope,hostApprovalScope(1,payload.toolName,payload.args));
      return approval.POST(request);
    }
    const id=url.searchParams.get("id");
    if (id) {
      const respond=async (who:string,decision:string) => approve.POST(new Request(origin+"/api/chat/approval",{
        method:"POST",headers:{cookie:who},body:JSON.stringify({approvalId:id, decision}),
      }));
      assert.equal((await respond(memberCookie,"allow")).status,404);
      assert.equal(store.getChat(chat.id,owner)?.pendingApproval?.onceOnly,true);
      assert.equal((await respond(ownerCookie,denied?"deny":"allow-session")).status,200);
      if (changeWhileWaiting) {
        assert.equal((await admin.PUT(req(ownerCookie,{revision:1,rules:{terminal:"block",files:"block"}}))).status,200);
      }
    }
    return approval.GET(request);
  });
  const context={userId:owner,chatId:chat.id,jobId:job.id,
    workerId:lease.leaseOwner,leaseToken:lease.leaseToken,uid:me.uid,gid:me.gid,
    osUsername:me.username,home:me.homedir,workspaceRoot:root,isHostAdmin:true,allowRoot:true,runtimeMode:"full-access"};
  const call=(name:string,args:Record<string,unknown>,extra={})=>gateway.dispatchGatewayTool(name,args,{
    auditCall:false,context:{...context,...extra},
  });
  const target=path.join(root,"not-run.txt");
  const command=await call("execute_command",{cwd:root,command:"printf test > not-run.txt"});
  assert.match(JSON.stringify(command),/blocked by the host tool policy/i);
  assert.equal(existsSync(target),false);
  assert.equal(creates,0);

  const args={path:target,content:"synthetic approved content"};
  const auto=await call("write_file",args,{automation:true});
  assert.match(JSON.stringify(auto),/interactive host approval/);
  assert.equal(creates,0);
  denied=true;
  const rejected=await call("write_file",args);
  assert.match(JSON.stringify(rejected),/User denied this action/);
  assert.equal(existsSync(target),false);
  denied=false;
  await call("write_file",args);
  assert.equal(readFileSync(target,"utf8"),args.content);
  assert.equal(creates,2,"existing chat-wide approvals are not reused as host confirmation");
  assert.deepEqual(store.getChat(chat.id,owner)?.approvedPatterns,["write_file:"]);
  changeWhileWaiting=true;
  const changed=await call("write_file",{...args,content:"do not execute"});
  assert.match(JSON.stringify(changed),/Host tool policy changed/);
  assert.equal(readFileSync(target,"utf8"),args.content);
  assert.equal(creates,3);
});
