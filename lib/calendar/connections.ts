import {randomUUID} from "node:crypto";
import {encryptSecret,decryptSecret} from "@/lib/secrets";
import {calendarDb} from "./store";
import {CalendarError,type CalendarProvider,type CalendarConnection} from "./types";
export type CalendarSecrets={username?:string;password?:string;clientId?:string;clientSecret?:string;refreshToken?:string;accessToken?:string;expiry?:number};
type ConnectionRow={id:string;owner:string;provider:CalendarProvider;label:string;secret:string;enabled:number;status:string;last_sync:string|null;error:string;version:number};
export function connectionRows(owner:string){return calendarDb().prepare("SELECT * FROM calendar_connections WHERE owner=?").all(owner) as ConnectionRow[];}
export function listConnections(owner:string):CalendarConnection[]{return connectionRows(owner).map(r=>({id:r.id,provider:r.provider,label:r.label,enabled:!!r.enabled,status:r.status,lastAttempt:r.last_sync,error:r.error,version:r.version}));}
export function calendarSecrets(owner:string,id:string){
 const row=connectionRows(owner).find(r=>r.id===id);if(!row)throw new CalendarError("Calendar connection not found.",404);
 let value;try{value=JSON.parse(decryptSecret(row.secret));}catch{throw new CalendarError("Reconnect this calendar account.",401,"reconnect");}
 if(value.owner!==owner||value.id!==id||value.provider!==row.provider)throw new CalendarError("Calendar credential target mismatch.",403);
 return {row,secrets:value.secrets as CalendarSecrets};
}
/** Internal protected persistence. Never returns, masks or logs submitted secrets. */
export function saveCalendarCredentials(owner:string,provider:CalendarProvider,secrets:CalendarSecrets,label?:string){
 if(!["google","icloud"].includes(provider))throw new CalendarError("Unknown calendar provider.");
 if(provider==="icloud"&&(!secrets.username||!secrets.password))throw new CalendarError("Enter an Apple Account and app-specific password.");
 if(provider==="google"&&(!secrets.clientId||!secrets.clientSecret||!secrets.refreshToken))throw new CalendarError("Google authorization is incomplete.",401,"reconnect");
 const old=connectionRows(owner).find(c=>c.provider===provider),id=old?.id||randomUUID();
 const secret=encryptSecret(JSON.stringify({owner,id,provider,secrets}));
 calendarDb().prepare("INSERT INTO calendar_connections(id,owner,provider,label,secret,status) VALUES(?,?,?,?,?,\'pending\') ON CONFLICT(id) DO UPDATE SET secret=excluded.secret,enabled=1,status='pending',error='',version=calendar_connections.version+1").run(id,owner,provider,(label||provider).slice(0,200),secret);
 return listConnections(owner).find(c=>c.id===id)!;
}
export function refreshCalendarCredentials(owner:string,id:string,version:number,secrets:CalendarSecrets){
 const {row}=calendarSecrets(owner,id);
 const secret=encryptSecret(JSON.stringify({owner,id,provider:row.provider,secrets}));
 if(!calendarDb().prepare("UPDATE calendar_connections SET secret=? WHERE owner=? AND id=? AND enabled=1 AND version=?").run(secret,owner,id,version).changes)throw new CalendarError("Connection changed during authorization.",409);
}
export function disconnectCalendar(owner:string,id:string){
 // Disable without deleting imported events or remote events. Credentials are removed.
 if(!calendarDb().prepare("UPDATE calendar_connections SET enabled=0,secret='',status='disconnected',error='',version=version+1 WHERE owner=? AND id=?").run(owner,id).changes)throw new CalendarError("Connection not found.",404);
 return {disconnected:true};
}
