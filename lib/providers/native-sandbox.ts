import {payloadRecord} from "@/lib/agent-payload";
import {AsyncLocalStorage} from "node:async_hooks";
import {existsSync,realpathSync,statSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {mkdtempSync} from "node:fs";
import os from "node:os";
import {nativeIsolationEnabled} from "@/lib/native-isolation-policy";
import path from "node:path";
import {spawn,type SpawnOptions,type ChildProcessWithoutNullStreams} from "node:child_process";
import {config} from "@/lib/config";
import {providerProcessEnv} from "./process-env";
import {ensureSafeDirectory} from "@/lib/safe-file-read";

export type NativeRuntimeScope={owner:string;workspace:string;home:string;state:string};
type NativeEnv=Record<string,string|undefined>;
const scopes=new AsyncLocalStorage<NativeRuntimeScope>();
const inside=(root:string,value:string)=>value===root||value.startsWith(root+path.sep);
const canonical=(value:string)=>realpathSync(path.resolve(value));
export function nativeRuntimeScope(){return scopes.getStore();}
export function createNativeRuntimeScope(owner:string,workspace?:string):NativeRuntimeScope{
  if(!/^[\w-]{1,200}$/.test(owner))throw Error("Native runtime requires an authenticated account");
  const state=path.join(config.dataDir,"native-runtime",owner),home=path.join(state,"home");
  ensureSafeDirectory(home);
  if(canonical(state)!==path.resolve(state)||canonical(home)!==path.resolve(home))throw Error("Unsafe native runtime home");
  return {owner,workspace:canonical(workspace??home),state:canonical(state),home:canonical(home)};
}
export function withNativeRuntime<T>(owner:string,workspace:string|undefined,run:()=>T):T{
  if (!nativeIsolationEnabled()) return run();
  if (process.platform !== "linux") throw Error("Native isolation requires Linux");
  return scopes.run(createNativeRuntimeScope(owner,workspace),run);
}
export function nativeTemporaryHome(prefix:string){
  if (!nativeIsolationEnabled()) return mkdtempSync(path.join(os.tmpdir(), "metis-" + prefix));
  const scope=nativeRuntimeScope();if(!scope)throw Error("Native account scope required");
  const home=path.join(scope.state,"temporary",prefix+randomUUID());ensureSafeDirectory(home);return home;
}
/** SDKs may merge process.env back into an explicitly scrubbed adapter env. */
export function nativeSdkEnvironment(actual:NativeEnv,declared:NativeEnv){
  return {...providerProcessEnv({},actual),...Object.fromEntries(Object.entries(actual).filter(([key,value])=>typeof value==="string"&&value!==process.env[key])),...declared};
}

function executablePath(command:string,environment:NativeEnv){
  const candidate=path.isAbsolute(command)?command:(environment.PATH||process.env.PATH||"").split(path.delimiter).map(dir=>path.join(dir,command)).find(value=>existsSync(value)&&statSync(value).isFile());
  if(!candidate)throw Error("Native executable unavailable");
  return canonical(candidate);
}
export function nativeSandboxLaunch(command:string,args:string[],environment:NativeEnv={},extraWritable:string[]=[],scope=nativeRuntimeScope()){
  if (!nativeIsolationEnabled()) return {command,args,env:providerProcessEnv(environment),cwd:undefined};
  if (process.platform !== "linux") throw Error("Native isolation requires Linux");
  if(!scope)throw Error("Native runtime account scope is required");
  const env=providerProcessEnv(environment);
  if(env.METIS_MCP_SESSION_TOKEN){try{const parts=env.METIS_MCP_SESSION_TOKEN.split(".");if(parts[0]!=="metis-v1"||JSON.parse(Buffer.from(parts[1],"base64url").toString()).userId!==scope.owner)throw Error();}catch{throw Error("Native session token belongs to another account");}}
  // Python/Node loaders execute before the namespace exists. Never allow a
  // provider's custom env to preload code into that host-side launcher.
  for(const key of Object.keys(env))if(/^(LD_|DYLD_|GLIBC_TUNABLES$|GCONV_PATH$|LOCPATH$|NLSPATH$|BWRAP_|PYTHONPATH$|PYTHONHOME$|NODE_OPTIONS$|NODE_PATH$|BASH_ENV$|ENV$|AI_CHAT_|CHAT_|MCP_|METIS_|DATABASE_)/.test(key)&&key!=="METIS_MCP_SESSION_TOKEN")delete env[key];
  const root=canonical(config.root),modules=canonical(path.join(root,"node_modules"));
  const runtime=canonical(path.join(root,"services/native-runtime"));
  const executable=executablePath(command,env);
  const ro=[modules,runtime];
  const nodeRoot=canonical(path.dirname(path.dirname(process.execPath)));
  if(!inside("/usr",nodeRoot))ro.push(nodeRoot);
  if(existsSync(path.join(root,"scripts")))ro.push(canonical(path.join(root,"scripts")));
  const managed=path.resolve(config.dataDir,"agent-runtimes");
  if(inside(managed,executable)){
    const parts=path.relative(managed,executable).split(path.sep);
    if(parts.length<3)throw Error("Invalid managed native runtime");
    ro.push(canonical(path.join(managed,parts[0],parts[1])));
  }
  const rw=[scope.workspace,scope.home];
  const approvedSession=(value:string)=>{
    if(inside(scope.state,value))return true;
    const relative=path.relative(path.resolve(config.dataDir,"provider-sessions"),value).split(path.sep);
    return relative.length>=3&&!relative.includes("..")&&relative[1]===scope.owner;
  };
  for(const value of [...extraWritable,...[env.CODEX_HOME,env.HOME,env.USERPROFILE].filter((x):x is string=>Boolean(x))]){
    if(value===process.env.HOME||value===scope.home)continue;
    const real=canonical(value);if(!approvedSession(real))throw Error("Native session directory belongs to another account");
    if(!rw.some(parent=>inside(parent,real)))rw.push(real);
  }
  if(!inside("/usr",executable)&&![...ro,...rw].some(parent=>inside(parent,executable)))throw Error("Native executable is outside approved code roots");
  const protectedPaths=[config.dataDir,config.mcpStateDir,...(process.env.AI_CHAT_FILE_SNAPSHOT_DIR?[process.env.AI_CHAT_FILE_SNAPSHOT_DIR]:[]),process.env.HOME||"/root","/var/lib/metis-browser-login","/var/lib/metis-secure-console","/etc/metis-browser-login"].map(value=>path.resolve(value)).filter(value=>existsSync(value)).map(canonical);
  if(!inside(scope.state,scope.workspace)&&protectedPaths.some(value=>inside(value,scope.workspace)||inside(scope.workspace,value)))throw Error("Native workspace overlaps protected application data");
  if(ro.some(code=>rw.some(writable=>inside(code,writable)||inside(writable,code))))throw Error("Native code installation must be outside writable workspace");
  const selectedHome=environment.HOME&&environment.HOME!==process.env.HOME?canonical(environment.HOME):scope.home;
  const policy={owner:scope.owner,cwd:scope.workspace,home:selectedHome,rw:[...new Set(rw)],ro:[...new Set(ro)],protected:protectedPaths};
  env.HOME=selectedHome;env.USERPROFILE=selectedHome;env.XDG_CONFIG_HOME=path.join(selectedHome,".config");env.XDG_CACHE_HOME=path.join(selectedHome,".cache");
  env.PATH=[path.join(nodeRoot,"bin"),"/usr/local/bin","/usr/bin","/bin"].join(":");
  return {command:"/usr/bin/python3",args:["-I","-S",path.join(runtime,"launch.py"),JSON.stringify(policy),executable,...args],env,cwd:scope.workspace};
}
export function spawnNative(command:string,args:string[],options:SpawnOptions&{env?:NodeJS.ProcessEnv}={},extraWritable:string[]=[],scope=nativeRuntimeScope()){
  const launch=nativeSandboxLaunch(command,args,options.env,extraWritable,scope);
  return spawn(launch.command,launch.args,{...options,shell:false,env:launch.env,cwd:launch.cwd??options.cwd,stdio:["pipe","pipe","pipe"]}) as ChildProcessWithoutNullStreams;
}
export function codexNativeExecutable(command:string,environment:NativeEnv){
  if(!nativeIsolationEnabled())return {executable:command,env:providerProcessEnv(environment)};
  const launch=nativeSandboxLaunch(command,[],environment);
  return {executable:canonical(path.join(config.root,"services/native-runtime/codex-entry.py")),env:{...launch.env,METIS_NATIVE_POLICY:launch.args[3],METIS_NATIVE_EXECUTABLE:launch.args[4]}};
}
export function assertNativeMcpServers(servers:unknown,owner=nativeRuntimeScope()?.owner){
  if(!nativeIsolationEnabled())return;
  if (process.platform !== "linux") throw Error("Native isolation requires Linux");
  const gateway=payloadRecord(payloadRecord(servers)?.gateway);
  const bearer=payloadRecord(gateway?.headers)?.Authorization;
  if(!owner||gateway?.type!=="http"||typeof bearer!=="string"||!bearer.startsWith("Bearer metis-v1."))throw Error("Isolated native agents require the signed HTTP MCP gateway");
  try{if(JSON.parse(Buffer.from(bearer.split(".")[1],"base64url").toString()).userId!==owner)throw Error();}
  catch{throw Error("Native MCP account mismatch");}
}
