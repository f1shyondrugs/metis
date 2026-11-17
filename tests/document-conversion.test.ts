import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {randomUUID} from "node:crypto";
import type {ConversionSource,DocumentKind} from "../lib/document-conversion-types";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-conversion-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root,METIS_AI_BOOTSTRAP_PASSWORD:"",CHAT_LEGACY_HEADER_AUTH:"false"});
const modules=Promise.all([import("../lib/auth"),import("../lib/db-store"),import("../lib/shared-context"),import("../lib/sqlite"),import("../app/api/documents/convert/route")]);
test.after(async()=>{const[,,,sqlite]=await modules;sqlite.getDatabase().close();rmSync(root,{recursive:true,force:true});});
const rich='# Heading\r\n\r\n- [x] Task\n\n~~~metis-block\n{"version":1,"type":"paragraph","attrs":{"color":"red"},"content":[{"type":"text","text":"Keep me"}]}\n~~~\n\n[Link](https://example.com)\n';
async function fixture(){
 const[auth,store,notes]=await modules;
 const username="conversion-"+randomUUID();const owner=auth.createUser(username,"synthetic-test-password");
 const token=auth.authenticateUser(username,"synthetic-test-password")!.token;
 const chat=store.createChat("Source",undefined,owner.id);const now=new Date().toISOString();
 const workspace={id:randomUUID(),type:"canvas" as const,name:"Full title",content:rich,version:2,createdAt:now,updatedAt:now};
 store.updateChat(chat.id,{workspaces:[workspace]},owner.id);
 const note=notes.createNote({ownerId:owner.id,kind:"note",title:"Full title",content:rich,icon:"lucide:code"});
 return {owner,token,chat,workspace,note};
}
function request(body:unknown,token?:string,origin="http://localhost"){return new Request("http://localhost/api/documents/convert",{method:"POST",headers:{"content-type":"application/json",origin,...(token?{cookie:"ai_chat_auth="+token}:{})},body:JSON.stringify(body)});}
test("all six conversions preserve exact Markdown and originals, and duplicate retries return the same target",async()=>{
 const[,store,notes,,api]=await modules;const f=await fixture();
 for(const sourceKind of ["canvas","plan","note"] as const){
  if(sourceKind==="plan")store.updateChat(f.chat.id,{workspaces:[{...f.workspace,type:"plan"}]},f.owner.id);
  const source:ConversionSource=sourceKind==="note"?{kind:"note",id:f.note.id,title:f.note.title,content:rich,version:1}:{kind:sourceKind,id:f.workspace.id,chatId:f.chat.id,title:f.workspace.name,content:rich,version:2};
  for(const target of (["canvas","plan","note"] as DocumentKind[]).filter(k=>k!==sourceKind)){
   const input={source,target,requestId:randomUUID()};
   const response=await api.POST(request(input,f.token));assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
   assert.equal(response.headers.get("cache-control"),"private, no-store");
   const result=await response.json();assert.equal(result.kind,target);
   assert.equal((result.note||result.workspace).content,rich);
   assert.equal((result.note||result.workspace)[target==="note"?"title":"name"].startsWith("Full title"),true);
   const retry=await api.POST(request(input,f.token));assert.equal(retry.status,200);assert.deepEqual(await retry.json(),result);
   assert.equal(notes.getNote(f.note.id,f.owner.id)!.archived,false);assert.equal(notes.getNote(f.note.id,f.owner.id)!.content,rich);
   assert.equal(store.getChat(f.chat.id,f.owner.id)!.workspaces!.find(w=>w.id===f.workspace.id)!.content,rich);
  }
 }
});
test("authentication, origin and source account boundaries are enforced",async()=>{
 const[,,, ,api]=await modules;const f=await fixture(),other=await fixture();const body={source:{kind:"note",id:f.note.id,version:1,title:"Note",content:rich},target:"canvas",requestId:randomUUID()};
 assert.equal((await api.POST(request(body))).status,401);
 assert.equal((await api.POST(request(body,f.token,"https://foreign.test"))).status,403);
 assert.equal((await api.POST(request(body,other.token))).status,404);
});
test("stale versions, missing sources, unsupported kinds and over-limit content do not create targets",async()=>{
 const[,store,notes,sqlite,api]=await modules;const f=await fixture();const before=(sqlite.getDatabase().prepare("SELECT count(*) AS n FROM chats").get() as {n:number}).n;
 const source={kind:"note",id:f.note.id,version:2,title:"Note",content:rich};
 assert.equal((await api.POST(request({source,target:"canvas",requestId:randomUUID()},f.token))).status,409);
 assert.equal((await api.POST(request({source:{...source,version:1,id:"missing"},target:"plan",requestId:randomUUID()},f.token))).status,404);
 assert.equal((await api.POST(request({source:{...source,version:1},target:"note",requestId:randomUUID()},f.token))).status,400);
 const workspaceSource={kind:"canvas",chatId:f.chat.id,id:f.workspace.id,version:2,title:"Large",content:"x".repeat(50001)};
 assert.equal((await api.POST(request({source:workspaceSource,target:"note",requestId:randomUUID()},f.token))).status,413);
 assert.equal((await api.POST(request({source:{...source,version:1,content:"x".repeat(100001)},target:"plan",requestId:randomUUID()},f.token))).status,413);
 const issuebook=notes.createNote({ownerId:f.owner.id,kind:"issuebook",title:"Issues",content:""});
 assert.equal((await api.POST(request({source:{...source,version:1,id:issuebook.id},target:"plan",requestId:randomUUID()},f.token))).status,400);
 assert.equal((sqlite.getDatabase().prepare("SELECT count(*) AS n FROM chats").get() as {n:number}).n,before);
 assert.equal(store.getChat(f.chat.id,f.owner.id)!.workspaces!.length,1);
});
test("request IDs cannot be rebound to another document or target",async()=>{
 const[,,,,api]=await modules;const f=await fixture();const body={source:{kind:"note",id:f.note.id,version:1,title:"Note",content:rich},target:"canvas",requestId:randomUUID()};
 assert.equal((await api.POST(request(body,f.token))).status,200);
 assert.equal((await api.POST(request({...body,target:"plan"},f.token))).status,409);
});
test("workspace limit failures preserve the original",async()=>{
 const[,store,,,api]=await modules;const f=await fixture();store.updateChat(f.chat.id,{workspaces:Array.from({length:20},(_,i)=>({...f.workspace,id:i?randomUUID():f.workspace.id,name:"Document "+i}))},f.owner.id);
 const body={source:{kind:"canvas",chatId:f.chat.id,id:f.workspace.id,version:2,title:"Title",content:rich},target:"plan",requestId:randomUUID()};
 assert.equal((await api.POST(request(body,f.token))).status,409);assert.equal(store.getChat(f.chat.id,f.owner.id)!.workspaces!.length,20);
});
