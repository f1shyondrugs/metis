import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import path from "node:path";
import os from "node:os";
test("protected MCP HTTP input enforces cookies, origin, current question and status-only transcript",async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-mcp-api-"));
 Object.assign(process.env,{AI_CHAT_INTERNAL_ORIGIN:"http://127.0.0.1:1",AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AI_CHAT_MCP_STATE_DIR:path.join(root,"state"),AI_CHAT_SECRETS_KEY:"04".repeat(32)});
 mkdirSync(path.join(root,"state"));writeFileSync(path.join(root,"state","registry.json"),JSON.stringify({version:1,servers:[]}));
 const auth=await import("../lib/auth"),store=await import("../lib/db-store"),jobs=await import("../lib/db-jobs"),questions=await import("../lib/db-questions");
 const protectedInput=await import("../lib/mcp-protected-input");
 const route=await import("../app/api/mcp-protected-input/route"),answer=await import("../app/api/chat/answer/route");
 const owner=auth.createUser("mcp-test-owner","synthetic-account-password");
 const cookie="ai_chat_auth="+auth.authenticateUser(owner.username,"synthetic-account-password")!.token;
 const chat=store.createChat("MCP test",undefined,owner.id);
 const job=jobs.enqueueJob({chatId:chat.id,userId:owner.id,message:"test"});
 jobs.updateJob(job.id,{status:"running"});
 jobs.updateJob(job.id,{status:"waiting_input"});
 writeFileSync(path.join(root,"state","registry.json"),JSON.stringify({version:1,servers:[{id:"test-mcp",ownerId:owner.id,kind:"stdio",command:"node",env:{},enabled:false}]}));
 const secure=await protectedInput.prepareMcpInput(owner.id,chat.id,job.id,{server:"test-mcp",fields:["PASSWORD"]});
 const pending=questions.createPendingQuestion({questions:[{key:"secure_login",question:"Protected input",type:"text",required:false}]},chat.id,owner.id,{jobId:job.id,secureBrowserInput:secure});
 store.updateChat(chat.id,{pendingQuestion:{...pending,secureBrowserInput:secure}},owner.id);
 const req=(body:unknown,cookieValue=cookie,origin="http://localhost")=>new Request("http://localhost/api/mcp-protected-input",{method:"POST",headers:{cookie:cookieValue,origin,"content-type":"application/json"},body:JSON.stringify(body)});
 const payload={questionId:pending.questionId,values:{PASSWORD:"SYNTHETIC-NO-TRANSCRIPT"}};
 try{
  assert.equal((await route.POST(req(payload,""))).status,401);
  assert.equal((await route.POST(req(payload,cookie,"https://other.example"))).status,403);
  assert.equal((await route.POST(req(payload))).status,200);
  const response=await answer.POST(new Request("http://localhost/api/chat/answer",{method:"POST",headers:{cookie,origin:"http://localhost","content-type":"application/json"},body:JSON.stringify({questionId:pending.questionId,values:{secure_login:"SYNTHETIC-NO-TRANSCRIPT"}})}));
  assert.equal(response.status,200,await response.text());
  assert(!JSON.stringify(questions.getPendingQuestion(pending.questionId,owner.id)).includes("SYNTHETIC-NO-TRANSCRIPT"));
  assert(!readFileSync(path.join(root,"state","registry.json"),"utf8").includes("SYNTHETIC-NO-TRANSCRIPT"));
  assert.equal((await route.POST(req(payload))).status,409);
 }finally{pending.stop();rmSync(root,{recursive:true,force:true});}
});
