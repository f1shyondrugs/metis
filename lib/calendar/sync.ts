import {randomUUID,createHash} from "node:crypto";
import {transaction} from "@/lib/sqlite";
import {calendarDb,ensureCalendar,groupKey,listCalendars,listCalendarConflicts} from "./store";
import {connectionRows} from "./connections";
import {createCalendarAdapter} from "./adapters";
import {eventFields,normalizedEventHash,mirrorPayload} from "./ical";
import {CalendarError,type CalendarAdapter,type RemoteCalendar,type RemoteObject} from "./types";
type Source={id:string;owner:string;connection_id:string;group_id:string;remote_id:string;descriptor:string;token:string};
type Row={id:string;owner:string;group_id:string;uid:string;ics:string;hash:string;version:number;deleted:number};
type Link={event_id:string;source_id:string;remote_id:string;etag:string;remote_hash:string;synced_version:number;raw:string};
export type AdapterFactory=(owner:string,id:string)=>Promise<CalendarAdapter>;
function conflict(owner:string,eventId:string,sourceId:string,remote:RemoteObject){
 calendarDb().prepare("INSERT INTO calendar_conflicts VALUES(?,?,?,?,?,?) ON CONFLICT(event_id,source_id) DO UPDATE SET remote=excluded.remote,created_at=excluded.created_at").run(randomUUID(),owner,eventId,sourceId,JSON.stringify(remote),new Date().toISOString());
}
function updateLink(event:Row,source:Source,object:RemoteObject,hash:string){
 calendarDb().prepare("INSERT INTO calendar_links VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_id,source_id) DO UPDATE SET remote_id=excluded.remote_id,etag=excluded.etag,remote_hash=excluded.remote_hash,synced_version=excluded.synced_version,raw=excluded.raw").run(event.id,source.id,object.id,object.etag,hash,event.version,object.ics||"");
}
export function applyPull(owner:string,source:Source,objects:RemoteObject[],full:boolean,token:string){
 const db=calendarDb();
 // Validate every remote item before opening the transaction: no partial import/token advancement.
 for(const object of objects)if(!object.deleted){if(!object.ics||!object.etag)throw new CalendarError("Incomplete remote event.",502);eventFields(object.ics);normalizedEventHash(object.ics);}
 transaction(()=>{
  const incoming=[...objects];
  if(full){const present=new Set(objects.map(o=>o.id));const old=db.prepare("SELECT * FROM calendar_links WHERE source_id=?").all(source.id) as Link[];for(const link of old)if(!present.has(link.remote_id))incoming.push({id:link.remote_id,etag:"",deleted:true});}
  for(const object of incoming){
   const link=db.prepare("SELECT * FROM calendar_links WHERE source_id=? AND remote_id=?").get(source.id,object.id) as Link|undefined;
   let event=link?db.prepare("SELECT * FROM calendar_events WHERE owner=? AND id=?").get(owner,link.event_id) as Row|undefined:undefined;
   if(object.deleted){
    if(!event)continue;if(!event.deleted&&event.version>link!.synced_version){conflict(owner,event.id,source.id,object);continue;}
    if(!event.deleted){db.prepare("UPDATE calendar_events SET deleted=1,version=version+1 WHERE id=? AND owner=?").run(event.id,owner);event={...event,deleted:1,version:event.version+1};}
    updateLink(event,source,object,"deleted");continue;
   }
   const fields=eventFields(object.ics!),hash=normalizedEventHash(object.ics!);
   if(link&&hash===link.remote_hash){db.prepare("UPDATE calendar_links SET etag=?,raw=? WHERE event_id=? AND source_id=?").run(object.etag,object.ics!,link.event_id,source.id);continue;}
   if(!event)event=db.prepare("SELECT * FROM calendar_events WHERE owner=? AND group_id=? AND uid=?").get(owner,source.group_id,fields.uid) as Row|undefined;
   if(event){
    if(event.hash!==hash&&(event.deleted||!link||event.version>link.synced_version)){conflict(owner,event.id,source.id,object);continue;}
    if(event.hash!==hash){db.prepare("UPDATE calendar_events SET ics=?,hash=?,version=version+1,deleted=0 WHERE owner=? AND id=?").run(object.ics!,hash,owner,event.id);event={...event,ics:object.ics!,hash,version:event.version+1,deleted:0};}
   }else{
    event={id:randomUUID(),owner,group_id:source.group_id,uid:fields.uid,ics:object.ics!,hash,version:1,deleted:0};
    db.prepare("INSERT INTO calendar_events VALUES(?,?,?,?,?,?,?,?)").run(event.id,owner,source.group_id,event.uid,event.ics,hash,1,0);
   }
   updateLink(event,source,object,hash);
  }
  db.prepare("UPDATE calendar_sources SET token=? WHERE id=? AND owner=?").run(token,source.id,owner);
 });
}
export async function syncCalendarAccount(owner:string,{factory=createCalendarAdapter,force=false}:{factory?:AdapterFactory;force?:boolean}={}){
 const db=calendarDb(),lease=randomUUID(),now=Date.now();
 db.exec("CREATE TABLE IF NOT EXISTS calendar_provision(owner TEXT NOT NULL,connection_id TEXT NOT NULL,group_id TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(owner,connection_id,group_id))");
 db.prepare("INSERT INTO calendar_sync_locks VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE calendar_sync_locks.expires<?").run(owner,lease,now+180000,now);
 if((db.prepare("SELECT token FROM calendar_sync_locks WHERE owner=?").get(owner) as {token:string}).token!==lease)return {busy:true};
 function renew(){if(!db.prepare("UPDATE calendar_sync_locks SET expires=? WHERE owner=? AND token=?").run(Date.now()+180000,owner,lease).changes)throw new CalendarError("Calendar sync lease expired.",409);}
 const successful:string[]=[];
 try{
  const connections=connectionRows(owner).filter(c=>c.enabled),adapters=new Map<string,CalendarAdapter>(),discovered=new Map<string,RemoteCalendar[]>();
  for(const c of connections){
   // Persisted backoff also applies when multiple app/worker processes poll.
   if(!force&&c.last_sync&&Date.now()-Date.parse(c.last_sync)<(c.error?300000:60000))continue;
   try{
    const adapter=await factory(owner,c.id);alive(c.id);const calendars=await adapter.calendars();alive(c.id);
    const keys=calendars.map(r=>groupKey(r.name)+(r.writable?"":":readonly"));
    if(new Set(keys).size!==keys.length)throw new CalendarError("Two calendars in this account have the same name. Rename one before pairing.",409);
    const previous=db.prepare("SELECT * FROM calendar_sources WHERE owner=? AND connection_id=?").all(owner,c.id) as Source[];
    if(previous.some(s=>!calendars.some(r=>r.id===s.remote_id)))throw new CalendarError("A previously linked calendar is no longer accessible. No changes were sent. Restore access or reconnect after reviewing this calendar.",409,"missing_calendar");
    adapters.set(c.id,adapter);discovered.set(c.id,calendars);
    for(const calendar of calendars){
     const existingSource=db.prepare("SELECT * FROM calendar_sources WHERE owner=? AND connection_id=? AND remote_id=?").get(owner,c.id,calendar.id) as Source|undefined;
     const group=existingSource?{id:existingSource.group_id}:ensureCalendar(owner,calendar.writable?calendar.name:calendar.name+" ("+c.provider+", read-only)",calendar.color,!calendar.writable);
     db.prepare("INSERT INTO calendar_sources(id,owner,connection_id,group_id,remote_id,descriptor) VALUES(?,?,?,?,?,?) ON CONFLICT(connection_id,remote_id) DO UPDATE SET descriptor=excluded.descriptor").run(randomUUID(),owner,c.id,group.id,calendar.id,JSON.stringify(calendar));
    }
   }catch(error){recordError(c.id,error);}
  }
  function alive(id:string){const c=connections.find(c=>c.id===id)!;const current=connectionRows(owner).find(c=>c.id===id);if(!current?.enabled||current.version!==c.version)throw new CalendarError("Calendar connection changed. Sync stopped.",409);renew();}
  function recordError(id:string,error:unknown){adapters.delete(id);const message=error instanceof CalendarError?error.message:"Calendar sync failed. Your local events are retained.";db.prepare("UPDATE calendar_connections SET error=?,status=?,last_sync=? WHERE id=? AND owner=? AND enabled=1 AND version=?").run(message,error instanceof CalendarError&&error.code==="reconnect"?"reconnect":"attention",new Date().toISOString(),id,owner,connections.find(c=>c.id===id)!.version);}
  // Import existing data before provisioning counterpart calendars or pushing any local writes.
  for(const [id,adapter] of adapters){
   try{
    for(const source of db.prepare("SELECT * FROM calendar_sources WHERE owner=? AND connection_id=?").all(owner,id) as Source[]){
     if(!discovered.get(id)!.some(c=>c.id===source.remote_id))continue;
     alive(id);let result;try{result=await adapter.pull(JSON.parse(source.descriptor),source.token);}catch(e){if(!(e instanceof CalendarError)||e.code!=="token_expired")throw e;result=await adapter.pull(JSON.parse(source.descriptor),"");}
     alive(id);applyPull(owner,source,result.objects,result.full,result.token);
    }
   }catch(error){recordError(id,error);adapters.delete(id);}
  }
  for(const [id,adapter] of adapters){
   try{
    // Names are paired only after explicit connection/sync consent; read-only groups never mirror.
    for(const group of listCalendars(owner).filter(g=>!g.readOnly&&(db.prepare("SELECT 1 FROM calendar_sources WHERE owner=? AND group_id=?").get(owner,g.id)||db.prepare("SELECT 1 FROM calendar_events WHERE owner=? AND group_id=? AND deleted=0").get(owner,g.id)))){
     let source=db.prepare("SELECT * FROM calendar_sources WHERE owner=? AND connection_id=? AND group_id=?").get(owner,id,group.id) as Source|undefined;
     if(!source){
      if(db.prepare("SELECT 1 FROM calendar_provision WHERE owner=? AND connection_id=? AND group_id=?").get(owner,id,group.id))throw new CalendarError("A calendar creation has an unknown outcome. Check the provider for this calendar or create its missing counterpart manually, then sync again. No automatic duplicate creation was attempted.",409);
      alive(id);db.prepare("INSERT INTO calendar_provision VALUES(?,?,?,'started')").run(owner,id,group.id);
      const remote=await adapter.createCalendar(group.name,group.color);alive(id);
      source={id:randomUUID(),owner,connection_id:id,group_id:group.id,remote_id:remote.id,descriptor:JSON.stringify(remote),token:""};
      db.prepare("INSERT INTO calendar_sources VALUES(?,?,?,?,?,?,?)").run(source.id,owner,id,group.id,remote.id,source.descriptor,"");
      db.prepare("DELETE FROM calendar_provision WHERE owner=? AND connection_id=? AND group_id=?").run(owner,id,group.id);
     }
     const remote=JSON.parse(source.descriptor) as RemoteCalendar;if(!remote.writable)continue;
     const events=db.prepare("SELECT * FROM calendar_events WHERE owner=? AND group_id=?").all(owner,group.id) as Row[];
     for(const event of events){
      const link=db.prepare("SELECT * FROM calendar_links WHERE event_id=? AND source_id=?").get(event.id,source.id) as Link|undefined;
      if((link&&link.synced_version>=event.version)||(!link&&event.deleted)||db.prepare("SELECT 1 FROM calendar_conflicts WHERE event_id=?").get(event.id))continue;
      alive(id);
      if(event.deleted){await adapter.remove(remote,link!.remote_id,link!.etag);alive(id);updateLink(event,source,{id:link!.remote_id,etag:"",deleted:true},"deleted");}
      else{
       const payload=mirrorPayload(event.ics,link?.raw),remoteId=link?.remote_id||new URL(createHash("sha256").update(event.uid).digest("hex")+".ics",remote.url).href;
       const saved=await adapter.put(remote,remoteId,payload,link?.etag);alive(id);updateLink(event,source,saved,normalizedEventHash(saved.ics!));
      }
     }
    }
    alive(id);db.prepare("UPDATE calendar_connections SET status='ready',error='',last_sync=? WHERE owner=? AND id=?").run(new Date().toISOString(),owner,id);successful.push(id);
   }catch(error){recordError(id,error);}
  }
  return {busy:false,synced:successful.length,conflicts:listCalendarConflicts(owner).length};
 }finally{db.prepare("DELETE FROM calendar_sync_locks WHERE owner=? AND token=?").run(owner,lease);}
}
export function calendarConflictDetail(owner:string,id:string){
 const db=calendarDb(),c=db.prepare("SELECT * FROM calendar_conflicts WHERE id=? AND owner=?").get(id,owner) as {event_id:string;source_id:string;remote:string}|undefined;
 if(!c)throw new CalendarError("Conflict not found.",404);
 const row=db.prepare("SELECT * FROM calendar_events WHERE owner=? AND id=?").get(owner,c.event_id) as Row;
 const remote=JSON.parse(c.remote) as RemoteObject;
 return {id,eventId:row.id,version:row.version,local:row.deleted?null:eventFields(row.ics),remote:remote.deleted?null:eventFields(remote.ics!)};
}
export function resolveCalendarConflict(owner:string,id:string,choice:"metis"|"remote",version:number){
 const db=calendarDb();
 return transaction(()=>{
  const c=db.prepare("SELECT * FROM calendar_conflicts WHERE id=? AND owner=?").get(id,owner) as {event_id:string;source_id:string;remote:string}|undefined;if(!c)throw new CalendarError("Conflict not found.",404);
  const event=db.prepare("SELECT * FROM calendar_events WHERE owner=? AND id=?").get(owner,c.event_id) as Row;if(event.version!==version)throw new CalendarError("Event changed. Reload before resolving.",409);
  const remote=JSON.parse(c.remote) as RemoteObject,newVersion=event.version+1;
  if(choice==="remote"&&!remote.deleted){const hash=normalizedEventHash(remote.ics!);db.prepare("UPDATE calendar_events SET ics=?,hash=?,version=?,deleted=0 WHERE owner=? AND id=?").run(remote.ics!,hash,newVersion,owner,event.id);}
  else db.prepare("UPDATE calendar_events SET version=?,deleted=? WHERE owner=? AND id=?").run(newVersion,choice==="remote"?1:event.deleted,owner,event.id);
  updateLink({...event,version:choice==="remote"?newVersion:0},{id:c.source_id} as Source,remote,remote.deleted?"deleted":normalizedEventHash(remote.ics!));
  db.prepare("DELETE FROM calendar_conflicts WHERE id=? AND owner=?").run(id,owner);return {resolved:true};
 });
}
export async function syncAllCalendarAccounts(){const owners=calendarDb().prepare("SELECT DISTINCT owner FROM calendar_connections WHERE enabled=1").all() as {owner:string}[];for(const {owner} of owners)await syncCalendarAccount(owner);}
