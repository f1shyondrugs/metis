import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {importWorkerModule} from "../lib/worker-module.mjs";
const {getJob}=await importWorkerModule(new URL("../lib/db-jobs.ts",import.meta.url).href);
const {getMcpServers}=await importWorkerModule(new URL("../lib/mcp.ts",import.meta.url).href);

const [jobId,expectedOwner,expectedChat]=process.argv.slice(2);
const job=getJob(jobId);
assert(job&&job.userId===expectedOwner&&job.chatId===expectedChat&&job.status==="running","The current owner/chat job must be running.");
const {getDatabase}=await importWorkerModule(new URL("../lib/sqlite.ts",import.meta.url).href);
const lease=getDatabase().prepare("SELECT worker_id,lease_token FROM job_leases WHERE job_id=? AND expires_at>?").get(jobId,new Date().toISOString());
assert(lease,"A live run lease is required.");
process.env.AI_CHAT_WORKER_ID=lease.worker_id;
process.env.AI_CHAT_JOB_LEASE_TOKEN=lease.lease_token;
const connection=getMcpServers({jobId,userId:job.userId,chatId:job.chatId}).gateway;
assert(connection.type==="http");
if(process.argv.includes("--check")){console.log("CURRENT_RUN_CONTEXT_VALIDATED");process.exit(0);}
const client=new Client({name:"metis-protected-icloud-verification",version:"1"},{capabilities:{}});
const transport=new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8799/mcp"),{requestInit:{headers:connection.headers}});
const evidence=path.join(process.cwd(),"output/vault-mcp-release/icloud-live.json");
function json(result:any){return result.structuredContent??JSON.parse(result.content.filter((part:any)=>part.type==="text").map((part:any)=>part.text).join("\n"));}
async function core(name:string,args:Record<string,unknown>={}){
 const result=await client.callTool({name,arguments:args},undefined,{timeout:15*60*1000});
 if(result.isError)throw Error("MCP operation failed: "+name);
 return json(result);
}
async function calendar(tool:string,args:Record<string,unknown>={}){
 const result=await client.callTool({name:"call_mcp_tool",arguments:{server:"icloud-calendar-personal",tool,arguments:args}},undefined,{timeout:120000});
 const data=json(result);
 if(result.isError||data.error)throw Error("iCloud operation rejected: "+(data.error?.code??"REQUEST_FAILED"));
 return data;
}
try{
 await client.connect(transport);
 await core("upsert_mcp_server",{id:"icloud-calendar-personal",name:"Noahs iCloud Calendar",kind:"stdio",command:"node",args:["/opt/metis-integrations/icloud-calendar/0.1.3-metis-auth-v1/dist/cli.js"]});
 console.log("PROTECTED_ICLOUD_INPUT_REQUIRED");
 const input=await core("mcp_request_credentials",{server:"icloud-calendar-personal",fields:["ICLOUD_APP_PASSWORD"]});
 if(input.cancelled||input.status==="cancelled"){console.log("ICLOUD_REAUTH_CANCELLED");process.exitCode=2;}
 else{
  const listed=await calendar("list_calendars");
  const calendars=listed.calendars as Array<{id:string;name:string;readOnly:boolean}>;
  assert(Array.isArray(calendars));
  const proof:any={authenticated:true,calendarCount:calendars.length,calendars:calendars.map(({name,readOnly})=>({name,readOnly})),checkedAt:new Date().toISOString(),writeTest:false,cleanup:false};
  fs.writeFileSync(evidence,JSON.stringify(proof,null,2),{mode:0o600});
  const target=calendars.find(item=>item.name==="Privat"&&!item.readOnly);
  if(target){
   const created=await calendar("create_event",{calendar_id:target.id,request_id:randomUUID(),title:"Metis connection test (temporary)",description:"Temporary connection verification; removed immediately by Metis.",start:"2099-01-01T03:00:00+01:00",end:"2099-01-01T03:01:00+01:00",timezone:"Europe/Berlin"});
   const handle=created.event_handle??created.event?.event_handle??created.handle;
   assert(typeof handle==="string","Created event handle is required for exact cleanup.");
   proof.writeTest=true;proof.testHandle=handle;
   fs.writeFileSync(evidence,JSON.stringify(proof,null,2),{mode:0o600});
   await calendar("delete_event",{event_handle:handle,request_id:randomUUID(),scope:"whole_series"});
   proof.cleanup=true;delete proof.testHandle;
   fs.writeFileSync(evidence,JSON.stringify(proof,null,2),{mode:0o600});
  }
  console.log("ICLOUD_AUTHENTICATED CALENDARS="+calendars.length+" WRITE_TEST="+proof.writeTest+" CLEANUP="+proof.cleanup);
 }
}catch{
 console.error("ICLOUD_REAUTH_NOT_COMPLETED; inspect protected input or connection evidence. No blind retry was performed.");
 process.exitCode=1;
}finally{await client.close();}
