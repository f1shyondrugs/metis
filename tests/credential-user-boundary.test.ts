import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import test,{after} from "node:test";
const dir=mkdtempSync(path.join(os.tmpdir(),"metis-credential-users-"));
Object.assign(process.env,{CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"chat.sqlite"),AGENT_CWD:dir,AI_CHAT_ROOT:dir,MCP_BEARER_TOKEN:"TEST-USER-BOUNDARY"});
delete process.env.AI_CHAT_TEST_BYPASS_LEASE;
after(()=>rmSync(dir,{recursive:true,force:true}));
test("a valid lease cannot change its owner/chat for browser, password questions or console actions",async()=>{
 const auth=await import("../lib/auth"),store=await import("../lib/db-store"),jobs=await import("../lib/db-jobs");
 const guard=await import("../lib/internal-run-lease");
 const a=auth.createUser("boundary-alice","TEST-ACCOUNT-A"),b=auth.createUser("boundary-bob","TEST-ACCOUNT-B");
 const ca=store.createChat("A",undefined,a.id),cb=store.createChat("B",undefined,b.id),ca2=store.createChat("A2",undefined,a.id);
 const job=jobs.enqueueJob({chatId:ca.id,userId:a.id,message:"TEST"}),lease=jobs.claimNextJob({workerId:"boundary-worker"})!;
 const routes=[[(await import("../app/api/internal/browser/route")).POST,{action:"secure_input_prepare"}],[(await import("../app/api/internal/mcp-question/route")).POST,{browserLogin:{selector:"#password"}}],[(await import("../app/api/internal/mcp-question/route")).POST,{consoleLogin:{action:"connect",method:"su",user:"root"}}],[(await import("../app/api/internal/mcp-console/route")).POST,{operation:"console_read"}]] as const;
 const request=(owner:string,chat:string,body:unknown)=>new Request("http://localhost/internal",{method:"POST",headers:{authorization:"Bearer TEST-USER-BOUNDARY","content-type":"application/json","x-ai-chat-job-id":job.id,"x-ai-chat-worker-id":lease.leaseOwner!,"x-ai-chat-lease-token":lease.leaseToken!,"x-ai-chat-user-id":owner,"x-ai-chat-id":chat},body:JSON.stringify(body)});
 assert(guard.internalRunContextAuthorized(request(a.id,ca.id,{}),job.id));
 for(const [owner,chat]of [[b.id,cb.id],[b.id,ca.id],[a.id,cb.id],[a.id,ca2.id],["",ca.id]])for(const [route,body]of routes)assert.equal((await route(request(owner,chat,body))).status,401);
 assert.equal(store.getChat(cb.id,b.id)?.pendingQuestion,undefined);
 assert.equal(jobs.getJob(job.id)?.status,"running");jobs.updateJob(job.id,{status:"cancelled"});
});
test("another user's cookie cannot submit or resolve a captured secure question ID",async()=>{
 const auth=await import("../lib/auth"),store=await import("../lib/db-store"),q=await import("../lib/db-questions");
 const a=auth.createUser("question-alice","TEST-A"),b=auth.createUser("question-bob","TEST-B");
 const cookie="ai_chat_auth="+auth.authenticateUser("question-bob","TEST-B")!.token;
 const chat=store.createChat("Private login",undefined,a.id);
 const secure={requestId:randomUUID(),origin:"https://portal.example",expiresAt:new Date(Date.now()+60000).toISOString()};
 const pending=q.createPendingQuestion({questions:[{key:"secure_login",question:"Login",type:"text",required:false}]},chat.id,a.id,{secureBrowserInput:secure});
 store.updateChat(chat.id,{pendingQuestion:{...pending,status:"waiting_for_user"}},a.id);
 try{
  const input=(await import("../app/api/browser/secure-input/route")).POST,answer=(await import("../app/api/chat/answer/route")).POST;
  const request=(url:string,body:unknown)=>new Request(url,{method:"POST",headers:{cookie,host:"localhost",origin:"http://localhost","content-type":"application/json"},body:JSON.stringify(body)});
  assert.equal((await input(request("http://localhost/api/browser/secure-input",{questionId:pending.questionId,password:"TEST-ATTACKER-PW",username:"TEST-ATTACKER-NAME"}))).status,409);
  assert.equal((await answer(request("http://localhost/api/chat/answer",{questionId:pending.questionId,values:{secure_login:"TEST-ATTACKER-PW"}}))).status,404);
  assert.equal(q.getPendingQuestion(pending.questionId,a.id)?.status,"waiting_for_user");assert.equal(store.getChat(chat.id,a.id)?.messages.length,0);
 }finally{pending.stop();}
});
