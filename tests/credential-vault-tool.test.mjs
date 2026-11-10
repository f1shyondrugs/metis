import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";

test("the real credential vault tool is read-only and forwards only authenticated lease context",async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),"metis-vault-tool-"));
 Object.assign(process.env,{AI_CHAT_ROOT:dir,AI_CHAT_MCP_STATE_DIR:path.join(dir,"state"),AI_CHAT_INTERNAL_ORIGIN:"http://127.0.0.1:1",AI_CHAT_INTERNAL_URL:"http://127.0.0.1:1/api/internal/mcp-question",MCP_BEARER_TOKEN:"TEST-Vault-Tool"});
 const {tools,dispatchGatewayTool,modeToolCategory}=await import("../lib/mcp-core/gateway-core.mjs");
 const definitions=tools.filter(tool=>tool.name==="credential_vault_list");assert.equal(definitions.length,1);assert.equal(definitions[0].annotations.readOnlyHint,true);assert.equal(modeToolCategory("credential_vault_list"),"read");
 assert.equal(definitions[0].inputSchema.additionalProperties,false);assert.deepEqual(definitions[0].inputSchema.properties,{});
 const context={chatId:"test-chat",userId:"test-owner",jobId:"test-job",workerId:"test-worker",leaseToken:"test-lease"};
 let listed=0;
 t.mock.method(globalThis,"fetch",async(url,options)=>{
  const headers=new Headers(options.headers);
  assert.equal(headers.get("authorization"),"Bearer TEST-Vault-Tool");
  assert.equal(headers.get("x-ai-chat-user-id"),context.userId);assert.equal(headers.get("x-ai-chat-id"),context.chatId);assert.equal(headers.get("x-ai-chat-job-id"),context.jobId);
  assert.equal(headers.get("x-ai-chat-worker-id"),context.workerId);assert.equal(headers.get("x-ai-chat-lease-token"),context.leaseToken);
  if(options.method==="GET")return Response.json({waitingForUser:false});
  assert.equal(new URL(url).pathname,"/api/internal/mcp-credentials");assert.equal(options.body,"{}");listed++;
  return Response.json({credentials:[{kind:"browser",origin:"https://portal.test",usage:"browser_request_login"}]});
 });
 const call=(extra={},args={})=>dispatchGatewayTool("credential_vault_list",args,{context:{...context,...extra},auditCall:false});
 try{
  assert.equal((await call({userId:""})).isError,true);assert.equal((await call({jobId:""})).isError,true);
  assert.equal((await call({}, {owner:"another-owner"})).isError,true);
  assert.equal(listed,0);
  const result=await call({modePolicy:JSON.stringify({allowedCategories:["read"]})});assert(!result.isError,JSON.stringify(result));
  assert.equal(listed,1);assert.match(JSON.stringify(result),/portal\.test/);
  assert.equal((await call({modePolicy:JSON.stringify({allowedCategories:["read"],toolOverrides:{credential_vault_list:false}})})).isError,true);
  assert.equal(listed,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
