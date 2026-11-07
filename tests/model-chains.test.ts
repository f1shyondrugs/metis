import assert from "node:assert/strict";
import test,{after,afterEach} from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {modelChainFailure} from "../lib/model-chain-failure";
import type {ProviderContext} from "../lib/providers/adapters/provider-support";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-model-chains-"));
Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"test.sqlite"),AI_CHAT_ROOT:root,AGENT_CWD:root,AI_CHAT_SECRETS_KEY:"00".repeat(32),AI_CHAT_INSTALL_DIR:path.resolve(import.meta.dirname,".."),CHAT_PASSWORD:"",METIS_AI_BOOTSTRAP_PASSWORD:"",CHAT_LEGACY_HEADER_AUTH:"false"});
for(const name of ["AI_CHAT_JOB_ID","AI_CHAT_WORKER_ID","AI_CHAT_JOB_LEASE_TOKEN"])delete process.env[name];
const loaded=Promise.all([import("../lib/auth"),import("../lib/db-store"),import("../lib/db-jobs"),import("../lib/model-chains"),import("../lib/provider-connections"),import("../lib/model-access"),import("../lib/sqlite")]);
after(async()=>{(await loaded)[6].getDatabase().close();rmSync(root,{recursive:true,force:true});});
afterEach(async()=>{const jobs=(await loaded)[2];for(const job of jobs.listJobs())if(["running","queued","switching"].includes(job.status))jobs.updateJob(job.id,{status:"cancelled"},{control:true});});
async function fixture(){
 const [auth,store,jobs,chains,connections,access]=await loaded;
 const user=auth.createUser("chain-"+crypto.randomUUID().slice(0,8),"fixture-password");
 const token=auth.authenticateUser(user.username,"fixture-password")!.token;access.ensureAllModelAccess(user.id);
 const models=["primary","secondary","tertiary"].map((name,i)=>{
  const connection=connections.upsertProviderConnection(user.id,{providerKey:"codex",slug:"chain-"+i,label:"Account "+i,authType:"api_key",secret:"fixture",enabled:true})!;
  connections.saveProviderModels(connection.id,[{id:name,displayName:"Fixture "+name,capabilities:{},parameters:[{id:"effort",displayName:"Effort",values:[{value:"low"},{value:"high"}]}],defaultParams:[{id:"effort",value:"low"}]}]);
  return {connection,modelId:"codex:"+connection.id+":"+name,modelParams:[{id:"effort",value:i===0?"high":"low"}]};
 });
 const chain=chains.saveModelChain(user.id,{name:"Work chain",steps:models.map(({modelId,modelParams})=>({modelId,modelParams}))});
 const chat=store.createChat("Chain fixture",undefined,user.id,{id:models[0].modelId});
 chains.setChatModelChain(user.id,chat.id,chain.id);
 const start=()=>{
  const queued=jobs.enqueueJob({chatId:chat.id,userId:user.id,message:"Finish the saved work.",modelId:models[2].modelId,modelParams:[]});
  const job=jobs.claimNextJob({workerId:"chain-worker"})!;assert.equal(job.id,queued.id);return job;
 };
 return {auth,store,jobs,chains,connections,user,token,models,chain,chat,start};
}
const request=(token:string|undefined,body?:unknown)=>new Request("http://localhost/api/model-chains",{method:body?"PUT":"GET",headers:{"content-type":"application/json",...(token?{cookie:"ai_chat_auth="+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
test("fallback classifies quota and availability but rejects generic, auth, parameter and tool failures",()=>{
 assert.equal(modelChainFailure({statusCode:429,message:"Usage limit reached"}),"usage");
 assert.equal(modelChainFailure({cause:{code:"insufficient_quota"}}),"usage");
 assert.equal(modelChainFailure({statusCode:503,message:"Overloaded"}),"unavailable");
 assert.equal(modelChainFailure({cause:{code:"ECONNREFUSED"}}),"unavailable");
 assert.equal(modelChainFailure(new Error("Reconnecting 5/5: stream disconnected before completion")),"unavailable");
 for(const error of [new Error("Unexpected exception"),{statusCode:401,code:"usage_limit_reached"},{statusCode:400,code:"invalid_request_error"},{code:"context_length_exceeded"},{statusCode:503,message:"MCP tool call failed"},{toolCallId:"x",statusCode:503}])
  assert.equal(modelChainFailure(error),null);
});
test("chains are account scoped, versioned and validate order, duplicates and declared options",async()=>{
 const f=await fixture(),other=await fixture();
 assert.equal(f.chains.getModelChain(other.user.id,f.chain.id),null);
 assert.equal(f.chains.listModelChains(f.user.id).length,1);
 assert.throws(()=>f.chains.saveModelChain(f.user.id,{...f.chain,createdAt:undefined,updatedAt:undefined}),/valid/);
 const reversed=f.chains.saveModelChain(f.user.id,{id:f.chain.id,version:f.chain.version,name:"Reordered",steps:[...f.chain.steps].reverse()});
 assert.equal(reversed.steps[0].modelId,f.models[2].modelId);
 assert.throws(()=>f.chains.saveModelChain(f.user.id,{id:f.chain.id,version:f.chain.version,name:"Stale",steps:f.chain.steps}),/another tab/);
 assert.throws(()=>f.chains.saveModelChain(f.user.id,{name:"Duplicate",steps:[f.chain.steps[0],f.chain.steps[0]]}),/only once/);
 assert.throws(()=>f.chains.saveModelChain(f.user.id,{name:"Invalid options",steps:[{...f.chain.steps[0],modelParams:[{id:"effort",value:"invented"}]},f.chain.steps[1]]}),/supported/);
 assert.throws(()=>f.chains.saveModelChain(other.user.id,{name:"Foreign account",steps:f.chain.steps}),/discovered|available/);
});
test("API requires authentication and excludes foreign chains",async()=>{
 const f=await fixture(),other=await fixture(),route=await import("../app/api/model-chains/route");
 assert.equal((await route.GET(request(undefined))).status,401);
 assert.equal((await route.PUT(request(undefined,{name:"Denied",steps:f.chain.steps}))).status,401);
 const response=await route.GET(request(f.token));assert.equal(response.status,200);
 assert.deepEqual((await response.json()).chains.map((c:{id:string})=>c.id),[f.chain.id]);
 assert.equal((await route.PUT(request(other.token,{id:f.chain.id,version:f.chain.version,name:"Foreign",steps:other.chain.steps}))).status,404);
});
test("each new run starts at preferred with an immutable snapshot and explicit per-step parameters",async()=>{
 const f=await fixture(),job=f.start();
 assert.equal(job.modelId,f.models[0].modelId);assert.deepEqual(job.modelParams,f.models[0].modelParams);
 assert.equal(job.modelChain?.index,0);
 f.chains.saveModelChain(f.user.id,{id:f.chain.id,version:f.chain.version,name:"Edited later",steps:[...f.chain.steps].reverse()});
 assert.equal(f.jobs.getJob(job.id)?.modelChain?.name,"Work chain");
 assert.equal(f.jobs.getJob(job.id)?.modelChain?.steps[0].modelId,f.models[0].modelId);
});
test("quota switches atomically, preserves the run budget and publishes the fallback reason",async()=>{
 const f=await fixture(),job=f.start(),runtime=await import("../lib/model-chain-runtime");
 const deadline=new Date(Date.now()+600_000).toISOString();f.jobs.updateJob(job.id,{runId:"same-run",agentRuntimeDeadlineAt:deadline});
 const events:unknown[]=[];
 assert.equal(runtime.requestModelChainFallback(job.id,{statusCode:429,message:"Usage limit reached"},event=>events.push(event)),true);
 const current=f.jobs.getJob(job.id)!;
 assert.equal(current.status,"switching");assert.equal(current.modelId,f.models[1].modelId);
 assert.equal(current.modelChain?.index,1);assert.equal(current.runId,"same-run");assert.equal(current.agentRuntimeDeadlineAt,deadline);
 assert.deepEqual(current.modelParams,f.models[1].modelParams);
 assert.equal((events[0] as {reason:string}).reason,"chain-usage");assert.match(current.resumePrompt!,/do not repeat completed actions/i);
});
test("availability retries exactly three times before fallback even when generic recovery is off",async()=>{
 const f=await fixture(),job=f.start(),runtime=await import("../lib/model-chain-runtime"),retry=await import("../lib/provider-retry-runner");
 const error={statusCode:503,message:"Service unavailable"};
 for(let attempt=1;attempt<=3;attempt++){
  assert.equal(runtime.requestModelChainFallback(job.id,error,()=>{}),false);
  assert.equal(retry.requestProviderRetry(job.id,error,()=>{}),true);
  assert.equal(f.jobs.getJob(job.id)?.modelChain?.unavailableRetries,attempt);
 }
 assert.equal(runtime.requestModelChainFallback(job.id,error,()=>{}),true);
 assert.equal(f.jobs.getJob(job.id)?.providerRetryCount,0);
 assert.equal(f.jobs.getJob(job.id)?.modelChain?.unavailableRetries,0);
});
test("generic and auth failures, cancellation, expiry and pending manual switches do not advance chains",async()=>{
 const f=await fixture(),job=f.start(),runtime=await import("../lib/model-chain-runtime");
 for(const error of [new Error("Generic failure"),{statusCode:401,message:"Invalid key"},{toolCallId:"tool",statusCode:503}])
  assert.equal(runtime.requestModelChainFallback(job.id,error,()=>{}),false);
 f.jobs.updateJob(job.id,{agentRuntimeDeadlineAt:new Date(Date.now()-1).toISOString()});
 assert.equal(runtime.requestModelChainFallback(job.id,{statusCode:429,message:"Usage limit reached"},()=>{}),false);
 f.jobs.updateJob(job.id,{agentRuntimeDeadlineAt:undefined,pendingModelId:f.models[2].modelId});
 assert.equal(runtime.requestModelChainFallback(job.id,{statusCode:429,message:"Usage limit reached"},()=>{}),false);
 f.jobs.cancelAgentJob(job.id,f.user.id);
 assert.equal(runtime.requestModelChainFallback(job.id,{statusCode:429,message:"Usage limit reached"},()=>{}),false);
});
test("revoked connections are skipped and the end of a chain never loops",async()=>{
 const f=await fixture(),job=f.start(),runtime=await import("../lib/model-chain-runtime");
 f.connections.upsertProviderConnection(f.user.id,{id:f.models[1].connection.id,providerKey:"codex",slug:"chain-1",label:"Disabled",authType:"api_key",enabled:false});
 assert.equal(runtime.requestModelChainFallback(job.id,{code:"usage_limit_reached"},()=>{}),true);
 assert.equal(f.jobs.getJob(job.id)?.modelId,f.models[2].modelId);
 f.jobs.requeueSwitchingJob(job.id);f.jobs.claimNextJob();
 assert.equal(runtime.requestModelChainFallback(job.id,{code:"usage_limit_reached"},()=>{}),false);
 assert.equal(f.jobs.getJob(job.id)?.modelChain?.index,2);
});
test("real provider runner preserves completed work across a usage fallback and finishes on the next account",async t=>{
 const f=await fixture(),job=f.start();
 const {codexAdapter}=await import("../lib/providers/adapters/codex"),{runAlternativeProviderJob}=await import("../lib/providers/runner");
 const seen:string[]=[];
 t.mock.method(codexAdapter,"runTurn",async(context:ProviderContext)=>{
  seen.push(context.modelId);
  if(seen.length===1){context.onText("Saved progress.");context.onTool({id:"already-done",name:"fixture",status:"completed",result:"Saved output"});throw Object.assign(new Error("Usage limit reached"),{statusCode:429});}
  assert.match(context.job.resumePrompt!,/saved work/);
  assert.ok(context.chat.messages.some(m=>m.content==="Saved progress."));
  context.onText("Finished with fallback.");return {};
 });
 await runAlternativeProviderJob(job,f.chat);
 assert.equal(f.jobs.getJob(job.id)?.status,"switching");
 f.jobs.requeueSwitchingJob(job.id);const resumed=f.jobs.claimNextJob()!;
 await runAlternativeProviderJob(resumed,f.store.getChat(f.chat.id,f.user.id)!);
 assert.deepEqual(seen,["primary","secondary"]);assert.equal(f.jobs.getJob(job.id)?.status,"completed");
 const messages=f.store.getChat(f.chat.id,f.user.id)!.messages;
 assert.ok(messages.some(m=>m.tools?.some(t=>t.id==="already-done"&&t.status==="completed")));
 assert.ok(messages.flatMap(m=>m.parts||[]).some(p=>p.type==="model-switch"&&p.reason==="chain-usage"));
});
test("real provider runner performs initial attempt plus three unavailability retries before handoff",async t=>{
 const f=await fixture(),job=f.start();
 const {codexAdapter}=await import("../lib/providers/adapters/codex"),{runAlternativeProviderJob}=await import("../lib/providers/runner");
 let calls=0;
 t.mock.method(codexAdapter,"runTurn",async()=>{calls++;throw Object.assign(new Error("Service unavailable"),{statusCode:503});});
 await runAlternativeProviderJob(job,f.chat);
 assert.equal(calls,4);assert.equal(f.jobs.getJob(job.id)?.status,"switching");
 assert.equal(f.jobs.getJob(job.id)?.modelChain?.index,1);
});

test("shared project members keep independent chain selections and cannot select another member's chain",async()=>{
 const f=await fixture(),member=await fixture(),projects=await import("../lib/projects"),sharing=await import("../lib/project-sharing");
 const project=projects.createProject({ownerId:f.user.id,name:"Shared chain fixture"});
 const invite=sharing.inviteProjectMember(project.id,f.user.id,member.user.username);sharing.respondProjectInvitation(invite.id,member.user.id,"accept");
 f.store.updateChat(f.chat.id,{projectId:project.id},f.user.id);
 f.chains.setChatModelChain(member.user.id,f.chat.id,member.chain.id);
 assert.equal(f.chains.chatModelChain(f.user.id,f.chat.id)?.id,f.chain.id);
 assert.equal(f.chains.chatModelChain(member.user.id,f.chat.id)?.id,member.chain.id);
 assert.throws(()=>f.chains.setChatModelChain(member.user.id,f.chat.id,f.chain.id),/not found/);
 const route=await import("../app/api/chats/[id]/model-chain/route");
 const result=await route.PUT(request(member.token,{chainId:member.chain.id}),{params:Promise.resolve({id:f.chat.id})});
 assert.equal(result.status,200);assert.equal(f.chains.chatModelChain(f.user.id,f.chat.id)?.id,f.chain.id);
});
test("lease loss cannot checkpoint or advance a chain",async()=>{
 const f=await fixture(),job=f.start(),runtime=await import("../lib/model-chain-runtime");
 Object.assign(process.env,{AI_CHAT_JOB_ID:job.id,AI_CHAT_WORKER_ID:"wrong-worker",AI_CHAT_JOB_LEASE_TOKEN:"wrong-token"});
 try{
  assert.equal(runtime.requestModelChainFallback(job.id,{code:"usage_limit_reached"},()=>assert.fail("Stale writer checkpointed")),false);
  assert.equal(f.jobs.getJob(job.id)?.modelChain?.index,0);assert.equal(f.jobs.getJob(job.id)?.pendingModelId,undefined);
 }finally{for(const key of ["AI_CHAT_JOB_ID","AI_CHAT_WORKER_ID","AI_CHAT_JOB_LEASE_TOKEN"])delete process.env[key];}
});
test("real runner hands off across providers without reusing the old provider session",async t=>{
 const f=await fixture(),{claudeAdapter}=await import("../lib/providers/adapters/claude"),{codexAdapter}=await import("../lib/providers/adapters/codex"),{runAlternativeProviderJob}=await import("../lib/providers/runner");
 const connection=f.connections.upsertProviderConnection(f.user.id,{providerKey:"claude-code",slug:"fallback-claude",label:"Claude fallback",authType:"oauth",secret:"fixture",enabled:true})!;
 f.connections.saveProviderModels(connection.id,[{id:"other-model",displayName:"Other provider model",capabilities:{}}]);
 const chain=f.chains.saveModelChain(f.user.id,{name:"Cross provider",steps:[f.chain.steps[0],{modelId:"claude-code:"+connection.id+":other-model",modelParams:[]}]});
 f.chains.setChatModelChain(f.user.id,f.chat.id,chain.id);const job=f.start();
 t.mock.method(codexAdapter,"runTurn",async(context:ProviderContext)=>{context.onText("Saved before quota.");throw Object.assign(new Error("Usage limit reached"),{statusCode:429});});
 t.mock.method(claudeAdapter,"runTurn",async(context:ProviderContext)=>{assert.equal(context.modelId,"other-model");assert.equal(context.job.agentId,undefined);assert.ok(context.chat.messages.some(m=>m.content==="Saved before quota."));context.onText("Completed with other provider.");return {};});
 await runAlternativeProviderJob(job,f.chat);assert.equal(f.jobs.getJob(job.id)?.status,"switching");
 f.jobs.requeueSwitchingJob(job.id);const resumed=f.jobs.claimNextJob()!;
 await runAlternativeProviderJob(resumed,f.store.getChat(f.chat.id,f.user.id)!);assert.equal(f.jobs.getJob(job.id)?.status,"completed",f.jobs.getJob(job.id)?.error);
});

test("project model locks block selection and automatic fallback",async()=>{
 const f=await fixture(),job=f.start(),projects=await import("../lib/projects"),runtime=await import("../lib/model-chain-runtime");
 const project=projects.createProject({ownerId:f.user.id,name:"Locked agents",mode:"agents",defaultModelEnabled:true,defaultModelId:f.models[0].modelId,defaultModelParams:f.models[0].modelParams});
 f.store.updateChat(f.chat.id,{projectId:project.id},f.user.id);
 const route=await import("../app/api/chats/[id]/model-chain/route"),params={params:Promise.resolve({id:f.chat.id})};
 assert.equal((await route.PUT(request(f.token,{chainId:f.chain.id}),params)).status,409);
 assert.equal((await (await route.GET(request(f.token),params)).json()).chain,null);
 assert.equal(runtime.requestModelChainFallback(job.id,{code:"usage_limit_reached"},()=>{}),false);
});
test("deleting a configuration clears future selection while an active run retains its authorized snapshot",async()=>{
 const f=await fixture(),job=f.start(),runtime=await import("../lib/model-chain-runtime");
 f.chains.deleteModelChain(f.user.id,f.chain.id,f.chain.version);
 assert.equal(f.chains.chatModelChain(f.user.id,f.chat.id),null);
 assert.equal(f.jobs.getJob(job.id)?.modelChain?.id,f.chain.id);
 assert.equal(runtime.requestModelChainFallback(job.id,{code:"usage_limit_reached"},()=>{}),true);
});
test("fresh job processes initialize chain selection for an older supervisor's queued follow-up",async()=>{
 const f=await fixture(),job=f.start(),runtime=await import("../lib/model-chain-runtime");
 f.jobs.updateJob(job.id,{modelChain:undefined,modelId:f.models[2].modelId,modelParams:[]});
 const initialized=runtime.initializeJobModelChain(f.jobs.getJob(job.id)!);
 assert.equal(initialized?.modelId,f.models[0].modelId);
 assert.equal(initialized?.modelChain?.id,f.chain.id);
 assert.deepEqual(initialized?.modelParams,f.models[0].modelParams);
 f.chains.saveModelChain(f.user.id,{id:f.chain.id,version:f.chain.version,name:"New order",steps:[...f.chain.steps].reverse()});
 assert.equal(runtime.initializeJobModelChain(initialized!)?.modelChain?.steps[0].modelId,f.models[0].modelId);
});
test("selecting and clearing a chain uses the shared per-chat selection API",async()=>{
 const f=await fixture(),route=await import("../app/api/chats/[id]/model-chain/route"),params={params:Promise.resolve({id:f.chat.id})};
 const selected=await route.PUT(request(f.token,{chainId:f.chain.id}),params);assert.equal(selected.status,200);
 assert.equal((await selected.json()).selection.modelChainId,f.chain.id);
 const read=await route.GET(request(f.token),params);assert.equal((await read.json()).chain.id,f.chain.id);
 const clear=await route.PUT(request(f.token,{chainId:null,modelId:f.models[1].modelId,modelParams:[]}),params);assert.equal(clear.status,200);
 assert.equal(f.chains.chatModelChain(f.user.id,f.chat.id),null);
 assert.equal(f.store.getChatMetadata(f.chat.id,f.user.id)?.modelId,f.models[1].modelId);
});
