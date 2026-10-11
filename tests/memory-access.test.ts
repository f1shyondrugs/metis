
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const dir = mkdtempSync(path.join(os.tmpdir(), "metis-memory-access-"));
process.env.CHAT_DATA_DIR = dir;
process.env.CHAT_DB_PATH = path.join(dir, "chat.sqlite");
process.env.AI_CHAT_MCP_STATE_DIR = dir;
process.env.MCP_BEARER_TOKEN = "memory-policy-test";
process.env.AI_CHAT_INTERNAL_ORIGIN = "http://memory-policy.invalid";
const modules = Promise.all([
 import("../lib/db-store"), import("../lib/projects"),
 import("../app/api/internal/mcp-memory/route"), import("../lib/context-scope"),
 import("../lib/auth"), import("../lib/db-jobs"), import("../lib/sqlite"),
]);
let m: Awaited<typeof modules>;
let owner: string;
before(async () => { m = await modules; owner = m[4].createUser("memory-owner", "test-password").id; });
after(async () => { await rm(dir, {recursive:true,force:true}); });
async function call(chatId: string, body: Record<string,unknown>, userId = owner, jobId?: string) {
 const leasedChat = m[0].getChat(chatId,owner) ?? m[0].createChat("Lease fallback",undefined,owner);
 jobId ??= m[5].getActiveJob(leasedChat.id,owner)?.id ?? m[5].enqueueJob({chatId:leasedChat.id,userId:owner,message:"Memory call"}).id;
 const workerId = "memory-test-worker";
 const token = "lease-" + jobId;
 m[6].getDatabase().prepare("INSERT OR REPLACE INTO job_leases (job_id,worker_id,lease_token,expires_at,updated_at) VALUES (?,?,?,?,?)")
  .run(jobId,workerId,token,new Date(Date.now()+60000).toISOString(),new Date().toISOString());
 const response = await m[2].POST(new Request("http://localhost/api/internal/mcp-memory", {
  method:"POST",
  headers:{"Authorization":"Bearer memory-policy-test","Content-Type":"application/json",
   "X-AI-Chat-Worker-Id":workerId,"X-AI-Chat-Lease-Token":token,
   "X-AI-Chat-Id":chatId,"X-AI-Chat-User-Id":userId,...(jobId?{"X-AI-Chat-Job-Id":jobId}:{})},
  body:JSON.stringify(body),
 }));
 return {status:response.status, body:await response.json()};
}
function fixture(mode: "default"|"project_only" = "default") {
 const project = m[1].createProject({name:"Scoped memories",memoryMode:mode,ownerId:owner});
 const chat = m[0].createChat("Project chat",undefined,owner,undefined,{projectId:project.id});
 return {project,chat};
}
test("project chats default to project memory and can explicitly choose global", async () => {
 const {project,chat} = fixture();
 const local = await call(chat.id,{action:"add",content:"Project fact"});
 assert.equal(local.status,200); assert.equal(local.body.scope,"project");
 assert.equal(m[1].listProjectMemories(project.id,owner).length,1);
 const global = await call(chat.id,{action:"add",scope:"global",content:"Account preference"});
 assert.equal(global.status,200); assert.equal(global.body.scope,"global");
 const list = await call(chat.id,{action:"list"});
 assert.deepEqual(list.body.memories.map((x:{id:string})=>x.id),[local.body.memory.id]);
 assert.deepEqual(list.body.availableScopes,["chat","project","global"]);
 assert((await call(chat.id,{action:"list",scope:"global"})).body.memories.some((x:{id:string})=>x.id===global.body.memory.id));
 assert.equal((await call(chat.id,{action:"edit",scope:"global",id:global.body.memory.id,content:"Updated preference"})).status,200);
 assert.equal((await call(chat.id,{action:"delete",scope:"global",id:global.body.memory.id})).status,200);
});
test("switch off denies every global action, preserves globals, and permits project CRUD", async () => {
 const {project,chat} = fixture("project_only");
 const global = m[0].createMemory("Secret global fact",[],owner);
 const before = m[0].listMemories(owner);
 for (const action of ["list","add","edit","delete","access"]) {
  const result = await call(chat.id,{action,scope:"global",id:global.id,content:"Must not write"});
  assert.equal(result.status,403,action);
  assert.equal(result.body.memories,undefined);
 }
 assert.deepEqual(m[0].listMemories(owner),before);
 assert.deepEqual(m[3].globalFactsForScope({chatId:chat.id,ownerId:owner}),[]);
 const created = await call(chat.id,{action:"add",content:"Local only"});
 assert.equal(created.status,200);
 assert.equal((await call(chat.id,{action:"edit",id:created.body.memory.id,content:"Edited local"})).status,200);
 assert.equal((await call(chat.id,{action:"delete",id:created.body.memory.id})).status,200);
 assert.deepEqual(m[1].listProjectMemories(project.id,owner),[]);
});
test("policy changes apply on the next tool call without recreating the chat", async () => {
 const {project,chat} = fixture();
 assert.equal((await call(chat.id,{action:"access",scope:"global"})).status,200);
 m[1].updateProject(project.id,{memoryMode:"project_only"},owner);
 assert.equal((await call(chat.id,{action:"access",scope:"global"})).status,403);
 m[1].updateProject(project.id,{memoryMode:"default"},owner);
 assert.equal((await call(chat.id,{action:"access",scope:"global"})).status,200);
});
test("invalid, foreign, missing-project, incognito and forged run contexts fail closed", async () => {
 const {chat} = fixture();
 const other = m[4].createUser("other-memory-owner","password").id;
 assert.equal((await call(chat.id,{action:"list"},other)).status,404);
 assert.equal((await call("",{action:"list"})).status,404);
 assert.equal((await call(chat.id,{action:"list",scope:"all"})).status,400);
 const orphan = m[0].createChat("Missing project",undefined,owner,undefined,{projectId:"missing"});
 assert.equal((await call(orphan.id,{action:"list"})).status,404);
 assert.deepEqual(m[3].globalFactsForScope({chatId:orphan.id,ownerId:owner}),[]);
 const incognito = m[0].createChat("Private",undefined,owner,undefined,{incognito:true});
 assert.equal((await call(incognito.id,{action:"list"})).status,403);
 const otherChat = m[0].createChat("Other run",undefined,owner);
 const job = m[5].enqueueJob({chatId:otherChat.id,userId:owner,message:"Scoped job"});
 assert.equal((await call(chat.id,{action:"list"},owner,job.id)).status,403);
});
test("chats outside projects retain global defaults and reject project scope", async () => {
 const chat = m[0].createChat("General",undefined,owner);
 assert.equal((await call(chat.id,{action:"list"})).body.scope,"global");
 assert.equal((await call(chat.id,{action:"list",scope:"project"})).status,400);
});

