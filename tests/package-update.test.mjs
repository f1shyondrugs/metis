import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { createHash } from "node:crypto";
import { activatePackage,extractVerifiedPackage,downloadVerified,packageAssetName,atomicJson } from "../scripts/package-update-core.mjs";
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
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.data,"metis-package-transaction.json"))).phase,"complete");
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
