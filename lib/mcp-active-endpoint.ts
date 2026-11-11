import fs from "node:fs";
import path from "node:path";
/** Chosen only when constructing a new provider connection. Existing transports stay pinned. */
export function activeMcpEndpoint(stateDir:string,fallback:string){
 const file=path.join(stateDir,"active-endpoint.json");
 if(!fs.existsSync(file))return fallback;
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.mode&0o022||stat.size>2048)throw Error("Invalid active MCP endpoint configuration.");
 const config=JSON.parse(fs.readFileSync(file,"utf8"));
 const url=new URL(config.url);
 if(config.version!==1||url.protocol!=="http:"||url.hostname!=="127.0.0.1"||!url.port||url.username||url.password||url.pathname!=="/"||url.search||url.hash)throw Error("Active MCP gateway must be an explicit loopback endpoint.");
 return url.origin;
}