test("personal context tools check the project policy before contacting the global hub", async (t) => {
 const gateway = await import("../lib/mcp-core/gateway-core.mjs");
 for (const name of ["list_memories","add_memory","edit_memory","delete_memory"]) {
  const definition = gateway.tools.find((item: {name:string}) => item.name===name);
  assert.ok(definition);
  const properties = definition.inputSchema.properties as {scope:{enum:string[]}};
  assert.deepEqual(properties.scope.enum,["chat","project","global"]);
 }
 const calls: string[] = [];
 t.mock.method(globalThis,"fetch",async (url: unknown) => {
  calls.push(String(url));
  return Response.json({error:"Global memory disabled"},{status:403});
 });
 for (const name of ["context_search","context_profile","context_remember"]) {
  calls.length = 0;
  const result = await gateway.dispatchGatewayTool(name,{query:"profile",fact_id:"x",text:"x"},{
   auditCall:false,context:{chatId:"test",jobId:"job",userId:owner,mode:"agent",runtimeMode:"full-access"},
  });
  assert.equal((result as {isError?:boolean}).isError,true);
  assert.equal(calls.length,1);
  assert.match(calls[0],/mcp-memory/);
 }
});

test("enabled global policy allows hub access and forwards the signed run context", async (t) => {
 const gateway = await import("../lib/mcp-core/gateway-core.mjs");
 const calls: Array<{url:string;init:RequestInit}> = [];
 t.mock.method(globalThis,"fetch",async (url: unknown,init:RequestInit) => {
  calls.push({url:String(url),init});
  return Response.json(calls.length===1?{scope:"global"}:{profile:"Allowed"});
 });
 const result = await gateway.dispatchGatewayTool("context_profile",{},{
  auditCall:false,context:{chatId:"scoped-chat",jobId:"leased-job",userId:owner,runtimeMode:"full-access"},
 });
 assert.notEqual((result as {isError?:boolean}).isError,true);
 assert.equal(calls.length,2);
 assert.match(calls[0].url,/mcp-memory/);
 assert.equal((calls[0].init.headers as Record<string,string>)["X-AI-Chat-Id"],"scoped-chat");
 assert.equal((calls[0].init.headers as Record<string,string>)["X-AI-Chat-Job-Id"],"leased-job");
 assert.deepEqual(JSON.parse(String(calls[0].init.body)),{action:"access",scope:"global"});
 assert.match(calls[1].url,/v1\/profile/);
});
test("gateway memory writes preserve the chosen scope through transport", async (t) => {
 const gateway = await import("../lib/mcp-core/gateway-core.mjs");
 let payload: Record<string,unknown> = {};
 t.mock.method(globalThis,"fetch",async (_url: unknown,init:RequestInit) => {
  payload=JSON.parse(String(init.body));
  return Response.json({scope:payload.scope,memory:{id:"created"}});
 });
 const result = await gateway.dispatchGatewayTool("add_memory",{scope:"global",content:"Account fact"},{
  auditCall:false,context:{chatId:"scoped-chat",jobId:"leased-job",userId:owner,runtimeMode:"full-access"},
 });
 assert.notEqual((result as {isError?:boolean}).isError,true);
 assert.deepEqual(payload,{scope:"global",content:"Account fact",action:"add"});
});


