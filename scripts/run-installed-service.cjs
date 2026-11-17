// Stable native service entry point. Never reads credentials or mutates installs.
const fs=require("node:fs"),path=require("node:path"),{spawn}=require("node:child_process");
function resolveService(root,role,env=process.env){
  if(!["app","worker","mcp"].includes(role))throw Error("Unsupported service role");
  root=fs.realpathSync(root);
  let source=root,node=process.execPath,childEnv={...env,NODE_ENV:"production",AI_CHAT_INSTALL_DIR:root};
  const pointer=path.join(root,".metis-release.json");
  if(fs.existsSync(pointer)){
    const info=JSON.parse(fs.readFileSync(pointer,"utf8"));
    if(info.schemaVersion!==1||!/^v[0-9][A-Za-z0-9_.-]+$/.test(info.active))throw Error("Invalid native release pointer");
    source=path.join(root,".metis-releases",info.active);
    if(fs.realpathSync(source)!==source)throw Error("Symlinked native release");
    const manifest=JSON.parse(fs.readFileSync(path.join(source,"package-manifest.json"),"utf8"));
    if(manifest.platform!==process.platform||manifest.arch!==process.arch||manifest.nodeMajor!==22)throw Error("Incompatible native release");
    node=path.join(source,".runtime",process.platform==="win32"?"node.exe":"node");
    childEnv.NEXT_DIST_DIR=".next";
    // A package lives below the bootstrap Git checkout. Do not mistake that
    // parent checkout commit for the identity of the running immutable package.
    childEnv.GIT_CEILING_DIRECTORIES=[env.GIT_CEILING_DIRECTORIES,root].filter(Boolean).join(path.delimiter);
    childEnv.METIS_NODE_BIN=node;
    childEnv.PATH=[path.dirname(node),env.PATH].filter(Boolean).join(path.delimiter);
  }
  childEnv.AI_CHAT_ROOT=source;
  childEnv.CHAT_DATA_DIR=path.resolve(root,env.CHAT_DATA_DIR||"data");
  for(const key of ["CHAT_DB_PATH","AI_CHAT_MCP_STATE_DIR"])if(env[key])childEnv[key]=path.resolve(root,env[key]);
  const args=role==="mcp"?[path.join(source,"lib/mcp-core/gateway-core.mjs")]:[path.join(source,"node_modules/tsx/dist/cli.mjs"),path.join(source,role==="app"?"server.mjs":"worker.ts")];
  return{command:node,args,cwd:source,env:childEnv};
}
if(require.main===module){
  const target=resolveService(path.resolve(__dirname,".."),process.argv[2]);
  const child=spawn(target.command,target.args,{cwd:target.cwd,env:target.env,stdio:"inherit",windowsHide:true});
  for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>child.kill(signal));
  child.once("error",()=>{console.error("Native service could not start");process.exitCode=1;});
  child.once("exit",(code,signal)=>{process.exitCode=code??(signal?1:0);});
}
module.exports={resolveService};
