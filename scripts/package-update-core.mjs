import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";

export const packageAssetName=(tag,platform=process.platform,arch=process.arch)=>{
  if(!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(tag)||!["linux","darwin","win32"].includes(platform)||!["x64","arm64"].includes(arch))throw Error("Unsupported native release target");
  return `metis-server-${tag}-${platform}-${arch}.tar.gz`;
};
export function atomicJson(file,value){
  const temp=file+"."+randomUUID()+".tmp";
  fs.writeFileSync(temp,JSON.stringify(value,null,2)+"\n",{mode:0o600});
  fs.renameSync(temp,file);
}
export async function downloadVerified(url,file,expected,{fetcher=fetch,maxBytes=2*1024**3,attempts=3}={}){
  if(!/^[a-f0-9]{64}$/i.test(expected))throw Error("Missing package SHA256");
  if(new URL(url).protocol!=="https:")throw Error("HTTPS is required for release assets");
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await fetcher(url,{signal:AbortSignal.timeout(10*60*1000),redirect:"follow"});
      if(!response.ok){const error=Object.assign(new Error("Release asset HTTP "+response.status),{retry:response.status===429||response.status>=500});throw error;}
      if(!response.body)throw Error("Empty package response");
      const hash=createHash("sha256");let bytes=0;
      const guard=new Transform({transform(chunk,_,done){bytes+=chunk.length;if(bytes>maxBytes)return done(Error("Package download exceeds limit"));hash.update(chunk);done(null,chunk);}});
      await pipeline(Readable.fromWeb(response.body),guard,fs.createWriteStream(file,{flags:"wx",mode:0o600}));
      if(hash.digest("hex").toLowerCase()!==expected.toLowerCase())throw Error("Package SHA256 mismatch");
      return;
    }catch(error){
      fs.rmSync(file,{force:true});
      const retry=error.retry||["ETIMEDOUT","ECONNRESET","EAI_AGAIN","ENOTFOUND","UND_ERR_CONNECT_TIMEOUT"].includes(error.cause?.code||error.code)||error.name==="TimeoutError";
      if(!retry||attempt===attempts)throw error;
      await new Promise(resolve=>setTimeout(resolve,attempt*1000));
    }
  }
}
export async function extractVerifiedPackage(archive,destination,{maxBytes=12*1024**3,maxEntries=500000}={}){
  let size=0,count=0;const links=new Set(),names=[],seen=new Set();
  const parser=new tar.Parser({strict:true,onReadEntry(entry){
    try {
    const name=entry.path.replace(/\/$/,"");
    if(++count>maxEntries)throw Error("Package entry count exceeds limit");
    if(name==="payload" && entry.type==="Directory"){entry.resume();return;}
    if(name.includes("\\")||name.includes(":")||name.includes("\0")||!name.startsWith("payload/")||name.split("/").some(part=>part===".."||part==="."))throw Error("Unsafe package entry");
    if(!["File","Directory","SymbolicLink"].includes(entry.type))throw Error("Unsupported package entry type");
    size+=entry.size||0;if(size>maxBytes)throw Error("Extracted package exceeds limit");
    if(entry.type==="SymbolicLink"){
      if(path.posix.isAbsolute(entry.linkpath)||entry.linkpath.includes("\\")||entry.linkpath.includes(":"))throw Error("Unsafe package symlink");
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(name),entry.linkpath));
      if(!target.startsWith("payload/"))throw Error("Escaping package symlink");
      links.add(process.platform==="win32"?name.toLowerCase():name);
    }
    const key=process.platform==="win32"?name.toLowerCase():name;
    if(seen.has(key))throw Error("Duplicate package entry");seen.add(key);
    names.push(key);
    entry.resume();
    }catch(error){parser.abort(error);}
  }});
  await pipeline(fs.createReadStream(archive),parser);
  for(const name of names)for(let parent=path.posix.dirname(name);parent!=="."&&parent!=="payload";parent=path.posix.dirname(parent))if(links.has(parent))throw Error("Entry traverses a package symlink");
  fs.mkdirSync(destination,{recursive:false,mode:0o700});
  await tar.x({file:archive,cwd:destination,strip:1,strict:true,preservePaths:false,preserveOwner:false,noChmod:false});
}
export function validatePackage(root,{tag,platform=process.platform,arch=process.arch}){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,"package-manifest.json"),"utf8"));
  if(manifest.schemaVersion!==1||manifest.tag!==tag||manifest.platform!==platform||manifest.arch!==arch||manifest.nodeMajor!==22||!manifest.buildId||!/^[A-Za-z0-9_-]{1,128}$/.test(manifest.buildId))throw Error("Native package identity mismatch");
  for(const file of ["server.mjs","worker.ts","node_modules/tsx/dist/cli.mjs","lib/mcp-core/gateway-core.mjs",".next/BUILD_ID",platform==="win32"?".runtime/node.exe":".runtime/node"]){
    if(!fs.statSync(path.join(root,file)).isFile())throw Error("Incomplete native package");
  }
  if(fs.readFileSync(path.join(root,".next/BUILD_ID"),"utf8").trim()!==manifest.buildId)throw Error("Package build identity mismatch");
  return manifest;
}
export async function activatePackage({installRoot,dataDir,tag,archive,manager,platform=process.platform,arch=process.arch,record=()=>{}}){
  installRoot=fs.realpathSync(installRoot);
  const releases=path.join(installRoot,".metis-releases");
  fs.mkdirSync(releases,{recursive:true,mode:0o755});
  if(fs.realpathSync(releases)!==releases)throw Error("Symlinked release storage");
  const lock=path.join(releases,".update.lock");
  try{fs.mkdirSync(lock);}
  catch(error){
    if(error.code!=="EEXIST")throw error;
    const owner=JSON.parse(fs.readFileSync(path.join(lock,"owner.json"),"utf8"));
    if(!Number.isSafeInteger(owner.pid)||owner.pid<1)throw Error("Update lock needs inspection");
    try{process.kill(owner.pid,0);throw Error("A native package update is already running");}
    catch(probe){if(probe.code!=="ESRCH")throw probe;}
    const stale=lock+".stale-"+randomUUID();fs.renameSync(lock,stale);fs.rmSync(stale,{recursive:true});fs.mkdirSync(lock);
  }
  atomicJson(path.join(lock,"owner.json"),{pid:process.pid});
  const pointer=path.join(installRoot,".metis-release.json");
  const journal=path.join(dataDir,"metis-package-transaction.json");
  let old=fs.existsSync(pointer)?JSON.parse(fs.readFileSync(pointer,"utf8")):null;
  const stage=path.join(releases,"staging-"+randomUUID());
  let target,changed=false,stopped=false;
  const save=phase=>{atomicJson(journal,{schemaVersion:1,installRoot,phase,previousPointer:old,target:target?path.basename(target):null,updatedAt:new Date().toISOString()});record(phase);};
  try{
    // A previous interrupted activation must be recovered before another request.
    if(fs.existsSync(journal)){
      const previous=JSON.parse(fs.readFileSync(journal,"utf8"));
      if(!["complete","rolled-back","preparing"].includes(previous.phase)){
        if(previous.installRoot!==installRoot||previous.schemaVersion!==1)throw Error("Update journal target mismatch");
        const rollback=previous.previousPointer;
        if(rollback && (rollback.schemaVersion!==1||!/^v[0-9][A-Za-z0-9_.-]+$/.test(rollback.active)))throw Error("Invalid recovery pointer");
        await manager.stop();
        if(rollback)atomicJson(pointer,rollback);else fs.rmSync(pointer,{force:true});
        await manager.start();
        if(!await manager.health(null,null))throw Error("Interrupted-update rollback health check failed");
        old=rollback;record("recovered");
      }
    }
    packageAssetName(tag,platform,arch);
    save("preparing");
    await extractVerifiedPackage(archive,stage);
    const manifest=validatePackage(stage,{tag,platform,arch});
    await manager.preflight(stage,manifest);
    target=path.join(releases,tag+"-"+platform+"-"+arch+"-"+randomUUID().slice(0,8));
    // Package code contains no configuration/credentials and must be readable
    // by separately isolated agent OS users. Staging stays private until verified.
    fs.chmodSync(stage,0o755);
    fs.renameSync(stage,target);save("prepared");
    // All download/extraction/native checks finish before touching any service.
    stopped=true;await manager.stop();save("stopped");
    await manager.snapshot?.();
    atomicJson(pointer,{schemaVersion:1,active:path.basename(target),previous:old?.active||null});
    changed=true;save("activated");
    await manager.start();
    if(!await manager.health(target,manifest))throw Error("New native release failed health checks");
    save("complete");
    return{active:target,previous:old?.active?path.join(releases,old.active):installRoot,manifest};
  }catch(error){
    if(stopped){
      try{
        await manager.stop();
        if(changed){if(old)atomicJson(pointer,old);else fs.rmSync(pointer,{force:true});}
        await manager.start();
        if(!await manager.health(null,null))throw Error("Rollback health check failed");
        save("rolled-back");changed=false;
      }catch(rollbackError){save("rollback-failed");throw new AggregateError([error,rollbackError],"Native update failed and rollback needs recovery");}
    }
    if(target && !changed)fs.rmSync(target,{recursive:true,force:true});
    throw error;
  }finally{
    fs.rmSync(stage,{recursive:true,force:true});
    fs.rmSync(lock,{recursive:true});
  }
}
