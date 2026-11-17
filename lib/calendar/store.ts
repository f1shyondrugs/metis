import {randomUUID,createHash} from "node:crypto";
import {z} from "zod";
import {getDatabase,transaction} from "@/lib/sqlite";
import {CalendarError,type CalendarEvent,type CalendarGroup,type EventInput} from "./types";
import {eventFields,writeEvent,expandEvent,normalizedEventHash,calendarRange} from "./ical";
const initialized=new WeakSet<object>();
export function calendarDb(){
 const db=getDatabase();if(initialized.has(db))return db;
 db.exec(`
 CREATE TABLE IF NOT EXISTS calendar_groups(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,name_key TEXT NOT NULL,color TEXT NOT NULL,read_only INTEGER NOT NULL DEFAULT 0,UNIQUE(owner,name_key));
 CREATE TABLE IF NOT EXISTS calendar_connections(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,provider TEXT NOT NULL,label TEXT NOT NULL,secret TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'ready',last_sync TEXT,error TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,UNIQUE(owner,provider));
 CREATE TABLE IF NOT EXISTS calendar_sources(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,connection_id TEXT NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,group_id TEXT NOT NULL REFERENCES calendar_groups(id),remote_id TEXT NOT NULL,descriptor TEXT NOT NULL,token TEXT NOT NULL DEFAULT '',UNIQUE(connection_id,remote_id));
 CREATE TABLE IF NOT EXISTS calendar_events(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,group_id TEXT NOT NULL REFERENCES calendar_groups(id),uid TEXT NOT NULL,ics TEXT NOT NULL,hash TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,UNIQUE(owner,group_id,uid));
 CREATE INDEX IF NOT EXISTS calendar_events_owner ON calendar_events(owner,group_id,deleted);
 CREATE TABLE IF NOT EXISTS calendar_links(event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,source_id TEXT NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,remote_id TEXT NOT NULL,etag TEXT NOT NULL,remote_hash TEXT NOT NULL,synced_version INTEGER NOT NULL,raw TEXT NOT NULL,PRIMARY KEY(event_id,source_id),UNIQUE(source_id,remote_id));
 CREATE TABLE IF NOT EXISTS calendar_requests(owner TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,event_id TEXT NOT NULL REFERENCES calendar_events(id),PRIMARY KEY(owner,key));
 CREATE TABLE IF NOT EXISTS calendar_conflicts(id TEXT PRIMARY KEY,owner TEXT NOT NULL,event_id TEXT NOT NULL REFERENCES calendar_events(id),source_id TEXT NOT NULL REFERENCES calendar_sources(id),remote TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(event_id,source_id));
 CREATE TABLE IF NOT EXISTS calendar_sync_locks(owner TEXT PRIMARY KEY,token TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS calendar_oauth(state_hash TEXT PRIMARY KEY,owner TEXT NOT NULL,verifier TEXT NOT NULL,expires INTEGER NOT NULL);
 `);initialized.add(db);return db;
}
export function groupKey(name:string){return name.normalize("NFKC").trim().toLocaleLowerCase("en-US");}
export function ensureCalendar(owner:string,name="Metis",color="#818cf8",readOnly=false):CalendarGroup{
 const key=groupKey(name);if(!key||name.length>200||/[\u0000-\u001f\u007f]/.test(name))throw new CalendarError("Invalid calendar name.");
 const db=calendarDb();db.prepare("INSERT OR IGNORE INTO calendar_groups(id,owner,name,name_key,color,read_only) VALUES(?,?,?,?,?,?)").run(randomUUID(),owner,name,key,/^#[a-f0-9]{6}$/i.test(color)?color:"#818cf8",+readOnly);
 const row=db.prepare("SELECT * FROM calendar_groups WHERE owner=? AND name_key=?").get(owner,key) as {id:string;name:string;color:string;read_only:number};
 if(!readOnly&&row.read_only){db.prepare("UPDATE calendar_groups SET read_only=0 WHERE id=? AND owner=?").run(row.id,owner);row.read_only=0;}
 return {id:row.id,name:row.name,color:row.color,readOnly:!!row.read_only};
}
export function listCalendars(owner:string):CalendarGroup[]{ensureCalendar(owner);return (calendarDb().prepare("SELECT * FROM calendar_groups WHERE owner=? ORDER BY name COLLATE NOCASE").all(owner) as {id:string;name:string;color:string;read_only:number}[]).map(r=>({id:r.id,name:r.name,color:r.color,readOnly:!!r.read_only}));}
type EventRow={id:string;owner:string;group_id:string;uid:string;ics:string;hash:string;version:number;deleted:number;read_only?:number};
export function eventFromRow(row:EventRow):CalendarEvent{return {id:row.id,calendarId:row.group_id,...eventFields(row.ics),version:row.version,deleted:!!row.deleted,readOnly:!!row.read_only,ics:row.ics};}
export function getCalendarEvent(owner:string,id:string){const row=calendarDb().prepare("SELECT e.*,g.read_only FROM calendar_events e JOIN calendar_groups g ON g.id=e.group_id WHERE e.owner=? AND e.id=?").get(owner,id) as EventRow|undefined;if(!row)throw new CalendarError("Event not found.",404);return eventFromRow(row);}
const eventSchema=z.object({id:z.string().uuid().optional(),calendarId:z.string().uuid(),title:z.string().trim().min(1).max(500),description:z.string().max(20000).default(""),location:z.string().max(2000).default(""),start:z.string().max(80),end:z.string().max(80),allDay:z.boolean().default(false),timeZone:z.string().max(100).default("UTC"),recurrence:z.string().max(1000).default(""),version:z.number().int().positive().optional(),idempotencyKey:z.string().min(1).max(200).optional()}).strict();
export function saveCalendarEvent(owner:string,raw:unknown){
 const p=eventSchema.safeParse(raw);if(!p.success)throw new CalendarError("Enter a title, calendar and valid event times.");const input=p.data;
 const db=calendarDb();const g=db.prepare("SELECT * FROM calendar_groups WHERE owner=? AND id=?").get(owner,input.calendarId) as {read_only:number}|undefined;
 if(!g)throw new CalendarError("Calendar not found.",404);if(g.read_only)throw new CalendarError("This calendar is read-only.",403);
 return transaction(()=>{
  const fp=createHash("sha256").update(JSON.stringify(input)).digest("hex");
  if(!input.id&&input.idempotencyKey){const r=db.prepare("SELECT * FROM calendar_requests WHERE owner=? AND key=?").get(owner,input.idempotencyKey) as {fingerprint:string;event_id:string}|undefined;if(r){if(r.fingerprint!==fp)throw new CalendarError("This request was already used for another event.",409);return getCalendarEvent(owner,r.event_id);}}
  const old=input.id?getCalendarEvent(owner,input.id):null;
  if(old&&(old.deleted||old.version!==input.version))throw new CalendarError("This event changed. Reload before saving.",409);
  if(old&&old.calendarId!==input.calendarId)throw new CalendarError("Changing a synced calendar requires creating a new event.");
  const id=old?.id||randomUUID(),uid=old?.uid||randomUUID()+"@metis",ics=writeEvent(input,uid,old?.ics);
  db.prepare("INSERT INTO calendar_events(id,owner,group_id,uid,ics,hash,version) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET ics=excluded.ics,hash=excluded.hash,version=excluded.version").run(id,owner,input.calendarId,uid,ics,normalizedEventHash(ics),(old?.version||0)+1);
  if(!old&&input.idempotencyKey)db.prepare("INSERT INTO calendar_requests VALUES(?,?,?,?)").run(owner,input.idempotencyKey,fp,id);
  return getCalendarEvent(owner,id);
 });
}
export function deleteCalendarEvent(owner:string,id:string,version:number){
 const event=getCalendarEvent(owner,id);if(event.readOnly)throw new CalendarError("This calendar is read-only.",403);
 if(!calendarDb().prepare("UPDATE calendar_events SET deleted=1,version=version+1 WHERE id=? AND owner=? AND version=? AND deleted=0").run(id,owner,version).changes)throw new CalendarError("This event changed. Reload before deleting.",409);return {deleted:true};
}
export function listCalendarEvents(owner:string,from:string,to:string,calendarId?:string){
 calendarRange(from,to);
 const rows=calendarDb().prepare("SELECT e.*,g.read_only FROM calendar_events e JOIN calendar_groups g ON g.id=e.group_id WHERE e.owner=? AND e.deleted=0"+(calendarId?" AND e.group_id=?":"")+" ORDER BY e.id LIMIT 10001").iterate(...(calendarId?[owner,calendarId]:[owner]));
 let count=0,bytes=0;const events=[];
 for(const raw of rows){const r=raw as EventRow;if(++count>10000||(bytes+=Buffer.byteLength(r.ics))>32*1024*1024)throw new CalendarError("Too many calendar items to display.",413);events.push(...expandEvent(eventFromRow(r),from,to));if(events.length>10000)throw new CalendarError("Too many occurrences in this range.",413);}
 return events;
}
export function listCalendarConflicts(owner:string){return calendarDb().prepare("SELECT c.id,c.event_id AS eventId,c.created_at AS createdAt,g.name AS calendarName FROM calendar_conflicts c JOIN calendar_events e ON e.id=c.event_id JOIN calendar_groups g ON g.id=e.group_id WHERE c.owner=? ORDER BY c.created_at").all(owner);}