test("one save tool routes all three scopes and returns the same available choices for every action", async (t) => {
 const {chat} = fixture();
 for (const scope of ["chat", "project", "global"] as const) {
  const expected = ["chat", "project", "global"];
  const saved = await call(chat.id, {action:"add", scope, content:`Scoped ${scope} fact`});
  assert.equal(saved.status, 200);
  assert.equal(saved.body.scope, scope);
  assert.deepEqual(saved.body.availableScopes, expected);
  const id = saved.body.memory.id;
  for (const action of ["access", "list", "edit", "delete"]) {
   const result = await call(chat.id, {action, scope, id, content:`Updated ${scope} fact`});
   assert.equal(result.status, 200, `${scope}/${action}`);
   assert.equal(result.body.scope, scope);
   assert.deepEqual(result.body.availableScopes, expected, `${scope}/${action}`);
  }
 }
 const gateway = await import("../lib/mcp-core/gateway-core.mjs");
 const saves = gateway.tools.filter((tool: {name:string}) => /^(add|save|create)_(?:(chat|project|global)_)?memory$/.test(tool.name));
 assert.deepEqual(saves.map((tool: {name:string}) => tool.name), ["add_memory"]);
 const calls: Record<string, unknown>[] = [];
 t.mock.method(globalThis, "fetch", async (_url: unknown, init:RequestInit) => {
  const payload = JSON.parse(String(init.body)); calls.push(payload);
  return Response.json({scope:payload.scope, memory:{id:"saved"}});
 });
 for (const scope of ["chat", "project", "global"]) {
  const result = await gateway.dispatchGatewayTool("add_memory", {scope,content:"Scoped transport"}, {
   auditCall:false, context:{chatId:chat.id,jobId:"leased-job",userId:owner,runtimeMode:"full-access"},
  });
  assert.notEqual((result as {isError?:boolean}).isError, true);
  assert.deepEqual(calls.at(-1), {scope, content:"Scoped transport", action:"add"});
 }
});

test("scope choices respect ordinary chats, project policy and Incognito consistently", async () => {
 const contract = await import("../lib/memory-scopes.mjs");
 assert.deepEqual(contract.MEMORY_SCOPES, ["chat", "project", "global"]);
 assert.deepEqual(contract.availableMemoryScopes(), ["chat", "global"]);
 assert.deepEqual(contract.availableMemoryScopes({hasProject:true}), ["chat", "project", "global"]);
 assert.deepEqual(contract.availableMemoryScopes({hasProject:true,includeGlobal:false}), ["chat", "project"]);
 assert.deepEqual(contract.availableMemoryScopes({hasProject:true,incognito:true}), []);
 for (const invalid of ["agent", "workspace", "all", null, {}, 1]) assert.equal(contract.isMemoryScope(invalid), false);
 const ordinary = m[0].createChat("Ordinary scope choices", undefined, owner);
 for (const scope of ["chat", "global"]) {
  const result = await call(ordinary.id, {action:"access",scope});
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.availableScopes, ["chat", "global"]);
 }
 const {chat} = fixture("project_only");
 for (const scope of ["chat", "project"]) {
  const result = await call(chat.id, {action:"access",scope});
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.availableScopes, ["chat", "project"]);
 }
 assert.equal((await call(chat.id, {action:"add",scope:"global",content:"Blocked"})).status,403);
});
