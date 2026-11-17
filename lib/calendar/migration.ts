import {config} from "@/lib/config";
import {constants} from "node:fs";
import {open} from "node:fs/promises";
import path from "node:path";
import {CalendarError,type CalendarProvider} from "./types";
import {saveCalendarCredentials} from "./connections";
/** Same-account iCloud credential migration only. Never follows legacy credential/token file paths. */
export async function importLegacyCalendarConnection(owner:string,provider:CalendarProvider){
 if(provider==="google")throw new CalendarError("Connect Google using the native authorization flow. Legacy token files are not imported.",409,"reconnect");
 const handle=await open(path.join(config.mcpStateDir,"registry.json"),constants.O_RDONLY|constants.O_NOFOLLOW);
 let registry;
 try{const s=await handle.stat();if(!s.isFile()||s.size>4*1024*1024)throw new CalendarError("Calendar connection registry is unavailable.",503);registry=JSON.parse(await handle.readFile("utf8"));}finally{await handle.close();}
 const entries=Array.isArray(registry)?registry:registry.servers;
 const entry=entries?.find((e:{id:string;ownerId:string;kind:string})=>e.id==="icloud-calendar-personal"&&e.ownerId===owner&&e.kind==="stdio");
 if(!entry)throw new CalendarError("No existing iCloud connection was found for this account.",404);
 if(!["ICLOUD_USERNAME","ICLOUD_APP_PASSWORD"].every(key=>typeof entry.env?.[key]==="string"&&entry.env[key].startsWith("metis-mcp-env:v1:")))throw new CalendarError("Re-enter this legacy iCloud connection through protected Calendar connection settings.",409,"reconnect");
 // Shared credential-envelope ESM boundary.
 const {preservedMcpEnv}=await import("@/lib/mcp-core/env-credentials.mjs");
 const env=preservedMcpEnv(entry) as Record<string,string>;
 try{return saveCalendarCredentials(owner,"icloud",{username:env.ICLOUD_USERNAME,password:env.ICLOUD_APP_PASSWORD},"iCloud");}
 finally{for(const key of Object.keys(env))env[key]="";}
}
