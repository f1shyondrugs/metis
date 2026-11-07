import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-question-cancel-"));
Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AI_CHAT_ROOT:root,AGENT_CWD:root,MCP_BEARER_TOKEN:"cancel-test-token"});
test.after(()=>rmSync(root,{recursive:true,force:true}));
const loaded=Promise.all([import("../lib/auth"),import("../lib/db-store"),import("../lib/db-jobs"),import("../lib/db-questions"),import("../app/api/chat/answer/route"),import("../app/api/internal/mcp-question/route"),import("../lib/user-question-wait")]);
async function fixture(){
 const [auth,store,jobs,questions,answer,internal,gate]=await loaded;
 const username=crypto.randomUUID(),owner=auth.createUser(username,"fixture-password"),token=auth.authenticateUser(username,"fixture-password")!.token;
 const chat=store.createChat("Cancellation",undefined,owner.id),job=jobs.enqueueJob({chatId:chat.id,userId:owner.id,message:"Ask"});
 const lease=jobs.claimNextJob({workerId:"cancel-worker"})!;assert.equal(lease.id,job.id);
 const headers={cookie:"ai_chat_auth="+token,"content-type":"application/json"};
 const respond=(questionId:string,extra:object={cancelled:true,version:1},session: Record<string,string>=headers)=>answer.POST(new Request("http://test/api/chat/answer",{method:"POST",headers:session,body:JSON.stringify({questionId,...extra})}));
 return {auth,store,jobs,questions,answer,internal,gate,owner,chat,job,lease,headers,respond};
}
test("Cancel returns User cancelled through the real internal waiter, persists once, and preserves the live writer",async()=>{
 const f=await fixture();
 f.store.appendMessage(f.chat.id,{id:"assistant",role:"assistant",content:"Please choose.",tools:[{id:"ask",name:"ask_user",kind:"mcp",status:"running"}]},f.owner.id);
 const running=f.internal.POST(new Request("http://test/api/internal/mcp-question",{method:"POST",headers:{
  authorization:"Bearer cancel-test-token","content-type":"application/json","x-ai-chat-id":f.chat.id,"x-ai-chat-user-id":f.owner.id,
  "x-ai-chat-job-id":f.job.id,"x-ai-chat-worker-id":f.lease.leaseOwner!,"x-ai-chat-lease-token":f.lease.leaseToken!,
 },body:JSON.stringify({questions:[{question:"Required answer",key:"choice",type:"number",required:true,default:5}]})}));
 let id="";
 try{
  for(let i=0;i<30&&!id;i++){id=f.store.getChat(f.chat.id,f.owner.id)?.pendingQuestion?.questionId||"";if(!id)await new Promise(r=>setTimeout(r,10));}
  assert.ok(id);
  assert.equal((await f.respond(id,{cancelled:"true"})).status,400);
  assert.equal((await f.respond(id,{cancelled:true,version:99})).status,409);
  assert.equal((await f.respond(id,{cancelled:true},{"content-type":"application/json"})).status,401);
  const foreign=f.auth.createUser("foreign-"+crypto.randomUUID(),"fixture-password"),foreignToken=f.auth.authenticateUser(foreign.username,"fixture-password")!.token;
  assert.equal((await f.respond(id,{cancelled:true},{...f.headers,cookie:"ai_chat_auth="+foreignToken})).status,404);
  const response=await f.respond(id,{cancelled:true,version:1,values:{choice:999}});
  assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.summary,"User cancelled");assert.equal(body.status,"cancelled");assert.equal(body.cancelled,true);
  assert.deepEqual(body.values,{});assert.equal(body.message.content,"User cancelled");
  assert.equal(body.message.questionAnswer.questionId,id);
  const tool=await running;assert.equal(tool.status,200);const result=await tool.json();
  assert.deepEqual(result,{questionId:id,answers:["User cancelled"],values:{},summary:"User cancelled",status:"cancelled",cancelled:true});
  assert.equal(f.jobs.getJob(f.job.id)!.status,"running");
  assert.equal(f.jobs.isJobLeaseActive(f.job.id,f.lease.leaseOwner!,f.lease.leaseToken!),true);
  assert.equal(f.jobs.claimNextJob({workerId:"duplicate"}),null);
  await f.gate.waitForJobUserInput(f.job.id,f.owner.id);
  const repeated=await f.respond(id);assert.equal(repeated.status,200);assert.deepEqual((await repeated.json()).message,body.message);
  assert.equal((await f.respond(id,{values:{choice:7}})).status,409);
  assert.equal(f.store.getChat(f.chat.id,f.owner.id)!.pendingQuestion,undefined);
  assert.equal(f.store.getChat(f.chat.id,f.owner.id)!.messages.filter(m=>m.id==="question-answer-"+id).length,1);
  assert.equal(f.questions.getPendingQuestion(id,f.owner.id)!.cancelled,true);
  f.jobs.updateJob(f.job.id,{status:"completed"});
  assert.equal((await f.respond(id)).status,200);assert.equal(f.jobs.getJob(f.job.id)!.status,"completed");
 }finally{if(id)f.questions.cancelQuestion(id,f.owner.id);await running.catch(()=>{});if(f.jobs.getJob(f.job.id)?.status!=="completed")f.jobs.updateJob(f.job.id,{status:"cancelled"});}
});
test("a parked question resumes once with cancellation, but a full Stop cannot be revived",async()=>{
 const f=await fixture();
 const p=f.questions.createPendingQuestion([{question:"Required",key:"value",required:true}],f.chat.id,f.owner.id,{jobId:f.job.id});p.stop();
 f.jobs.updateJob(f.job.id,{status:"waiting_input"});f.store.updateChat(f.chat.id,{runStatus:"waiting_for_user",pendingQuestion:{...p,status:"waiting_for_user"}},f.owner.id);
 f.jobs.parkEndedUserInputWriter(f.job.id);
 assert.equal((await f.respond(p.questionId)).status,200);
 assert.equal(f.jobs.getJob(f.job.id)!.status,"queued");assert.match(f.jobs.getJob(f.job.id)!.resumePrompt!,/user cancelled/i);
 const resumed=f.jobs.claimNextJob({workerId:"resumed"})!;assert.equal(resumed.id,f.job.id);assert.equal(f.jobs.claimNextJob(),null);
 f.jobs.updateJob(f.job.id,{status:"cancelled"});
 assert.equal((await f.respond(p.questionId)).status,200);assert.equal(f.jobs.getJob(f.job.id)!.status,"cancelled");
 await assert.rejects(()=>f.gate.waitForJobUserInput(f.job.id,f.owner.id),/stopped/);
 const g=await fixture(),q=g.questions.createPendingQuestion([{question:"Stop?"}],g.chat.id,g.owner.id,{jobId:g.job.id});q.stop();
 g.questions.cancelQuestion(q.questionId,g.owner.id);g.jobs.updateJob(g.job.id,{status:"cancelled"});
 assert.equal((await g.respond(q.questionId)).status,409);
 assert.equal(g.questions.getPendingQuestion(q.questionId,g.owner.id)!.cancelled,undefined);
});
test("legacy Cancel endpoint returns the same cancellation response and an answer wins a later cancel race",async()=>{
 const f=await fixture(),skip=await import("../app/api/chat/skip/route");
 const p=f.questions.createPendingQuestion([{question:"Value",key:"value"}],f.chat.id,f.owner.id,{jobId:f.job.id});p.stop();
 f.jobs.updateJob(f.job.id,{status:"waiting_input"});f.store.updateChat(f.chat.id,{runStatus:"waiting_for_user",pendingQuestion:{...p,status:"waiting_for_user"}},f.owner.id);
 const response=await skip.POST(new Request("http://test/api/chat/skip",{method:"POST",headers:f.headers,body:JSON.stringify({chatId:f.chat.id})}));
 assert.equal(response.status,200);assert.equal((await response.json()).summary,"User cancelled");assert.equal(f.jobs.getJob(f.job.id)!.status,"running");
 f.jobs.updateJob(f.job.id,{status:"completed"});
 const g=await fixture(),q=g.questions.createPendingQuestion([{question:"Value",key:"value"}],g.chat.id,g.owner.id);q.stop();
 assert.equal((await g.respond(q.questionId,{values:{value:"Actual answer"}})).status,200);
 assert.equal((await g.respond(q.questionId)).status,409);
 assert.equal(g.questions.getPendingQuestion(q.questionId,g.owner.id)!.summary,"Value: Actual answer");
 g.jobs.updateJob(g.job.id,{status:"cancelled"});
});
