import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,linkSync} from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("native process cannot read another owner, app state, parent proc or leaked environment",{skip:process.platform!=="linux"||process.getuid?.()===0},async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-native-scope-")),data=path.join(root,"data"),workspace=path.join(root,"workspace"),other=path.join(root,"bob");
 for(const dir of [data,workspace,other])mkdirSync(dir);
 const secret=path.join(data,"chat.sqlite"),foreign=path.join(other,"secret"),receipts=path.join(root,"shared-receipts");mkdirSync(receipts);writeFileSync(secret,"APP-SECRET");writeFileSync(foreign,"BOB-SECRET");
 process.env.AI_CHAT_FILE_SNAPSHOT_DIR=receipts;
 Object.assign(process.env,{METIS_NATIVE_ISOLATION:"1",AI_CHAT_ROOT:process.cwd(),CHAT_DATA_DIR:data,CHAT_DB_PATH:path.join(data,"test.sqlite"),AI_CHAT_MCP_STATE_DIR:path.join(data,"mcp-state"),AGENT_CWD:workspace});
 try{
  const {createNativeRuntimeScope,nativeSandboxLaunch,assertNativeMcpServers}=await import("../lib/providers/native-sandbox");
  const scope=createNativeRuntimeScope("alice",workspace);
  const outside=spawnSync("/usr/bin/python3",["-c",`from pathlib import Path;assert Path(${JSON.stringify(secret)}).read_text();assert Path('/proc/${process.pid}/environ').read_bytes()`],{encoding:"utf8"});assert.equal(outside.status,0,outside.stderr);
  const launch=nativeSandboxLaunch("/usr/bin/python3",["-c",`import os,pathlib;assert not pathlib.Path(${JSON.stringify(secret)}).exists();assert not pathlib.Path(${JSON.stringify(foreign)}).exists();assert not pathlib.Path('/proc/${process.pid}/environ').exists();assert 'CHAT_PASSWORD' not in os.environ;assert 'LD_PRELOAD' not in os.environ;assert 'GCONV_PATH' not in os.environ;assert os.environ['OWN_PROVIDER_SECRET']=='OWN';pathlib.Path('own-file').write_text('allowed');print('ISOLATED')`],{CHAT_PASSWORD:"ROOT",LD_PRELOAD:"/evil.so",GCONV_PATH:workspace,BWRAP_TEST:"evil",OWN_PROVIDER_SECRET:"OWN"},[],scope);
  assert.equal(launch.env.LD_PRELOAD,undefined);assert.equal(launch.env.BWRAP_TEST,undefined);
  const result=spawnSync(launch.command,launch.args,{env:launch.env,cwd:launch.cwd,encoding:"utf8",timeout:20000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ISOLATED/);
  assert.throws(()=>nativeSandboxLaunch("/usr/bin/true",[],{},[other],scope),/another account/);
  const unsafe={...scope,workspace:data};assert.throws(()=>nativeSandboxLaunch("/usr/bin/true",[],{},[],unsafe),/protected/);
  assert.throws(()=>nativeSandboxLaunch("/usr/bin/true",[],{},[],{...scope,workspace:receipts}),/protected/);
  assert.throws(()=>assertNativeMcpServers({gateway:{type:"stdio"}},"alice"),/signed HTTP/);
  const token=`metis-v1.${Buffer.from(JSON.stringify({userId:"bob"})).toString("base64url")}.fake`;
  assert.throws(()=>nativeSandboxLaunch("/usr/bin/true",[],{METIS_MCP_SESSION_TOKEN:token},[],scope),/another account/);
  linkSync(secret,path.join(workspace,"preexisting-leak"));const denied=spawnSync(launch.command,launch.args,{env:launch.env,cwd:launch.cwd,encoding:"utf8",timeout:20000});assert.equal(denied.status,126);assert.doesNotMatch(denied.stderr,/APP-SECRET/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
