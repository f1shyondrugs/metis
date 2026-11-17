import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";

test("actual gateway survives a child OOM and kills timed-out descendants",{
 skip:process.env.METIS_TEST_SYSTEMD_SCOPES!=="1",timeout:40000,
},async()=>{
 const root=mkdtempSync(path.join(tmpdir(),"metis-scope-gateway-"));
 Object.assign(process.env,{AI_CHAT_ROOT:root,AI_CHAT_MCP_STATE_DIR:path.join(root,"state"),
  AI_CHAT_INTERNAL_ORIGIN:"http://127.0.0.1:1",MCP_BEARER_TOKEN:"synthetic-scope-test",
  MCP_ALLOW_ROOT_AGENTS:"1",MCP_IS_HOST_ADMIN:"1",MCP_OS_UID:"0",MCP_OS_GID:"0",
  MCP_OS_USERNAME:"root",MCP_AGENT_CWD:root,METIS_TOOL_MEMORY_MAX_MB:"96"});
 const {dispatchGatewayTool}=await import("../lib/mcp-core/gateway-core.mjs");
 const context={userId:"synthetic-scope-owner",isHostAdmin:true,runtimeMode:"agent",uid:0,gid:0,
  osUsername:"root",home:root,workspaceRoot:root,allowRoot:true};
 const call=async(command,timeout=5)=>{
  const result=await dispatchGatewayTool("execute_command",{command,cwd:root,timeout},{context,auditCall:false});
  assert.ok(!result.isError,JSON.stringify(result));
  return JSON.parse(result.content.filter(x=>x.type==="text").map(x=>x.text).join("\n"));
 };
 try{
  const first=await call("cat /proc/self/cgroup; pwd");
  assert.match(first.stdout,/metis-tool-.*\.scope/);assert.ok(first.stdout.includes(root));
  const hog=await call(`'${process.execPath}' -e 'const x=[]; setInterval(()=>x.push(Buffer.alloc(8*1024*1024,1)),5)'`,10);
  assert.notEqual(hog.exit_code,0,"child memory exhaustion must be reported as command failure");
  const after=await call("printf GATEWAY_AFTER_OOM_OK");
  assert.equal(after.stdout,"GATEWAY_AFTER_OOM_OK");
  const timeout=await call("cat /proc/self/cgroup; (trap '' TERM; sleep 30) & wait",1);
  assert.notEqual(timeout.exit_code,0);
  const scope=timeout.stdout.match(/metis-tool-[a-f0-9-]+\.scope/)?.[0];assert.ok(scope,timeout.stdout);
  let active="";
  try{active=execFileSync("systemctl",["show",scope,"-p","ActiveState","--value"],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();}catch{}
  assert.ok(active!=="active"&&active!=="activating","timed out invocation must leave no running scope");
  const last=await call("printf GATEWAY_AFTER_TIMEOUT_OK");assert.equal(last.stdout,"GATEWAY_AFTER_TIMEOUT_OK");
 }finally{rmSync(root,{recursive:true,force:true});}
});
