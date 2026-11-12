import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import {EventEmitter} from "node:events";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import path from "node:path";
import os from "node:os";
test("vault discovery supports older live engines and reprojects metadata only",async t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-vault-index-"));
 Object.assign(process.env,{AI_CHAT_INTERNAL_ORIGIN:"http://127.0.0.1:1",AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AI_CHAT_MCP_STATE_DIR:path.join(root,"state"),MCP_BEARER_TOKEN:"test-discovery-token",METIS_PROTECTED_LOGIN_MODE:"trusted-root",METIS_NATIVE_ISOLATION:"0",AI_CHAT_TEST_BYPASS_LEASE:"1",NODE_ENV:"test"});
 mkdirSync(path.join(root,"state"));writeFileSync(path.join(root,"state","registry.json"),JSON.stringify({version:1,servers:[]}));
 const auth=await import("../lib/auth"),store=await import("../lib/db-store"),jobs=await import("../lib/db-jobs");
 const owner=auth.createUser("vault-discovery-owner","synthetic-account-password"),chat=store.createChat("Vault index",undefined,owner.id);
 const job=jobs.enqueueJob({chatId:chat.id,userId:owner.id,message:"Test"});jobs.updateJob(job.id,{status:"running"});
 writeFileSync(path.join(root,"state","registry.json"),JSON.stringify({version:1,servers:[{id:"test-mcp",ownerId:owner.id,kind:"stdio",env:{PASSWORD:"SYNTHETIC-DO-NOT-RETURN"},enabled:false}]}));
 const {POST}=await import("../app/api/internal/mcp-credentials/route");
 let unavailable=false;
 t.mock.method(http,"request",(_options:any,callback:any)=>{
  const request:any=new EventEmitter();
  request.end=(text:string)=>queueMicrotask(()=>{
   if(unavailable){request.emit("error",new Error("SYNTHETIC-DO-NOT-RETURN"));return;}
   const input=JSON.parse(text);
   assert.equal(input.operation,"list");assert.equal(input.management,true);
   assert.equal(input.owner,owner.id);assert.equal(input.chat,chat.id);
   const reply:any=Object.assign(new EventEmitter(),{statusCode:200});
   callback(reply);reply.emit("data",Buffer.from(JSON.stringify({credentials:[{origin:"https://portal.test",password:"SYNTHETIC-DO-NOT-RETURN",envelope:"SYNTHETIC-DO-NOT-RETURN"}]})));reply.emit("end");
  });
  return request;
 });
 const req=()=>new Request("http://localhost/api/internal/mcp-credentials",{method:"POST",headers:{authorization:"Bearer test-discovery-token","content-type":"application/json","x-ai-chat-user-id":owner.id,"x-ai-chat-id":chat.id,"x-ai-chat-job-id":job.id},body:"{}"});
 try{
  const response=await POST(req());assert.equal(response.status,200);
  const full=await response.json();assert.equal(full.credentials.length,2);assert.equal(full.partial,undefined);assert(!JSON.stringify(full).includes("SYNTHETIC-DO-NOT-RETURN"));
  unavailable=true;
  const partial=await(await POST(req())).json();assert.equal(partial.partial,true);assert.deepEqual(partial.unavailable,["browser","console"]);assert.equal(partial.credentials.length,1);assert(!JSON.stringify(partial).includes("SYNTHETIC-DO-NOT-RETURN"));
 }finally{rmSync(root,{recursive:true,force:true});}
});
