import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { startDetachedProcess,windowsHostOperation,windowsStopProbe } from "../scripts/package-windows-service.mjs";
import {scheduledUpdateScript} from "../scripts/package-windows-task.mjs";
import { once } from "node:events";
import { spawn,spawnSync,execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { activatePackage,extractVerifiedPackage,downloadVerified,packageAssetName,atomicJson,acquireUpdateLock,snapshotDatabase } from "../scripts/package-update-core.mjs";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const {resolveService}=require("../scripts/run-installed-service.cjs");
const tag="v1.2.3";
async function fixture(){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"metis-package-test-"));
  const root=path.join(home,"install"),data=path.join(home,"data"),payload=path.join(home,"payload");
  fs.mkdirSync(root);fs.mkdirSync(data);fs.mkdirSync(payload);
  for(const file of ["server.mjs","worker.ts","node_modules/tsx/dist/cli.mjs","lib/mcp-core/gateway-core.mjs",".next/BUILD_ID",process.platform==="win32"?".runtime/node.exe":".runtime/node"]){
    fs.mkdirSync(path.dirname(path.join(payload,file)),{recursive:true});
    fs.writeFileSync(path.join(payload,file),file===".next/BUILD_ID"?"test-build":"fixture");
  }
  fs.writeFileSync(path.join(payload,"package-manifest.json"),JSON.stringify({schemaVersion:1,tag,platform:process.platform,arch:process.arch,nodeMajor:22,buildId:"test-build",commit:"abc123"}));
  const archive=path.join(home,"package.tgz");
  await tar.c({file:archive,cwd:home,gzip:true},["payload"]);
  const events=[];
  const manager={preflight:async()=>events.push("preflight"),stop:async()=>events.push("stop"),start:async()=>events.push("start"),health:async()=>{events.push("health");return true;}};
  return {root,data,home,payload,archive,events,manager,close:()=>fs.rmSync(home,{recursive:true,force:true})};
}
test("Windows updater uses an independent task with current identity and no implicit elevation",()=>{
 const taskName="MetisUpdate-00000000-0000-0000-0000-000000000001";
 const source=scheduledUpdateScript({command:"node.exe",args:["C:/install/scripts/package-update-runner.mjs"],logFile:"C:/User's folder/update.log",installRoot:"C:/install",packageUpdate:true,taskName});
 assert.ok(source.includes("-UserId $sid")&&source.includes("if($elevated){'Highest'}else{'Limited'}"));
 assert.ok(source.includes("SessionId -eq 0"));
 assert.ok(!source.includes("-Password")&&!source.includes("S4U"));
 assert.ok(source.includes("Start-ScheduledTask"));
});
test("Windows task registration syntax is valid without creating a task",{skip:process.platform!=="win32"},()=>{
 const source=scheduledUpdateScript({command:"node.exe",args:["runner.mjs"],logFile:"C:/test/update.log",installRoot:"C:/test",packageUpdate:true,taskName:"MetisUpdate-00000000-0000-0000-0000-000000000001"});
 const encoded=Buffer.from(source,"utf16le").toString("base64");
 const check="$t=$null;$e=$null;[Management.Automation.Language.Parser]::ParseInput([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('"+encoded+"')),[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|ForEach-Object{$_.Message};exit 1};'TASK_SCRIPT_PARSE_OK'";
 assert.match(execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",check],{encoding:"utf8",windowsHide:true}),/TASK_SCRIPT_PARSE_OK/);
});
test("Windows scheduler children survive the updater action, without inherited time limits",{skip:process.platform!=="win32"||process.env.GITHUB_ACTIONS!=="true"},async()=>{
 const f=await fixture(),name="MetisUpdateFixture-"+crypto.randomUUID();
 const entry=path.join(f.home,"task-child.cjs"),pidFile=path.join(f.home,"child.pid"),parentFile=path.join(f.home,"parent.pid"),ended=path.join(f.home,"parent-ended"),stop=path.join(f.home,"stop");
 const q=value=>"'"+value.replaceAll("'","''")+"'";
 const run=script=>execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from("$ProgressPreference='SilentlyContinue';"+script,"utf16le").toString("base64")],{encoding:"utf8",windowsHide:true,timeout:15000});
 const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
 try{
  fs.writeFileSync(entry,"const fs=require('node:fs');fs.writeFileSync("+JSON.stringify(pidFile)+",String(process.pid));setInterval(()=>{if(fs.existsSync("+JSON.stringify(stop)+"))process.exit(0)},100);setTimeout(()=>process.exit(0),15000);");
  const action="[IO.File]::WriteAllText("+q(parentFile)+",[string]$PID);$arg='\"'+"+q(entry)+"+'\"';Start-Process -FilePath "+q(process.execPath)+" -ArgumentList $arg -WindowStyle Hidden;Unregister-ScheduledTask -TaskName "+q(name)+" -Confirm:$false;[IO.File]::WriteAllText("+q(ended)+",'ended')";
  const encoded=Buffer.from(action,"utf16le").toString("base64");
  run("$ErrorActionPreference='Stop';$id=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$p=New-ScheduledTaskPrincipal -UserId $id -LogonType S4U -RunLevel Limited;$a=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -EncodedCommand "+encoded+"';$s=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero);Register-ScheduledTask -TaskName "+q(name)+" -Action $a -Principal $p -Settings $s|Out-Null;Start-ScheduledTask -TaskName "+q(name));
  const deadline=Date.now()+10000;
  while(Date.now()<deadline&&(!fs.existsSync(pidFile)||!fs.existsSync(ended)))await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(fs.existsSync(pidFile)&&fs.existsSync(ended),"scheduled fixture must run and unregister its own definition");
  const parent=Number(fs.readFileSync(parentFile,"utf8")),child=Number(fs.readFileSync(pidFile,"utf8"));
  while(Date.now()<deadline&&alive(parent))await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(alive(parent),false);assert.equal(alive(child),true,"the new host must outlive its updater action");
  run("Unregister-ScheduledTask -TaskName "+q(name)+" -Confirm:$false -ErrorAction SilentlyContinue;exit 0");
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(alive(child),true,"removing the updater task definition must not terminate its new host");
 }finally{
  fs.writeFileSync(stop,"stop");
  try{run("Unregister-ScheduledTask -TaskName "+q(name)+" -Confirm:$false -ErrorAction SilentlyContinue;exit 0");}catch{}
  await new Promise(resolve=>setTimeout(resolve,300));f.close();
 }
});
test("a detached service start resolves on spawn, not service termination",async()=>{
 const child=await startDetachedProcess(process.execPath,["-e","setInterval(()=>{},1000)"]);
 try{assert.ok(child.pid);assert.equal(child.exitCode,null);}
 finally{child.kill();}
});
test("Windows shutdown waits for only the scoped host processes without killing them",async()=>{
 const f=await fixture();try{
  let checks=0;const calls=[];
  await windowsHostOperation(f.root,"stop",{sleep:async()=>{},run:async(command,args)=>{
    calls.push({command,args});
    if(command==="powershell.exe")return{stdout:++checks===1?"1":"0"};
    return{stdout:""};
  }});
  assert.equal(checks,2);assert.ok(calls[0].args.includes("--stop"));
  assert.ok(calls.every(call=>!call.command.includes("taskkill")));
  const script=windowsStopProbe(f.root);
  assert.ok(script.includes("Get-CimInstance")&&script.includes("ProcessId -ne "+process.pid));
  assert.ok(!script.includes("Stop-Process"));
 }finally{f.close();}
});
test("native Windows stop probe parses and ignores unrelated installations",{skip:process.platform!=="win32"},async()=>{
 const f=await fixture();let child;
 const probe=()=>execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",windowsStopProbe(f.root)],{encoding:"utf8",windowsHide:true,timeout:10000}).trim();
 try{
  assert.equal(probe(),"0");
  const entry=path.join(f.root,"server.mjs");fs.writeFileSync(entry,"setInterval(()=>{},1000)");
  child=spawn(process.execPath,[entry],{stdio:"ignore",windowsHide:true});await once(child,"spawn");
  assert.equal(probe(),"1","only this installation's service child must be counted");
  const exited=once(child,"exit");child.kill();await exited;child=undefined;
  assert.equal(probe(),"0");
 }finally{if(child)child.kill();f.close();}
});
test("SQLite snapshots include WAL rows, stay private and replace one bounded backup",async()=>{
 const f=await fixture();try{
  const {DatabaseSync}=await import("node:sqlite"),source=path.join(f.data,"db.sqlite"),target=path.join(f.data,"backup.sqlite");
  const db=new DatabaseSync(source);db.exec("PRAGMA journal_mode=WAL;CREATE TABLE records(value TEXT);INSERT INTO records VALUES ('first')");
  try{
   await snapshotDatabase(source,target);
   let copy=new DatabaseSync(target,{readOnly:true});assert.equal(copy.prepare("SELECT count(*) n FROM records").get().n,1);copy.close();
   db.exec("INSERT INTO records VALUES ('second')");await snapshotDatabase(source,target);
   copy=new DatabaseSync(target,{readOnly:true});assert.equal(copy.prepare("SELECT count(*) n FROM records").get().n,2);copy.close();
   assert.ok(!fs.existsSync(target+".new"));
   if(process.platform!=="win32")assert.equal(fs.statSync(target).mode&0o777,0o600);
  }finally{db.close();}
 }finally{f.close();}
});
test("an owned live update lock is never stolen and releases only its own lock",async()=>{
 const f=await fixture();try{
  const lock=path.join(f.home,"lock"),release=acquireUpdateLock(lock);
  assert.throws(()=>acquireUpdateLock(lock),/already running/);
  assert.ok(fs.existsSync(lock));release();assert.ok(!fs.existsSync(lock));
 }finally{f.close();}
});
test("asset names bind exact tag, OS and architecture",()=>{
  assert.equal(packageAssetName(tag,"linux","arm64"),"metis-server-v1.2.3-linux-arm64.tar.gz");
  assert.throws(()=>packageAssetName("../escape"),/Unsupported/);
  assert.throws(()=>packageAssetName(tag,"freebsd","x64"),/Unsupported/);
});
test("complete package switches pointer only after preflight and retains user data",async()=>{
  const f=await fixture();try{
    fs.writeFileSync(path.join(f.root,"user-notes.txt"),"keep");
    const result=await activatePackage({installRoot:f.root,dataDir:f.data,tag,archive:f.archive,manager:f.manager});
    assert.deepEqual(f.events,["preflight","stop","start","health"]);
    assert.equal(fs.readFileSync(path.join(f.root,"user-notes.txt"),"utf8"),"keep");
    const launch=resolveService(f.root,"app",{CHAT_DATA_DIR:f.data,SECRET_FIXTURE:"not-exported"});
    assert.equal(launch.cwd,result.active);assert.equal(launch.env.CHAT_DATA_DIR,f.data);
    assert.equal(launch.env.AI_CHAT_INSTALL_DIR,fs.realpathSync(f.root));
    assert.equal(launch.env.NEXT_DIST_DIR,".next");
    assert.ok(launch.env.GIT_CEILING_DIRECTORIES.includes(fs.realpathSync(f.root)));
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.data,"metis-package-transaction.json"))).phase,"complete");
  }finally{f.close();}
});
test("relative persistent paths stay anchored to the stable install, not a new code release",async()=>{
 const f=await fixture();try{
  const launch=resolveService(f.root,"app",{CHAT_DATA_DIR:"custom-data",CHAT_DB_PATH:"state/chat.sqlite",AI_CHAT_MCP_STATE_DIR:"mcp-state"});
  assert.equal(launch.env.CHAT_DATA_DIR,path.join(fs.realpathSync(f.root),"custom-data"));
  assert.equal(launch.env.CHAT_DB_PATH,path.join(fs.realpathSync(f.root),"state/chat.sqlite"));
  assert.equal(launch.env.AI_CHAT_MCP_STATE_DIR,path.join(fs.realpathSync(f.root),"mcp-state"));
 }finally{f.close();}
});
test("package Git identity never inherits the bootstrap parent checkout",async()=>{
  const f=await fixture();try{
    for(const args of [["init","-q"],["config","user.name","fixture"],["config","user.email","fixture@example.invalid"]]){
      const result=spawnSync("git",args,{cwd:f.root,encoding:"utf8"});assert.equal(result.status,0,result.stderr);
    }
    fs.writeFileSync(path.join(f.root,"tracked"),"fixture");
    assert.equal(spawnSync("git",["add","tracked"],{cwd:f.root}).status,0);
    assert.equal(spawnSync("git",["commit","-qm","fixture"],{cwd:f.root}).status,0);
    const result=await activatePackage({installRoot:f.root,dataDir:f.data,tag,archive:f.archive,manager:f.manager});
    const launch=resolveService(f.root,"app",{PATH:process.env.PATH,CHAT_DATA_DIR:f.data});
    const git=spawnSync("git",["rev-parse","HEAD"],{cwd:result.active,env:launch.env,encoding:"utf8"});
    assert.notEqual(git.status,0,"a packaged app must use its release manifest, not the old checkout");
  }finally{f.close();}
});
test("preflight failure never stops services or switches the pointer",async()=>{
  const f=await fixture();try{
    f.manager.preflight=async()=>{throw Error("wrong native ABI");};
    await assert.rejects(activatePackage({installRoot:f.root,dataDir:f.data,tag,archive:f.archive,manager:f.manager}),/native ABI/);
    assert.deepEqual(f.events,[]);assert.ok(!fs.existsSync(path.join(f.root,".metis-release.json")));
  }finally{f.close();}
});
test("bad health restores old pointer before restarting and verifies rollback",async()=>{
  const f=await fixture();try{
    const old={schemaVersion:1,active:"v1.0.0-linux-x64-old"};
    atomicJson(path.join(f.root,".metis-release.json"),old);
    f.manager.health=async target=>{f.events.push(target?"new-health":"old-health");return target===null;};
    await assert.rejects(activatePackage({installRoot:f.root,dataDir:f.data,tag,archive:f.archive,manager:f.manager}),/health/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,".metis-release.json"))),old);
    assert.deepEqual(f.events,["preflight","stop","start","new-health","stop","start","old-health"]);
  }finally{f.close();}
});
test("interrupted activation recovers the durable old pointer before new staging",async()=>{
  const f=await fixture();try{
    const old={schemaVersion:1,active:"v1.0.0-linux-x64-old"};
    atomicJson(path.join(f.root,".metis-release.json"),{schemaVersion:1,active:"v1.1.0-linux-x64-crashed"});
    atomicJson(path.join(f.data,"metis-package-transaction.json"),{schemaVersion:1,installRoot:fs.realpathSync(f.root),phase:"activated",previousPointer:old});
    await activatePackage({installRoot:f.root,dataDir:f.data,tag,archive:f.archive,manager:f.manager});
    assert.deepEqual(f.events.slice(0,3),["stop","start","health"]);
  }finally{f.close();}
});
test("escaping symlinks and extraction size limits are rejected without writing outside staging",async()=>{
  const f=await fixture();try{
    fs.symlinkSync("../../outside",path.join(f.payload,"escape"));
    await tar.c({file:f.archive,cwd:f.home,gzip:true},["payload"]);
    await assert.rejects(extractVerifiedPackage(f.archive,path.join(f.home,"stage")),/Escaping/);
    fs.unlinkSync(path.join(f.payload,"escape"));
    await tar.c({file:f.archive,cwd:f.home,gzip:true},["payload"]);
    await assert.rejects(extractVerifiedPackage(f.archive,path.join(f.home,"stage"),{maxBytes:1}),/limit/);
    assert.ok(!fs.existsSync(path.join(f.home,"outside")));
  }finally{f.close();}
});
test("SHA256 is checked while streaming; mismatches leave no partial download",async()=>{
  const f=await fixture();try{
    const bytes=Buffer.from("verified-package");
    const digest=createHash("sha256").update(bytes).digest("hex");
    const output=path.join(f.home,"download");
    await downloadVerified("https://example.test/package",output,digest,{fetcher:async()=>new Response(bytes)});
    assert.deepEqual(fs.readFileSync(output),bytes);fs.unlinkSync(output);
    await assert.rejects(downloadVerified("https://example.test/package",output,"0".repeat(64),{fetcher:async()=>new Response(bytes)}),/SHA256/);
    assert.ok(!fs.existsSync(output));
  }finally{f.close();}
});
