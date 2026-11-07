import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ProviderContext } from "../lib/providers/adapters/provider-support";
const dir=mkdtempSync(path.join(os.tmpdir(),"metis-input-continuation-"));
Object.assign(process.env,{CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"chat.sqlite"),AGENT_CWD:dir,AI_CHAT_ROOT:dir,AI_CHAT_SECRETS_KEY:"00".repeat(32)});
for(const key of ["AI_CHAT_JOB_ID","AI_CHAT_WORKER_ID","AI_CHAT_JOB_LEASE_TOKEN"])delete process.env[key];
test.after(()=>rmSync(dir,{recursive:true,force:true}));
const loaded=Promise.all([import("../lib/auth"),import("../lib/db-store"),import("../lib/db-jobs"),import("../lib/db-questions"),import("../lib/provider-connections"),import("../lib/providers/adapters/codex"),import("../lib/providers/runner"),import("../app/api/chat/answer/route")]);
async function fixture(){
 const [auth,store,jobs,questions,connections,codex,runner,answer]=await loaded;
 const username=crypto.randomUUID(),owner=auth.createUser(username,"test-password"),token=auth.authenticateUser(username,"test-password")!.token;
 const connection=connections.upsertProviderConnection(owner.id,{providerKey:"codex",slug:"input-fixture",label:"Input fixture",authType:"api_key",secret:"unused",enabled:true})!;
 const modelId=`codex:${connection.id}:fixture-model`;
 const chat=store.createChat("Question continuation",undefined,owner.id,{id:modelId});
 const queued=jobs.enqueueJob({chatId:chat.id,userId:owner.id,modelId,message:"Help with this task"});
 const job=jobs.claimNextJob()!;assert.equal(job.id,queued.id);
 const submit=(id:string)=>answer.POST(new Request("http://test/api/chat/answer",{method:"POST",headers:{cookie:"ai_chat_auth="+token,"content-type":"application/json"},body:JSON.stringify({questionId:id,values:{choice:"saved answer"}})}));
 const dismiss=(id:string)=>answer.POST(new Request("http://test/api/chat/answer",{method:"POST",headers:{cookie:"ai_chat_auth="+token,"content-type":"application/json"},body:JSON.stringify({questionId:id,cancelled:true})}));
 function ask(){
  const pending=questions.createPendingQuestion([{question:"Details?",key:"choice",type:"text"}],chat.id,owner.id,{jobId:job.id,runId:job.id});
  jobs.updateJob(job.id,{status:"waiting_input"});store.updateChat(chat.id,{runStatus:"waiting_for_user",pendingQuestion:{...pending,status:"waiting_for_user"}},owner.id);
  return pending;
 }
 return {owner,chat,job,store,jobs,questions,codex,runner,submit,dismiss,ask};
}
test("a cancelled form lets the provider acknowledge cancellation without another question or duplicate run",async t=>{
 const f=await fixture();let calls=0;
 t.mock.method(f.codex.codexAdapter,"runTurn",async(context:ProviderContext)=>{
  calls++;context.onText("Please choose.");context.onTool({id:"ask",name:"ask_user",status:"running"});
  const pending=f.ask();
  try{
   assert.equal((await f.dismiss(pending.questionId)).status,200);
   assert.deepEqual(await pending.promise,["User cancelled"]);
   context.onTool({id:"ask",name:"ask_user",status:"completed",result:JSON.stringify({cancelled:true,summary:"User cancelled"})});
   context.onText(" Cancelled.");
   return {};
  }finally{pending.stop();}
 });
 await f.runner.runAlternativeProviderJob(f.job,f.chat);
 assert.equal(calls,1);assert.equal(f.jobs.getJob(f.job.id)!.status,"completed");assert.equal(f.jobs.claimNextJob(),null);
 assert.match(f.store.getChat(f.chat.id)!.messages.filter(m=>m.role==="assistant").at(-1)!.content,/Cancelled/);
});
test("the real provider runner automatically continues when the answer only completes ask_user and no reply follows",async t=>{
 const f=await fixture();let calls=0,questionId="";
 t.mock.method(f.codex.codexAdapter,"runTurn",async(context:ProviderContext)=>{
  calls++;
  if(calls===1){
   context.onText("What details should I use?");
   context.onTool({id:"ask",name:"ask_user",status:"running"});
   const pending=f.ask();questionId=pending.questionId;
   try{
    assert.equal((await f.submit(questionId)).status,200);
    await pending.promise;
    context.onTool({id:"ask",name:"ask_user",status:"completed",result:JSON.stringify({questionId,answers:["saved answer"]})});
    return {agentId:"codex:fixture-thread"};
   }finally{pending.stop();}
  }
  assert.match(context.job.resumePrompt!,/saved answer/);
  context.onText("Your saved answer has been applied.");
  return {agentId:"codex:fixture-thread"};
 });
 await f.runner.runAlternativeProviderJob(f.job,f.chat);
 assert.equal(f.jobs.getJob(f.job.id)!.status,"queued");
 assert.equal(calls,1);
 const resumed=f.jobs.claimNextJob()!;
 assert.equal(resumed.id,f.job.id);assert.equal(resumed.attempts,2);
 assert.equal(f.jobs.claimNextJob(),null);
 await f.runner.runAlternativeProviderJob(resumed,f.store.getChat(f.chat.id)!);
 assert.equal(f.jobs.getJob(f.job.id)!.status,"completed");assert.equal(calls,2);
 const messages=f.store.getChat(f.chat.id)!.messages;
 assert.equal(messages.at(-1)!.content,"Your saved answer has been applied.");
 assert.equal(messages.filter(m=>m.id==="question-answer-"+questionId).length,1);
 const attempts=f.jobs.getJob(f.job.id)!.attempts;
 assert.equal((await f.submit(questionId)).status,200);
 assert.equal(f.jobs.getJob(f.job.id)!.status,"completed");assert.equal(f.jobs.getJob(f.job.id)!.attempts,attempts);
});
test("a provider that returns with an unanswered form releases its dead writer and resumes immediately after a fresh answer",async t=>{
 const f=await fixture();let pending:ReturnType<typeof f.ask>;
 t.mock.method(f.codex.codexAdapter,"runTurn",async(context:ProviderContext)=>{
  context.onText("Waiting for details.");context.onTool({id:"ask",name:"ask_user",status:"running"});
  pending=f.ask();pending.stop();return {};
 });
 await f.runner.runAlternativeProviderJob(f.job,f.chat);
 const parked=f.jobs.getJob(f.job.id)!;
 assert.equal(parked.status,"waiting_input");assert.equal(parked.userInputWriterEnded,true);
 assert.equal(f.jobs.isJobLeaseActive(f.job.id,f.job.leaseOwner!,f.job.leaseToken!),false);
 assert.equal((await f.submit(pending!.questionId)).status,200);
 assert.equal(f.jobs.getJob(f.job.id)!.status,"queued");
 const resumed=f.jobs.claimNextJob()!;assert.equal(resumed.id,f.job.id);assert.match(resumed.resumePrompt!,/saved answer/);
 f.jobs.updateJob(resumed.id,{status:"cancelled"});
});
for(const progress of ["text","tool"] as const){
 test(`a real post-answer ${progress} continuation completes without a second turn`,async t=>{
  const f=await fixture();
  t.mock.method(f.codex.codexAdapter,"runTurn",async(context:ProviderContext)=>{
   context.onText("Please answer.");context.onTool({id:"ask",name:"ask_user",status:"running"});
   const pending=f.ask();
   try{
    await f.submit(pending.questionId);await pending.promise;
    context.onTool({id:"ask",name:"ask_user",status:"completed",result:"saved answer"});
    if(progress==="text")context.onText(" Applied your answer.");
    else context.onTool({id:"next",name:"read_file",status:"completed",result:"Used the chosen file"});
    return {};
   }finally{pending.stop();}
  });
  await f.runner.runAlternativeProviderJob(f.job,f.chat);
  assert.equal(f.jobs.getJob(f.job.id)!.status,"completed");assert.equal(f.jobs.claimNextJob(),null);
 });
}
test("automatic continuation is bounded to one attempt for an answer, and cancellation never resumes",async t=>{
 const f=await fixture();const pending=f.ask();pending.stop();
 f.store.appendMessage(f.chat.id,{id:"assistant",role:"assistant",content:"Question?"},f.owner.id);
 await f.submit(pending.questionId);
 assert.equal(f.jobs.commitWithUserInputContinuation(f.job.id,()=>assert.fail("Must queue")),"queued");
 const resumed=f.jobs.claimNextJob()!;let completed=false;
 assert.equal(f.jobs.commitWithUserInputContinuation(resumed.id,()=>{completed=true;f.jobs.updateJob(resumed.id,{status:"completed"});}),"completed");
 assert.equal(completed,true);assert.equal(f.jobs.claimNextJob(),null);
 const cancelled=await fixture();const other=cancelled.ask();other.stop();cancelled.jobs.updateJob(cancelled.job.id,{status:"cancelled"});
 assert.equal((await cancelled.submit(other.questionId)).status,200);
 assert.equal(cancelled.jobs.getJob(cancelled.job.id)!.status,"cancelled");assert.equal(cancelled.jobs.claimNextJob(),null);
});
test("a resumed provider that still returns nothing reports an error instead of looping or silently finishing",async t=>{
 const f=await fixture();const pending=f.ask();pending.stop();
 f.store.appendMessage(f.chat.id,{id:"assistant",role:"assistant",content:"Please answer"},f.owner.id);
 await f.submit(pending.questionId);
 f.jobs.commitWithUserInputContinuation(f.job.id,()=>assert.fail("Must resume"));
 const resumed=f.jobs.claimNextJob()!;
 t.mock.method(f.codex.codexAdapter,"runTurn",async()=>({}));
 await f.runner.runAlternativeProviderJob(resumed,f.store.getChat(f.chat.id)!);
 assert.equal(f.jobs.getJob(resumed.id)!.status,"error");
 assert.match(f.jobs.getJob(resumed.id)!.error!,/without responding to your saved answer/);
 assert.equal(f.jobs.claimNextJob(),null);
});
test("a parked provider keeps other unanswered forms waiting before claiming the answer continuation",async()=>{
 const f=await fixture();const first=f.ask();first.stop();
 const second=f.questions.createPendingQuestion([{question:"Other",key:"choice",type:"text"}],f.chat.id,f.owner.id,{jobId:f.job.id,runId:f.job.id});second.stop();
 f.jobs.parkEndedUserInputWriter(f.job.id);
 await f.submit(first.questionId);
 assert.equal(f.jobs.getJob(f.job.id)!.status,"waiting_input");assert.equal(f.jobs.claimNextJob(),null);
 await f.submit(second.questionId);
 assert.equal(f.jobs.getJob(f.job.id)!.status,"queued");
 const resumed=f.jobs.claimNextJob()!;f.jobs.updateJob(resumed.id,{status:"cancelled"});
});
test("Cursor's actual terminal callback is guarded by the same durable continuation transaction",async()=>{
 const {readFileSync}=await import("node:fs"),{default:ts}=await import("typescript"),{default:vm}=await import("node:vm");
 const source=ts.createSourceFile("runner.ts",readFileSync("lib/worker-runner.ts","utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 let callback="",guard="";
 function visit(node:import("typescript").Node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(source)==="commitCompletion")callback=node.getText(source);
  if(ts.isIfStatement(node)&&node.getText(source).startsWith("if (resultError) commitCompletion()"))guard=node.getText(source);
  ts.forEachChild(node,visit);
 }visit(source);
 assert.ok(callback);assert.ok(guard);
 const f=await fixture();f.store.appendMessage(f.chat.id,{id:"cursor-response",role:"assistant",content:"Question?"},f.owner.id);
 const pending=f.ask();pending.stop();await f.submit(pending.questionId);
 let done=false;
 const code=ts.transpileModule("(()=>{const "+callback+";"+guard+";return true;})()",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const result=vm.runInNewContext(code,{job:f.job,completionAgentId:"cursor-fixture",assistantMessageId:"cursor-response",resultError:undefined,result:{status:"completed"},Date,
  updateChat:f.store.updateChat,updateJob:f.jobs.updateJob,commitWithUserInputContinuation:f.jobs.commitWithUserInputContinuation,
  emit:(event:string)=>{if(event==="done")done=true;}});
 assert.equal(result,undefined);assert.equal(done,false);assert.equal(f.jobs.getJob(f.job.id)!.status,"queued");
 const resumed=f.jobs.claimNextJob()!;f.jobs.updateJob(resumed.id,{status:"cancelled"});
});
test("wrapped ask_user receipts alone cannot satisfy the saved-answer continuation", async () => {
 const {hasUserInputResponse,userInputProgress}=await import("../lib/user-input-progress");
 const message={id:"assistant",role:"assistant",content:"",tools:[{id:"ask",name:"call_mcp_tool",input:JSON.stringify({server:"fixture",tool:"ask_user"}),result:"saved answer"}]};
 assert.equal(hasUserInputResponse(message),false);
 assert.equal(userInputProgress([message]).signature,userInputProgress([{...message,tools:[]}]).signature);
 assert.equal(hasUserInputResponse({...message,tools:[...message.tools,{id:"read",name:"read_file"}]}),true);
});
test("a waiting completion guard parks the provider instead of publishing done",async()=>{
 const f=await fixture();const pending=f.ask();pending.stop();let completed=false;
 assert.equal(f.jobs.commitWithUserInputContinuation(f.job.id,()=>{completed=true;}),"waiting");
 assert.equal(completed,false);
 await f.submit(pending.questionId);
 const resumed=f.jobs.claimNextJob()!;f.jobs.updateJob(resumed.id,{status:"cancelled"});
});
