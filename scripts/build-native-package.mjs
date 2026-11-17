import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as tar from "tar";
import { packageAssetName,validatePackage } from "./package-update-core.mjs";

const root=process.cwd(),tag=process.env.METIS_RELEASE_TAG;
const name=packageAssetName(tag);
const version=JSON.parse(fs.readFileSync("package.json","utf8")).version;
if(tag!=="v"+version)throw Error("Package tag/version mismatch");
const dist=process.env.NEXT_DIST_DIR||".next";
const release=JSON.parse(fs.readFileSync(path.join(dist,"release-manifest.json"),"utf8"));
if(release.tag!==tag||!release.commit)throw Error("Build is not the requested stable release");
const output=path.resolve(process.env.METIS_PACKAGE_OUTPUT||"native-dist");
fs.mkdirSync(output,{recursive:true});
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"metis-native-package-"));
const payload=path.join(temporary,"payload");fs.mkdirSync(payload);
try{
  const tracked=execFileSync("git",["ls-files","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
  for(const file of tracked){
    if(/^(?:tests|docs|\.github|outputs?|tmp)\//.test(file)||file.startsWith(".env")||file.endsWith(".log"))continue;
    fs.mkdirSync(path.dirname(path.join(payload,file)),{recursive:true});
    fs.cpSync(path.join(root,file),path.join(payload,file),{recursive:true,dereference:false});
  }
  fs.cpSync(path.join(root,dist),path.join(payload,".next"),{recursive:true,dereference:false,filter:source=>!source.startsWith(path.join(root,dist,"cache"))});
  const runtimeConfig=path.join(root,dist,"runtime-next.config.mjs");
  if(!fs.existsSync(runtimeConfig))throw Error("Emit the native runtime config before pruning build tools");
  fs.copyFileSync(runtimeConfig,path.join(payload,"next.config.mjs"));
  fs.rmSync(path.join(payload,"next.config.ts"),{force:true});
  fs.cpSync(path.join(root,"node_modules"),path.join(payload,"node_modules"),{recursive:true,dereference:false});
  // Rewrite pnpm links into portable relative links, never CI-machine paths.
  const rewrite=directory=>{
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const file=path.join(directory,entry.name);
      if(entry.isSymbolicLink()){
        const link=fs.readlinkSync(file);
        let target=path.resolve(path.dirname(file),link);
        if(path.isAbsolute(link)){
          if(!link.startsWith(root+path.sep))throw Error("External dependency link");
          target=path.join(payload,path.relative(root,link));
        }
        if(!target.startsWith(payload+path.sep))throw Error("Escaping dependency link");
        fs.unlinkSync(file);fs.symlinkSync(path.relative(path.dirname(file),target),file,process.platform==="win32"?"junction":undefined);
      }else if(entry.isDirectory())rewrite(file);
    }
  };
  rewrite(payload);
  fs.mkdirSync(path.join(payload,".runtime"));
  const runtime=path.join(payload,".runtime",process.platform==="win32"?"node.exe":"node");
  fs.copyFileSync(process.execPath,runtime);fs.chmodSync(runtime,0o755);
  const manifest={schemaVersion:1,tag,version,commit:release.commit,platform:process.platform,arch:process.arch,nodeMajor:22,nodeVersion:process.versions.node,buildId:fs.readFileSync(path.join(payload,".next/BUILD_ID"),"utf8").trim()};
  fs.writeFileSync(path.join(payload,"package-manifest.json"),JSON.stringify(manifest,null,2));
  validatePackage(payload,{tag});
  const file=path.join(output,name);
  await tar.c({gzip:true,file,cwd:temporary,portable:true},["payload"]);
  const hash=createHash("sha256");
  for await(const chunk of fs.createReadStream(file))hash.update(chunk);
  fs.writeFileSync(file+".sha256",hash.digest("hex")+"  "+name+"\n");
  console.log("NATIVE_PACKAGE_BUILT "+name);
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
