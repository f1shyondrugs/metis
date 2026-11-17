import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { spawn,execFileSync } from "node:child_process";
import { extractVerifiedPackage,validatePackage } from "./package-update-core.mjs";
const archive=path.resolve(process.argv[2]);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"metis-native-smoke-"));
const root=path.join(temp,"package"),data=path.join(temp,"data"),home=path.join(temp,"home");
fs.mkdirSync(data);fs.mkdirSync(home);
const children=[];
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
try{
  await extractVerifiedPackage(archive,root);
  const tag=JSON.parse(fs.readFileSync(path.join(root,"package-manifest.json"),"utf8")).tag;
  const manifest=validatePackage(root,{tag});
  const port=await freePort(),mcp=await freePort();
  const env={PATH:process.env.PATH,HOME:home,USERPROFILE:home,SYSTEMROOT:process.env.SYSTEMROOT,APPDATA:home,LOCALAPPDATA:home,TEMP:temp,TMP:temp,NODE_ENV:"production",
    AI_CHAT_ROOT:root,AI_CHAT_INSTALL_DIR:root,CHAT_DATA_DIR:data,PORT:String(port),MCP_PORT:String(mcp),AI_CHAT_HOST:"127.0.0.1",AI_CHAT_PUBLIC_URL:"http://127.0.0.1:"+port,
    NEXT_DIST_DIR:".next",AI_CHAT_ALLOW_ROOT_AGENTS:"false",AI_CHAT_AGENT_CWD:home,METIS_DOCKER:"0",
    AI_CHAT_INTERNAL_ORIGIN:"http://127.0.0.1:"+port,MCP_PUBLIC_URL:"http://127.0.0.1:"+mcp,MCP_BEARER_TOKEN:randomBytes(32).toString("hex")};
  const node=path.join(root,".runtime",process.platform==="win32"?"node.exe":"node");
  const roles=[["lib/mcp-core/gateway-core.mjs"],["--import","tsx","worker.ts"],["--import","tsx","server.mjs"]];
  let output="";
  for(const args of roles){
    const child=spawn(node,args,{cwd:root,env,detached:process.platform!=="win32",windowsHide:true,stdio:["ignore","pipe","pipe"]});
    child.stdout.on("data",chunk=>{output=(output+chunk).slice(-16000);});child.stderr.on("data",chunk=>{output=(output+chunk).slice(-16000);});
    children.push(child);
  }
  const end=Date.now()+90000;let healthy=false;
  while(Date.now()<end){
    if(children.some(child=>child.exitCode!==null))throw Error("Packaged process exited: "+output);
    try{
      const response=await fetch("http://127.0.0.1:"+port+"/api/status",{signal:AbortSignal.timeout(2000)});
      const status=await response.json();
      if(response.ok&&status.worker?.ok&&status.mcp?.ok){
        const identity=await(await fetch("http://127.0.0.1:"+port+"/api/system/version")).json();
        if(identity.release?.tag!==manifest.tag||identity.release?.commit!==manifest.commit)throw Error("Served package identity mismatch");
        const html=await(await fetch("http://127.0.0.1:"+port+"/")).text();
        const asset=html.match(/\/_next\/static\/[^"'<>\s]+\.js/)?.[0];
        if(asset&&(await fetch("http://127.0.0.1:"+port+asset)).ok){healthy=true;break;}
      }
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!healthy)throw Error("Packaged app/worker/gateway did not become healthy: "+output);
  console.log("NATIVE_PACKAGE_REAL_APP_WORKER_GATEWAY_AND_ASSET_OK");
}finally{
  for(const child of children)if(child.pid)try{
    if(process.platform==="win32")execFileSync("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{stdio:"ignore",windowsHide:true});
    else process.kill(-child.pid,"SIGTERM");
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
  for(const child of children)if(child.pid&&child.exitCode===null)try{if(process.platform!=="win32")process.kill(-child.pid,"SIGKILL");}catch{}
  fs.rmSync(temp,{recursive:true,force:true});
}
