import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,readFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
const data=mkdtempSync(path.join(os.tmpdir(),"metis-setup-deferred-os-"));
Object.assign(process.env,{CHAT_DATA_DIR:data,CHAT_DB_PATH:path.join(data,"test.sqlite"),AI_CHAT_ROOT:data,
 AGENT_CWD:os.homedir(),AI_CHAT_ALLOW_ROOT_AGENTS:"false",CHAT_LEGACY_HEADER_AUTH:"false"});
delete process.env.AI_CHAT_SETUP_TOKEN;delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;
test("admin-only setup can defer a disallowed inferred root identity without granting execution",
 {skip:process.platform!=="linux"||process.getuid?.()!==0},async()=>{
 const {POST}=await import("../app/api/setup/route");
 const tokens=await import("../lib/setup-token");
 const {getDatabase}=await import("../lib/sqlite");
 const {getUserAccess,getUserExecutionIdentity,requireUserExecutionIdentity}=await import("../lib/user-access");
 const {CHAT_COOKIE}=await import("../lib/auth");
 const db=getDatabase();tokens.initializeSetupToken();
 // Synthetic isolated DB/token, never a live operator credential.
 const token=readFileSync(tokens.setupTokenFile,"utf8").trim();
 const post=(body:object,cookie?:string)=>POST(new Request("http://localhost/api/setup",{method:"POST",
 headers:{"Content-Type":"application/json",...(cookie?{cookie}:{})},body:JSON.stringify(body)}));
 const response=await post({action:"bootstrap",setupToken:token,username:"testadmin",password:"isolated-password"});
 assert.equal(response.status,201);const body=await response.json();
 assert.equal(body.user.isAdmin,true);assert.equal(body.hasProvider,false);
 assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM users").get() as {n:number}).n),1);
 assert.equal(getUserAccess(body.user.id).osUsername,null);
 assert.equal(getUserExecutionIdentity(body.user.id),undefined);
 assert.throws(()=>requireUserExecutionIdentity(body.user.id),/OS user mapping/);
 assert.equal(tokens.validSetupToken(token),false);
 assert.equal((await post({action:"complete"})).status,401);
 const cookie=response.headers.get("set-cookie")!.split(";")[0];assert(cookie.startsWith(CHAT_COOKIE+"="));
 assert.equal((await post({action:"complete"},cookie)).status,200);
 assert.equal((await post({action:"bootstrap",setupToken:token,username:"secondadmin",password:"isolated-password"})).status,409);
});
