import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,readFileSync,existsSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomBytes} from "node:crypto";
import http from "node:http";
import {EventEmitter} from "node:events";

test("manual SSH/local entries persist, reuse exact console bindings and expose only owner metadata",async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),"metis-vault-console-"));
 Object.assign(process.env,{AI_CHAT_ROOT:dir,CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"chat.sqlite"),AGENT_CWD:dir,METIS_PROTECTED_LOGIN_MODE:"trusted-root",METIS_NATIVE_ISOLATION:"0",MCP_BEARER_TOKEN:"TEST-VAULT-LEASE"});
 const [{SavedBrowserLogins},auth,route,jobs,store,agent]=await Promise.all([
  import("../services/browser-login/core"),import("../lib/auth"),import("../app/api/browser/saved-logins/route"),import("../lib/db-jobs"),import("../lib/db-store"),import("../app/api/internal/mcp-credentials/route"),
 ]);
 const key=randomBytes(32),file=path.join(dir,"vault.sqlite");
 let core=new SavedBrowserLogins(key,file),fingerprint="SHA256:synthetic-original";
 const filled:string[]=[],calls:string[]=[];
 let serial=0;
 const describe=(value:Record<string,unknown>)=>{
  const method=value.method,user=value.user,host=method==="ssh"?String(value.host).toLowerCase():"metis-host",port=method==="ssh"?value.port??22:0,authUser=method==="sudo"?"metis-console":user,fp=method==="ssh"?fingerprint:"local";
  return {target:JSON.stringify([method,host,port,authUser,user,fp]),label:String(method)+": "+String(authUser)+"@"+host};
 };
 t.mock.method(http,"request",(_options:unknown,callback:(response:EventEmitter&{statusCode?:number})=>void)=>{
  const request=new EventEmitter() as EventEmitter&{end:(body:string)=>void};
  request.end=raw=>{void(async()=>{
   const payload=JSON.parse(raw);calls.push(payload.operation);let result:unknown,status=200;
   try{
    if(payload.operation==="describe")result=describe(payload.input);
    else if(payload.operation==="prepare"){const d=describe(payload.input);result={...d,status:"input_required",sessionId:"test-session",secureInput:{requestId:"test-"+(++serial),origin:d.label,kind:"console",expiresAt:new Date(Date.now()+60000).toISOString()}};}
    else if(payload.operation==="fill"){filled.push(payload.input.password);result={status:"password_entered"};}
    else result=await core.dispatch(payload,payload.management===true);
   }catch(error){const {protectedLoginFailure}=await import("../lib/protected-login-errors");result=protectedLoginFailure(error);status=400;}
   const response=Object.assign(new EventEmitter(),{statusCode:status});callback(response);response.emit("data",Buffer.from(JSON.stringify(result)));response.emit("end");
  })();};return request;
 });
 const a=auth.createUser("console-owner","TEST-ACCOUNT"),b=auth.createUser("console-other","TEST-ACCOUNT");
 const cookie="ai_chat_auth="+auth.authenticateUser(a.username,"TEST-ACCOUNT")!.token;
 const req=(body:unknown,identity=cookie)=>new Request("https://metis.test/api/browser/saved-logins",{method:"POST",headers:{cookie:identity,origin:"https://metis.test",host:"metis.test","content-type":"application/json"},body:JSON.stringify(body)});
 const call=(operation:string,input:Record<string,unknown>={},owner=a.id,chat="other-chat")=>core.dispatch({owner,chat,operation,input},false);
 try{
  const connection={method:"ssh",host:"Host.Test",port:2222,user:"root"},password="SYNTHETIC-SSH-SECRET";
  const inspection=await route.POST(req({action:"inspect",connection}));assert.equal(inspection.status,200);
  const checked=await inspection.json();assert.equal(calls.filter(op=>op==="prepare").length,0,"inspection never opens an authenticated console");
  const create={action:"create",kind:"console",connection,target:checked.target,password};
  assert.equal((await route.POST(req(create))).status,200);
  assert.equal((await route.POST(req({...create,password:"DO-NOT-OVERWRITE"}))).status,409);
  assert.equal((await call("console_prepare",connection)).status,"console_password_entered");assert.equal(filled.at(-1),password);
  assert.equal((await call("console_prepare",connection,b.id)).status,"input_required");
  assert.equal((await call("console_prepare",{...connection,host:"other.test"})).status,"input_required");
  fingerprint="SHA256:changed";
  assert.equal((await call("console_prepare",connection)).status,"input_required","changed host keys never reuse the old password");
  assert.equal((await route.POST(req(create))).status,409,"a changed key invalidates an inspected draft");
  fingerprint="SHA256:synthetic-original";
  for(const method of ["su","sudo"]){
   const connection={method,user:"root"},checked=await (await route.POST(req({action:"inspect",connection}))).json();
   assert.equal((await route.POST(req({action:"create",kind:"console",connection,target:checked.target,password:"SYNTHETIC-"+method}))).status,200);
   assert.equal((await call("console_prepare",connection)).status,"console_password_entered");
   assert.equal(filled.at(-1),"SYNTHETIC-"+method);
  }
  const listed=await call("vault_list");
  assert.equal(listed.credentials?.length,3);assert.deepEqual((await call("vault_list",{},b.id)).credentials,[]);
  assert(!JSON.stringify(listed).includes("SYNTHETIC-"),"metadata listing never returns passwords");
  assert.equal((await route.POST(req({action:"update",kind:"console",origin:create.target,password:"SYNTHETIC-UPDATED"}))).status,200);
  assert.equal((await call("console_prepare",connection)).status,"console_password_entered");assert.equal(filled.at(-1),"SYNTHETIC-UPDATED");
  await core.close();core=new SavedBrowserLogins(key,file);
  assert.equal((await call("console_prepare",connection)).status,"console_password_entered");assert.equal(filled.at(-1),"SYNTHETIC-UPDATED","permanent entries survive service restart");
  for(const name of [file,file+"-wal"])if(existsSync(name))assert(!readFileSync(name).includes(Buffer.from("SYNTHETIC-SSH-SECRET")));
  await assert.rejects(call("inspect_console",{connection}));
  await assert.rejects(call("create",create));
  const chat=store.createChat("Vault use",undefined,a.id),job=jobs.enqueueJob({chatId:chat.id,userId:a.id,message:"TEST"}),lease=jobs.claimNextJob({workerId:"vault-worker"})!;
  const agentReq=(owner:string=a.id,chatId:string=chat.id,body:unknown={})=>new Request("http://localhost/internal",{method:"POST",headers:{authorization:"Bearer TEST-VAULT-LEASE","content-type":"application/json","x-ai-chat-job-id":job.id,"x-ai-chat-worker-id":lease.leaseOwner!,"x-ai-chat-lease-token":lease.leaseToken!,"x-ai-chat-user-id":owner,"x-ai-chat-id":chatId},body:JSON.stringify(body)});
  const valid=await agent.POST(agentReq());assert.equal(valid.status,200);assert.equal((await valid.json()).credentials.length,3);assert.equal(valid.headers.get("cache-control"),"no-store");
  for(const [owner,chatId] of [[b.id,chat.id],[a.id,"another-chat"]])assert.equal((await agent.POST(agentReq(owner,chatId))).status,401);
  assert.equal((await agent.POST(agentReq(a.id,chat.id,{owner:b.id}))).status,503);
  jobs.updateJob(job.id,{status:"cancelled"});assert.equal((await agent.POST(agentReq())).status,401);
  assert.equal((await route.POST(req({action:"delete",kind:"console",origin:create.target}))).status,200);
  assert.equal((await call("console_prepare",connection)).status,"input_required");
 }finally{await core.close();rmSync(dir,{recursive:true,force:true});}
});
