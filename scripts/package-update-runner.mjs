import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { activatePackage, downloadVerified, packageAssetName, atomicJson } from "./package-update-core.mjs";
import { pruneManagedReleases } from "../public/install/release-retention.mjs";
const run=promisify(execFile);
const {values}=parseArgs({options:{"install-dir":{type:"string"},"data-dir":{type:"string"},tag:{type:"string"},"service-name":{type:"string"},repo:{type:"string"}}});
const root=fs.realpathSync(values["install-dir"]),data=path.resolve(values["data-dir"]);
const tag=values.tag,service=values["service-name"],repo=values.repo;
if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(service)||!/^[-\w]+\/[-\w]+$/.test(repo))throw Error("Invalid update target");
const name=packageAssetName(tag);
const diagnostic=path.join(data,"metis-package-diagnostics.json");
const events=[];
function record(phase,code){events.push({time:new Date().toISOString(),phase,...(code?{code}:{})});atomicJson(diagnostic,{schemaVersion:1,tag,platform:process.platform,arch:process.arch,events:events.slice(-100)});console.log("Package update: "+phase);}
async function command(executable,args){await run(executable,args,{cwd:root,timeout:60000,windowsHide:true,maxBuffer:256*1024});}
const units=[service+".service",service+"-worker.service",service+"-mcp.service"];
const uid=typeof process.getuid==="function"?process.getuid():null;
const plists=["app","worker","mcp"].map(role=>path.join(os.homedir(),"Library/LaunchAgents",service+"-"+role+".plist"));
const oldNode=process.execPath;
const host=path.join(root,"windows-script-host.mjs");
function windowsHost(action){
  if(fs.existsSync(path.join(root,"MetisHost.exe")))return command(path.join(root,"MetisHost.exe"),action==="stop"?["--stop"]:[]);
  if(action==="stop")return command(oldNode,[host,"--stop"]);
  const child=spawn(oldNode,[host],{cwd:root,env:process.env,detached:true,stdio:"ignore",windowsHide:true});child.unref();
  return new Promise((resolve,reject)=>{child.once("spawn",resolve);child.once("error",reject);});
}
const manager={
  async preflight(stage){
    const node=path.join(stage,".runtime",process.platform==="win32"?"node.exe":"node");
    const result=await run(node,["--input-type=module","-e","import {createRequire} from 'node:module'; const require=createRequire(process.cwd()+'/package.json'); require('node:sqlite'); require('node-pty'); require.resolve('tsx'); console.log(process.versions.node.split('.')[0]);"],{cwd:stage,timeout:30000,maxBuffer:65536,windowsHide:true});
    if(result.stdout.trim()!=="22")throw Error("Native runtime preflight failed");
    const space=fs.statfsSync(root);if(space.bavail*space.bsize<256*1024**2)throw Error("Insufficient space for update activation");
  },
  async snapshot(){
    const database=process.env.CHAT_DB_PATH||path.join(data,"chat.sqlite");
    if(!fs.existsSync(database))return;
    const {DatabaseSync,backup}=await import("node:sqlite");
    if(typeof backup!=="function")throw Error("Node 22.16 or newer is required for consistent database backups");
    const target=path.join(data,"metis-pre-update.sqlite"),temporary=target+".new";
    fs.rmSync(temporary,{force:true});
    const db=new DatabaseSync(database,{readOnly:true});
    try{await backup(db,temporary);fs.renameSync(temporary,target);}
    finally{db.close();fs.rmSync(temporary,{force:true});}
    record("database-backup");
  },
  async stop(){
    if(process.platform==="linux")await command("systemctl",["stop",...units]);
    else if(process.platform==="darwin")for(const plist of plists)await command("launchctl",["bootout","gui/"+uid,plist]).catch(async()=>{const label=path.basename(plist,".plist");try{await command("launchctl",["print","gui/"+uid+"/"+label]);throw Error("Service did not stop");}catch(error){if(error.message==="Service did not stop")throw error;}});
    else await windowsHost("stop");
  },
  async start(){
    if(process.platform==="linux")await command("systemctl",["start",...units]);
    else if(process.platform==="darwin")for(const plist of plists)await command("launchctl",["bootstrap","gui/"+uid,plist]);
    else await windowsHost("start");
  },
  async health(_target,manifest){
    const port=Number(process.env.PORT||3100);
    if(!Number.isInteger(port)||port<1||port>65535)throw Error("Invalid web port");
    const origin="http://127.0.0.1:"+port;
    for(let attempt=0;attempt<60;attempt++){
      try{
        const [status,version,home]=await Promise.all([
          fetch(origin+"/api/status",{signal:AbortSignal.timeout(3000)}),
          fetch(origin+"/api/system/version",{signal:AbortSignal.timeout(3000)}),
          fetch(origin+"/",{signal:AbortSignal.timeout(3000)}),
        ]);
        const state=await status.json(),identity=await version.json(),html=await home.text();
        const asset=html.match(/\/_next\/static\/[^"'<>\s]+\.js/)?.[0];
        if(status.ok&&state.worker?.ok&&state.mcp?.ok&&home.ok&&asset&&(!manifest||identity.release?.tag===manifest.tag&&identity.release?.commit===manifest.commit)){
          const script=await fetch(origin+asset,{signal:AbortSignal.timeout(3000)});
          if(script.ok)return true;
        }
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    return false;
  },
};
const archive=path.join(data,"metis-package-"+process.pid+".tar.gz");
try{
  record("lookup");
  const response=await fetch("https://api.github.com/repos/"+repo+"/releases/tags/"+encodeURIComponent(tag),{headers:{Accept:"application/vnd.github+json","User-Agent":"Metis-native-updater"},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error("Release metadata unavailable");
  const release=await response.json();
  const asset=release.assets?.find(asset=>asset.name===name);
  if(release.tag_name!==tag||release.draft||!asset)throw Error("No prebuilt package for this platform; no local build was started");
  const canonical=new URL(release.html_url);
  if(canonical.origin!=="https://github.com"||canonical.pathname.split("/")[1].toLowerCase()!==repo.split("/")[0].toLowerCase()||!canonical.pathname.includes("/releases/tag/"))throw Error("Unexpected release identity");
  const canonicalRepo=canonical.pathname.split("/").slice(1,3).join("/");
  function assertAssetOrigin(value){
    const assetUrl=new URL(value);
    if(assetUrl.origin!=="https://github.com"||!assetUrl.pathname.startsWith("/"+canonicalRepo+"/releases/download/"+tag+"/"))throw Error("Unexpected release asset origin");
  }
  let checksum=/^sha256:([a-f0-9]{64})$/i.exec(asset.digest||"")?.[1];
  if(!checksum){
    const item=release.assets.find(asset=>asset.name===name+".sha256");
    if(!item || item.size>1024)throw Error("Release package checksum is missing or invalid");
    assertAssetOrigin(item.browser_download_url);
    const response=await fetch(item.browser_download_url,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error("Package checksum unavailable");
    const text=await response.text();if(text.length>1024)throw Error("Invalid package checksum");
    const match=/^([a-f0-9]{64})[ \t]+\*?([^\r\n]+)\r?\n?$/i.exec(text);
    if(match?.[2]!==name)throw Error("Checksum asset identity mismatch");checksum=match[1];
  }
  // Only the exact public GitHub repository can supply update bytes.
  assertAssetOrigin(asset.browser_download_url);
  record("download");
  await downloadVerified(asset.browser_download_url,archive,checksum);
  const result=await activatePackage({installRoot:root,dataDir:data,tag,archive,manager,record});
  try{
    const previous=result.previous===root?undefined:result.previous;
    const cleanup=pruneManagedReleases({root:path.join(root,".metis-releases"),active:result.active,previous,pattern:/^v[0-9][A-Za-z0-9_.-]+$/,requiredFiles:["package-manifest.json"]});
    record("cleanup-"+cleanup.removed.length);
  }catch{record("cleanup-deferred");}
  console.log("Metis AI installed successfully.");
}catch(error){
  const code=error instanceof AggregateError?"ROLLBACK_RECOVERY_REQUIRED":/SHA256|checksum/.test(error.message)?"INTEGRITY_CHECK_FAILED":/health/i.test(error.message)?"HEALTH_CHECK_FAILED":/space|ENOSPC/.test(error.message)?"DISK_FULL":/prebuilt package|platform/.test(error.message)?"ASSET_UNAVAILABLE":["EACCES","EPERM","ENOSPC","ENOENT"].includes(error.code)?error.code:"UPDATE_FAILED";
  record("failed",code);
  console.error("Native package update failed: "+(error instanceof AggregateError?"ROLLBACK_RECOVERY_REQUIRED":error.message));
  process.exitCode=1;
}finally{fs.rmSync(archive,{force:true});}
