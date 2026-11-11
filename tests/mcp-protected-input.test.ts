import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
test("protected MCP requests preserve account/job/target binding and never store plaintext",async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-mcp-input-"));
 Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:path.join(root,"data"),AI_CHAT_MCP_STATE_DIR:path.join(root,"state"),AI_CHAT_SECRETS_KEY:"02".repeat(32)});
 mkdirSync(path.join(root,"state"),{recursive:true});
 const entry={id:"icloud-test",ownerId:"owner-a",kind:"stdio",name:"Test calendar",command:"node",args:[],enabled:false,env:{EXISTING:"old-value"}};
 const registry=path.join(root,"state","registry.json");
 writeFileSync(registry,JSON.stringify({version:1,servers:[entry]}));
 const {prepareMcpInput,fillMcpInput,mcpInputStatus}=await import("../lib/mcp-protected-input");
 const {getDatabase}=await import("../lib/sqlite");
 try{
  await assert.rejects(()=>prepareMcpInput("owner-b","chat","job",{server:entry.id,fields:["PASSWORD"]}));
  const secure=await prepareMcpInput("owner-a","chat","job",{server:entry.id,fields:["PASSWORD"]});
  assert.equal(secure.kind,"mcp");assert.deepEqual(secure.envFields,["PASSWORD"]);
  assert.equal(mcpInputStatus("owner-a","chat","job",secure.requestId).filled,false);
  await assert.rejects(()=>fillMcpInput("owner-a","other-chat","job",secure.requestId,{PASSWORD:"synthetic-password"}));
  await assert.rejects(()=>fillMcpInput("owner-a","chat","other-job",secure.requestId,{PASSWORD:"synthetic-password"}));
  await assert.rejects(()=>fillMcpInput("owner-a","chat","job",secure.requestId,{PASSWORD:"synthetic-password",OTHER:"bad"}));
  await fillMcpInput("owner-a","chat","job",secure.requestId,{PASSWORD:"synthetic-password"});
  assert.equal(mcpInputStatus("owner-a","chat","job",secure.requestId).filled,true);
  assert(!readFileSync(registry,"utf8").includes("synthetic-password"));
  assert(!JSON.stringify(getDatabase().prepare("SELECT * FROM mcp_protected_requests").all()).includes("synthetic-password"));
  await assert.rejects(()=>fillMcpInput("owner-a","chat","job",secure.requestId,{PASSWORD:"again"}));
  const stale=await prepareMcpInput("owner-a","chat","job",{server:entry.id,fields:["PASSWORD"]});
  const changed=JSON.parse(readFileSync(registry,"utf8"));changed.servers[0].command="other";writeFileSync(registry,JSON.stringify(changed));
  await assert.rejects(()=>fillMcpInput("owner-a","chat","job",stale.requestId,{PASSWORD:"not-written"}),/changed/);
  assert(!readFileSync(registry,"utf8").includes("not-written"));
 }finally{rmSync(root,{recursive:true,force:true});}
});
