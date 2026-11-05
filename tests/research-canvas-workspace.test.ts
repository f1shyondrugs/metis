import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const directory=mkdtempSync(path.join(os.tmpdir(),"metis-report-canvas-"));
Object.assign(process.env,{AI_CHAT_ROOT:directory,CHAT_DATA_DIR:directory,CHAT_DB_PATH:path.join(directory,"chat.sqlite"),AGENT_CWD:directory,MCP_BEARER_TOKEN:"report-canvas-test-token"});
for(const key of ["AI_CHAT_JOB_ID","AI_CHAT_WORKER_ID","AI_CHAT_JOB_LEASE_TOKEN"])delete process.env[key];
const loaded=Promise.all([import("../lib/auth"),import("../lib/db-store"),import("../lib/db-jobs"),import("../lib/sqlite"),import("../app/api/internal/mcp-workspace/route")]);
let ownerId:string,foreignId:string;
test.before(async()=>{const[auth]=await loaded;ownerId=auth.createUser("report-canvas-owner","test-password").id;foreignId=auth.createUser("report-canvas-foreign","test-password").id;});
test.after(async()=>{(await loaded)[3].getDatabase().close();rmSync(directory,{recursive:true,force:true});});
async function fixture(){
 const[,store,jobs,,api]=await loaded;
 const chat=store.createChat("Research report",undefined,ownerId);
 const job=jobs.enqueueJob({chatId:chat.id,userId:ownerId,message:"Research report",modeId:"deep-research"});
 const lease=jobs.claimNextJob({workerId:"canvas-worker-"+job.id})!;
 assert.equal(lease.id,job.id);
 const headers={"content-type":"application/json",authorization:"Bearer report-canvas-test-token","x-ai-chat-id":chat.id,"x-ai-chat-user-id":ownerId,"x-ai-chat-job-id":job.id,"x-ai-chat-worker-id":lease.leaseOwner!,"x-ai-chat-lease-token":lease.leaseToken!};
 const call=(body:unknown,changes:Record<string,string>={})=>api.POST(new Request("http://fixture/api/internal/mcp-workspace",{method:"POST",headers:{...headers,...changes},body:JSON.stringify(body)}));
 return{chat,job,jobs,store,headers,call,close:()=>{if(jobs.getJob(job.id)?.status!=="cancelled")jobs.updateJob(job.id,{status:"completed"});}};
}
const report=(content="Full research report")=>({action:"research_report",type:"canvas",title:"Complete report",content});
test("report canvas stores the complete long report and stable run key without granting arbitrary workspace identity",async()=>{
 const current=await fixture();try{
  const content="# Research\n"+"évidence ".repeat(18000)+"\nREPORT_END";
  assert.ok(content.length>100000);assert.ok(Buffer.byteLength(content)<500000);
  const first=await current.call({...report(content),idempotencyKey:"caller-chosen-key"});assert.equal(first.status,200);const body=await first.json();
  assert.equal(body.type,"canvas");assert.equal(body.workspaceLink,"workspace://canvas/"+body.id);
  assert.equal(body.idempotencyKey,current.job.id+":research_report");assert.equal(body.content,content);
  const stored=current.store.getChat(current.chat.id,ownerId)!.workspaces!;assert.equal(stored.length,1);assert.equal(stored[0].content,content);
  const retry=await current.call({...report("Different retry content"),title:"Different title",idempotencyKey:"another-key"});assert.equal(retry.status,200);assert.deepEqual(await retry.json(),body);
  assert.equal(current.store.getChat(current.chat.id,ownerId)!.workspaces!.length,1);
 }finally{current.close();}
});
test("a retry recovers the persisted report Canvas after its response cache is lost",async()=>{
 const current=await fixture();try{
  const first=await(await current.call(report("Durable report"))).json();
  const db=(await loaded)[3].getDatabase();
  const removed=db.prepare("DELETE FROM idempotency_keys WHERE key=? AND chat_id=? AND owner_id=?").run(current.job.id+":research_report",current.chat.id,ownerId);assert.equal(removed.changes,1);
  const retry=await current.call({...report("Retry must not overwrite the report"),title:"Different retry title"});assert.equal(retry.status,200);const restored=await retry.json();
  assert.equal(restored.id,first.id);assert.equal(restored.workspaceLink,first.workspaceLink);assert.equal(restored.content,"Durable report");
  assert.equal(current.store.getChat(current.chat.id,ownerId)!.workspaces!.length,1);
 }finally{current.close();}
});
test("a cached report response cannot advertise or recreate a deleted Canvas",async()=>{
 const current=await fixture();try{
  const first=await(await current.call(report())).json();assert.ok(first.id);
  current.store.updateChat(current.chat.id,{workspaces:[]},ownerId);
  const retry=await current.call(report());assert.equal(retry.status,404);assert.match((await retry.json()).error,/no longer exists/);
  assert.equal(current.store.getChat(current.chat.id,ownerId)!.workspaces!.length,0);
 }finally{current.close();}
});
test("the report idempotency key is reserved without changing ordinary canvas retries",async()=>{
 const current=await fixture();try{
  const normal=await current.call({type:"canvas",title:"Normal canvas",content:"Normal",idempotencyKey:current.job.id+":research_report"});assert.equal(normal.status,400);assert.match((await normal.json()).error,/reserved/);
  const ordinary=await(await current.call({type:"canvas",title:"Normal canvas",content:"Normal",idempotencyKey:"ordinary-key"})).json();
  const ordinaryRetry=await(await current.call({type:"canvas",title:"Normal canvas",content:"Normal",idempotencyKey:"ordinary-key"})).json();assert.equal(ordinaryRetry.id,ordinary.id);
  const created=await current.call(report());assert.equal(created.status,200);const canvas=await created.json();assert.notEqual(canvas.id,ordinary.id);assert.equal(canvas.content,"Full research report");
  const invalidEdit=await current.call({action:"edit",type:"canvas",id:ordinary.id,content:"Unexpected change",idempotencyKey:current.job.id+":research_report"});assert.equal(invalidEdit.status,400);
  assert.equal(current.store.getChat(current.chat.id,ownerId)!.workspaces!.length,2);
  assert.equal(current.store.getChat(current.chat.id,ownerId)!.workspaces!.find(item=>item.id===ordinary.id)!.content,"Normal");
 }finally{current.close();}
});
test("report canvas rejects missing auth, invalid lease, wrong account/chat, and Incognito",async()=>{
 const current=await fixture();try{
  assert.equal((await current.call(report(),{authorization:""})).status,401);
  assert.equal((await current.call(report(),{"x-ai-chat-lease-token":"wrong"})).status,409);
  assert.equal((await current.call(report(),{"x-ai-chat-user-id":foreignId})).status,403);
  assert.equal((await current.call(report(),{"x-ai-chat-id":"other-chat"})).status,403);
  assert.equal((await current.call(report(),{"x-ai-chat-incognito":"1"})).status,403);
  assert.equal(current.store.getChat(current.chat.id,ownerId)!.workspaces?.length||0,0);
 }finally{current.close();}
});
test("report title/type and the 500000-byte UTF-8 boundary are validated before persistence",async()=>{
 const current=await fixture();try{
  for(const body of [{...report(),type:"plan"},{...report(),title:""},{...report(),title:"x".repeat(201)},report(""),report("a".repeat(500001)),report("ä".repeat(250001))])assert.equal((await current.call(body)).status,400);
  assert.equal(current.store.getChat(current.chat.id,ownerId)!.workspaces?.length||0,0);
  const accepted=await current.call(report("ä".repeat(250000)));assert.equal(accepted.status,200);assert.equal((await accepted.json()).content.length,250000);
 }finally{current.close();}
});
test("editing an existing report preserves long text and rejects oversized changes",async()=>{
 const current=await fixture();try{
  const first=await(await current.call(report())).json();
  const content="Revised evidence. ".repeat(9000)+"EDIT_END";assert.ok(content.length>100000);
  const edited=await current.call({action:"edit",type:"canvas",id:first.id,content});assert.equal(edited.status,200);assert.equal((await edited.json()).content,content);
  const oversized=await current.call({action:"edit",type:"canvas",id:first.id,content:"ä".repeat(250001)});assert.equal(oversized.status,400);
  assert.equal(current.store.getChat(current.chat.id,ownerId)!.workspaces!.find(item=>item.id===first.id)!.content,content);
 }finally{current.close();}
});
test("legacy gateway file-shaped research requests create the same Canvas without an attachment",async()=>{
 const current=await fixture();try{
  const auth=(await loaded)[0];const legacy=await import("../app/api/internal/mcp-file/route");const exports=await import("../app/api/workspace-export/route");
  current.store.appendMessage(current.chat.id,{id:"legacy-report-assistant",role:"assistant",content:"Research in progress"},""+ownerId);
  const content="# Complete legacy report\n"+"Evidence with citations. ".repeat(6000)+"\nLEGACY_END";assert.ok(content.length>100000);
  const send=(changes:Record<string,string>={})=>legacy.POST(new Request("http://fixture/api/internal/mcp-file",{method:"POST",headers:{...current.headers,...changes},body:JSON.stringify({researchReport:{title:"Legacy report",content}})}));
  const response=await send();assert.equal(response.status,200);const artifact=await response.json();
  assert.equal(artifact.type,"canvas");assert.equal(artifact.canvasId,artifact.id);assert.equal(artifact.workspaceLink,"workspace://canvas/"+artifact.id);assert.equal(artifact.markdown,"[Open report in Canvas]("+artifact.workspaceLink+")");
  assert.equal(artifact.attachment,undefined);assert.equal(artifact.downloadUrl,artifact.workspaceLink);assert.equal(artifact.content,undefined);assert.ok(JSON.stringify(artifact).length<1500);
  const saved=current.store.getChat(current.chat.id,ownerId)!;const canvas=saved.workspaces!.find(item=>item.id===artifact.id)!;assert.equal(canvas.content,content);assert.equal(saved.messages[0].attachments?.length||0,0);
  assert.equal((await(await send()).json()).canvasId,artifact.id);assert.equal(current.store.getChat(current.chat.id,ownerId)!.workspaces!.length,1);
  // The old runtime projects only this field into its persisted tracker. Exercise
  // real SQL page compaction, where the top-level artifact may be truncated away.
  const oldSnapshot={kind:"research-progress" as const,runId:current.job.id,title:"Legacy report",language:"en",status:"report_attached",plan:["Read","Report"],steps:[{id:1,content:"Read",status:"completed"},{id:2,content:"Report",status:"completed"}],sourceTarget:1,minimumWords:500,discoveredCount:1,openedCount:1,readCount:1,blockedCount:0,failedCount:0,downloadUrl:artifact.downloadUrl};
  const oldTool={id:"old-report-call",name:"research_report",kind:"edit" as const,status:"completed",research:oldSnapshot,result:JSON.stringify({research:oldSnapshot,...artifact,padding:"x".repeat(10000)})};
  current.store.upsertMessage(current.chat.id,{id:"legacy-report-assistant",role:"assistant",content:"Report ready",tools:[oldTool],parts:[{type:"tool",...oldTool},{type:"text",content:"Report ready"}]});
  const pageApi=await import("../app/api/chats/[id]/route");const tokenForPage=auth.authenticateUser("report-canvas-owner","test-password")!.token;
  const pageResponse=await pageApi.GET(new Request("http://fixture/api/chats/"+current.chat.id,{headers:{cookie:"ai_chat_auth="+tokenForPage}}),{params:Promise.resolve({id:current.chat.id})});assert.equal(pageResponse.status,200);
  const page=await pageResponse.json();const restored=page.chat.messages[0].tools[0];assert.ok(restored.resultUrl);assert.ok(!restored.result.includes('"canvasId"'));assert.equal(restored.research.canvasId,undefined);assert.equal(restored.research.workspaceLink,undefined);assert.equal(restored.research.downloadUrl,artifact.workspaceLink);
  const parsed=(await import("../lib/research-progress")).researchProgressFromTool(restored);assert.equal(parsed?.canvasId,artifact.canvasId);assert.equal(parsed?.workspaceLink,artifact.workspaceLink);
  assert.equal((await send({"x-ai-chat-incognito":"1"})).status,403);assert.equal((await send({"x-ai-chat-user-id":foreignId})).status,404);assert.equal((await send({"x-ai-chat-lease-token":"invalid"})).status,401);
  const token=auth.authenticateUser("report-canvas-owner","test-password")!.token;
  const exported=await exports.POST(new Request("http://fixture/api/workspace-export",{method:"POST",headers:{cookie:"ai_chat_auth="+token,"content-type":"application/json"},body:JSON.stringify({chatId:current.chat.id,workspaceId:canvas.id,name:canvas.name,content:canvas.content,format:"md"})}));assert.equal(exported.status,200);assert.equal(await exported.text(),content);
  const forbidden=await legacy.POST(new Request("http://fixture/api/internal/mcp-file",{method:"POST",headers:current.headers,body:JSON.stringify({path:"/etc/passwd"})}));assert.equal(forbidden.status,400);
 }finally{current.close();}
});
test("a run cancelled while its report body is read cannot publish a canvas",async()=>{
 const current=await fixture();try{
  const api=(await loaded)[4];
  const req=new Request("http://fixture/api/internal/mcp-workspace",{method:"POST",headers:current.headers,body:JSON.stringify(report())});
  Object.defineProperty(req,"json",{value:async()=>{current.jobs.updateJob(current.job.id,{status:"cancelled"});return report();}});
  assert.equal((await api.POST(req)).status,409);
  assert.equal(current.store.getChat(current.chat.id,ownerId)!.workspaces?.length||0,0);
 }finally{current.close();}
});
test("a cancelled run cannot create or reuse a cached report canvas",async()=>{
 const current=await fixture();try{
  assert.equal((await current.call(report())).status,200);
  current.jobs.updateJob(current.job.id,{status:"cancelled"});
  assert.equal((await current.call(report())).status,409);
  assert.equal(current.store.getChat(current.chat.id,ownerId)!.workspaces!.length,1);
 }finally{current.close();}
});
