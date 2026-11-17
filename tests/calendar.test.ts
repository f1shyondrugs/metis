/* eslint-disable @typescript-eslint/no-require-imports -- Cold test modules load only after the isolated database environment is configured. */
import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";import os from "node:os";import path from "node:path";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"metis-calendar-test-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"calendar.sqlite"),AI_CHAT_SECRETS_KEY:Buffer.alloc(32,7).toString("hex")});
const {createUser}=require("../lib/auth") as typeof import("../lib/auth");const store=require("../lib/calendar/store") as typeof import("../lib/calendar/store");const ical=require("../lib/calendar/ical") as typeof import("../lib/calendar/ical");const conn=require("../lib/calendar/connections") as typeof import("../lib/calendar/connections");const sync=require("../lib/calendar/sync") as typeof import("../lib/calendar/sync");
const owner=createUser("calendar-owner","Synthetic-Calendar-Only").id,other=createUser("calendar-other","Synthetic-Calendar-Other").id;
const calendar=store.ensureCalendar(owner,"Privat","#aabbcc"),foreign=store.ensureCalendar(other,"Other");
const input={calendarId:calendar.id,title:"Appointment",start:"2026-11-13T10:00:00+01:00",end:"2026-11-13T11:00:00+01:00",timeZone:"Europe/Berlin",description:"Keep **literal** text",location:"Office"};
test("native events: create, exactly-once retry, version CAS and owner boundaries",()=>{
 const e=store.saveCalendarEvent(owner,{...input,idempotencyKey:"one"});const again=store.saveCalendarEvent(owner,{...input,idempotencyKey:"one"});assert.equal(e.id,again.id);assert.equal(e.description,input.description);
 assert.throws(()=>store.saveCalendarEvent(owner,{...input,title:"Different",idempotencyKey:"one"}),/already used/);
 assert.throws(()=>store.getCalendarEvent(other,e.id),/not found/);assert.throws(()=>store.saveCalendarEvent(owner,{...input,calendarId:foreign.id}),/not found/);
 const updated=store.saveCalendarEvent(owner,{...input,id:e.id,version:e.version,title:"Updated"});assert.equal(updated.version,2);
 assert.throws(()=>store.saveCalendarEvent(owner,{...input,id:e.id,version:1}),/changed/);
 assert.throws(()=>store.deleteCalendarEvent(owner,e.id,1),/changed/);
 store.deleteCalendarEvent(owner,e.id,2);assert.equal(store.getCalendarEvent(owner,e.id).deleted,true);
});
test("ICS preserves recurrence, exceptions and alarm data; mirrors do not send invitations",()=>{
 const raw="BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:series@example\r\nDTSTART:20261113T090000Z\r\nDTEND:20261113T100000Z\r\nSUMMARY:Series\r\nRRULE:FREQ=DAILY;COUNT=3\r\nATTENDEE:mailto:person@example.test\r\nORGANIZER:mailto:owner@example.test\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:series@example\r\nRECURRENCE-ID:20261114T090000Z\r\nDTSTART:20261114T120000Z\r\nDTEND:20261114T130000Z\r\nSUMMARY:Exception\r\nEND:VEVENT\r\nEND:VCALENDAR";
 const parsed=ical.eventFields(raw);assert.equal(parsed.uid,"series@example");const copy=ical.mirrorPayload(raw);assert.ok(!copy.includes("ATTENDEE"));assert.ok(!copy.includes("ORGANIZER"));assert.ok(copy.includes("VALARM"));assert.ok(copy.includes("RECURRENCE-ID"));
 assert.equal(ical.normalizedEventHash(copy),ical.normalizedEventHash(raw));
 const e={...parsed,id:"series",calendarId:calendar.id,ics:raw,version:1,deleted:false,readOnly:false};
 const occurrences=ical.expandEvent(e,"2026-11-13T00:00:00Z","2026-11-17T00:00:00Z");assert.equal(occurrences.length,3);assert.equal(occurrences[1].title,"Exception");assert.equal(occurrences[1].start,"2026-11-14T12:00:00.000Z");assert.ok(!("ics" in occurrences[0]));
 assert.ok(ical.mirrorPayload(copy,raw).includes("ATTENDEE"));
});
test("all-day dates, end-exclusive ranges and recurrence validation",()=>{
 const e=store.saveCalendarEvent(owner,{...input,title:"All day",allDay:true,start:"2026-03-29",end:"2026-03-30",recurrence:"FREQ=YEARLY"});
 assert.equal(e.start,"2026-03-29");assert.ok(e.ics.includes("VALUE=DATE"));assert.equal(store.listCalendarEvents(owner,"2026-03-29T00:00:00Z","2026-03-30T00:00:00Z").filter(x=>x.eventId===e.id).length,1);
 assert.throws(()=>store.saveCalendarEvent(owner,{...input,start:"2026-11-13T10:00:00",end:"2026-11-13T11:00:00"}),/offset/);
 assert.throws(()=>store.saveCalendarEvent(owner,{...input,end:input.start}),/after/);
 assert.throws(()=>store.listCalendarEvents(owner,"invalid","invalid"),/range/);
});
test("credential envelopes bind owner and target; refresh cannot re-enable disconnect",()=>{
 const c=conn.saveCalendarCredentials(owner,"icloud",{username:"synthetic@example.test",password:"SYNTHETIC-NOT-A-REAL-PASSWORD"});
 assert.ok(!JSON.stringify(conn.listConnections(owner)).includes("SYNTHETIC"));assert.throws(()=>conn.calendarSecrets(other,c.id),/not found/);
 conn.disconnectCalendar(owner,c.id);assert.throws(()=>conn.refreshCalendarCredentials(owner,c.id,c.version,{username:"synthetic@example.test",password:"SYNTHETIC"}));
 assert.equal(conn.listConnections(owner).find(v=>v.id===c.id)?.enabled,false);
});
type RC=import("../lib/calendar/types").RemoteCalendar;type RO=import("../lib/calendar/types").RemoteObject;type Adapter=import("../lib/calendar/types").CalendarAdapter;
class MemoryProvider implements Adapter{
 calendarsData:RC[]=[];objects=new Map<string,Map<string,RO>>();sequence=0;puts=0;creates=0;removes=0;failPull=false;unknownPut=false;
 async calendars(){return this.calendarsData;}
 async createCalendar(name:string,color:string){this.creates++;const c={id:"cal"+this.calendarsData.length,name,color,writable:true,url:"https://calendar.invalid/"+this.creates+"/"};this.calendarsData.push(c);this.objects.set(c.id,new Map());return c;}
 async pull(c:RC,_token:string){if(this.failPull)throw Error("Synthetic network failure");return {objects:[...this.objects.get(c.id)!.values()],token:String(++this.sequence),full:true};}
 async put(c:RC,id:string,ics:string,etag?:string){const map=this.objects.get(c.id)!;const old=map.get(id);if(old&&old.etag!==etag){if(old.ics&&ical.normalizedEventHash(old.ics)===ical.normalizedEventHash(ics))return old;throw Error("CAS");}this.puts++;const o={id,ics,etag:String(++this.sequence)};map.set(id,o);if(this.unknownPut){this.unknownPut=false;throw Error("Synthetic lost reply");}return o;}
 async remove(c:RC,id:string,etag:string){const old=this.objects.get(c.id)!.get(id);if(old&&old.etag!==etag)throw Error("CAS");this.removes++;this.objects.get(c.id)!.delete(id);}
}
test("two providers: import, mirror, remote edits, conflict hold and deletion without loops",async()=>{
 const user=createUser("sync-owner","Synthetic-Sync-Only").id;
 const a=conn.saveCalendarCredentials(user,"icloud",{username:"synthetic@example.test",password:"SYNTHETIC"}),b=conn.saveCalendarCredentials(user,"google",{clientId:"synthetic",clientSecret:"SYNTHETIC",refreshToken:"SYNTHETIC"});
 const apple=new MemoryProvider(),google=new MemoryProvider();const ac=await apple.createCalendar("Privat","#aabbcc");
 const raw=ical.writeEvent({...input,calendarId:"unused",title:"Existing Apple event"},"imported@synthetic");
 apple.objects.get(ac.id)!.set(ac.url+"import.ics",{id:ac.url+"import.ics",ics:raw,etag:"first"});
 const factory=async(_owner:string,id:string)=>id===a.id?apple:google;
 await sync.syncCalendarAccount(user,{factory,force:true});
 const group=store.listCalendars(user).find(c=>c.name==="Privat")!;const list=store.listCalendarEvents(user,"2026-11-01T00:00:00Z","2026-12-01T00:00:00Z");assert.equal(list.length,1);const id=list[0].eventId;
 const gc=google.calendarsData.find(c=>c.name==="Privat")!,copy=[...google.objects.get(gc.id)!.values()][0];assert.ok(copy);assert.equal(ical.eventFields(copy.ics!).title,"Existing Apple event");
 const puts=apple.puts+google.puts;await sync.syncCalendarAccount(user,{factory,force:true});assert.equal(apple.puts+google.puts,puts,"no echo writes");
 const edited=ical.writeEvent({...input,calendarId:group.id,title:"Changed on Google"},"imported@synthetic",copy.ics);google.objects.get(gc.id)!.set(copy.id,{...copy,ics:edited,etag:"google-edited"});
 await sync.syncCalendarAccount(user,{factory,force:true});assert.equal(store.getCalendarEvent(user,id).title,"Changed on Google");assert.equal(ical.eventFields([...apple.objects.get(ac.id)!.values()][0].ics!).title,"Changed on Google");
 const before=store.getCalendarEvent(user,id);store.saveCalendarEvent(user,{...input,calendarId:group.id,id,version:before.version,title:"Local concurrent edit"});
 const remote=[...apple.objects.get(ac.id)!.values()][0];apple.objects.get(ac.id)!.set(remote.id,{...remote,etag:"apple-race",ics:ical.writeEvent({...input,title:"Remote concurrent edit"},"imported@synthetic",remote.ics)});
 await sync.syncCalendarAccount(user,{factory,force:true});assert.equal(store.listCalendarConflicts(user).length,1);assert.equal(store.getCalendarEvent(user,id).title,"Local concurrent edit");
 const conflict=store.listCalendarConflicts(user)[0] as {id:string};sync.resolveCalendarConflict(user,conflict.id,"metis",store.getCalendarEvent(user,id).version);await sync.syncCalendarAccount(user,{factory,force:true});assert.equal(store.listCalendarConflicts(user).length,0);
 apple.objects.get(ac.id)!.clear();await sync.syncCalendarAccount(user,{factory,force:true});assert.equal(store.getCalendarEvent(user,id).deleted,true);assert.equal(google.objects.get(gc.id)!.size,0);
});
test("partial network failure never becomes deletion and lost replies never duplicate events",async()=>{
 const user=createUser("retry-owner","Synthetic-Retry-Only").id,a=conn.saveCalendarCredentials(user,"icloud",{username:"synthetic@example.test",password:"SYNTHETIC"}),provider=new MemoryProvider(),c=await provider.createCalendar("Metis","#aabbcc"),g=store.ensureCalendar(user);
 const e=store.saveCalendarEvent(user,{...input,calendarId:g.id,title:"Retry event"});provider.unknownPut=true;
 const factory=async()=>provider;
 await sync.syncCalendarAccount(user,{factory,force:true});assert.equal(provider.objects.get(c.id)!.size,1);
 await sync.syncCalendarAccount(user,{factory,force:true});assert.equal(provider.objects.get(c.id)!.size,1);assert.equal(store.getCalendarEvent(user,e.id).deleted,false);
 provider.failPull=true;await sync.syncCalendarAccount(user,{factory,force:true});assert.equal(store.getCalendarEvent(user,e.id).deleted,false);assert.equal(conn.listConnections(user).find(v=>v.id===a.id)?.status,"attention");
});
test("weekly recurrence keeps Berlin wall time across DST; floating values use viewer dates",()=>{
 const e=store.saveCalendarEvent(owner,{...input,start:"2026-03-22T10:00:00+01:00",end:"2026-03-22T11:00:00+01:00",recurrence:"FREQ=WEEKLY;COUNT=3"});
 const occurrences=ical.expandEvent(e,"2026-03-21T00:00:00+01:00","2026-04-06T00:00:00+02:00");
 assert.deepEqual(occurrences.map(o=>o.start),["2026-03-22T09:00:00.000Z","2026-03-29T08:00:00.000Z","2026-04-05T08:00:00.000Z"]);
 const raw="BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:floating@test\r\nDTSTART:20261113T003000\r\nDTEND:20261113T010000\r\nSUMMARY:Floating\r\nEND:VEVENT\r\nEND:VCALENDAR";
 const f={...e,...ical.eventFields(raw),ics:raw};assert.equal(ical.expandEvent(f,"2026-11-13T00:00:00+09:00","2026-11-14T00:00:00+09:00").length,1);
 assert.throws(()=>store.listCalendarEvents(other,"invalid","invalid"),/range/);
});
test("read-only calendars stay separate and missing linked calendars never receive stale writes",async()=>{
 const user=createUser("readonly-owner","Synthetic-Readonly-Only").id;
 conn.saveCalendarCredentials(user,"icloud",{username:"synthetic@example.test",password:"SYNTHETIC"});
 const p=new MemoryProvider(),c=await p.createCalendar("Shared","#abcdef");c.writable=false;
 p.objects.get(c.id)!.set(c.url+"read.ics",{id:c.url+"read.ics",ics:ical.writeEvent(input,"readonly@test"),etag:"r1"});
 await sync.syncCalendarAccount(user,{factory:async()=>p,force:true});
 const group=store.listCalendars(user).find(g=>g.readOnly)!;assert.ok(group);assert.equal(p.puts,0);
 const item=store.listCalendarEvents(user,"2026-11-01T00:00:00Z","2026-12-01T00:00:00Z")[0];
 assert.throws(()=>store.deleteCalendarEvent(user,item.eventId,item.version),/read-only/);
 p.calendarsData=[];await sync.syncCalendarAccount(user,{factory:async()=>p,force:true});assert.equal(p.puts,0);assert.equal(p.creates,1);
 assert.equal(store.getCalendarEvent(user,item.eventId).deleted,false);assert.match(conn.listConnections(user)[0].error,/no longer accessible/);
});
test("malformed pull leaves the entire source snapshot and token unchanged",async()=>{
 const user=createUser("atomic-owner","Synthetic-Atomic-Only").id,c=conn.saveCalendarCredentials(user,"icloud",{username:"synthetic@example.test",password:"SYNTHETIC"}),p=new MemoryProvider(),remote=await p.createCalendar("Atomic","#abcdef");
 await sync.syncCalendarAccount(user,{factory:async()=>p,force:true});
 const db=store.calendarDb(),source=db.prepare("SELECT * FROM calendar_sources WHERE connection_id=?").get(c.id) as Parameters<typeof sync.applyPull>[1];
 const objects=[{id:remote.url+"valid.ics",etag:"v1",ics:ical.writeEvent(input,"valid@test")},{id:remote.url+"bad.ics",etag:"bad",ics:"INVALID"}];
 assert.throws(()=>sync.applyPull(user,source,objects,false,"bad-token"),/Invalid/);
 assert.equal((db.prepare("SELECT token FROM calendar_sources WHERE id=?").get(source.id) as {token:string}).token,source.token);
 assert.equal(store.listCalendarEvents(user,"2026-11-01T00:00:00Z","2026-12-01T00:00:00Z").length,0);
});
test("durable sync leases prevent overlapping writers and disconnect fences in-flight work",async()=>{
 const user=createUser("lease-owner","Synthetic-Lease-Only").id,c=conn.saveCalendarCredentials(user,"icloud",{username:"synthetic@example.test",password:"SYNTHETIC"}),p=new MemoryProvider();
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 p.calendars=async()=>{entered();await gate;return [];};
 const first=sync.syncCalendarAccount(user,{factory:async()=>p,force:true});await ready;
 assert.equal((await sync.syncCalendarAccount(user,{factory:async()=>p,force:true})).busy,true);
 conn.disconnectCalendar(user,c.id);release();await first;
 assert.equal(conn.listConnections(user)[0].status,"disconnected");assert.equal(conn.listConnections(user)[0].enabled,false);assert.equal(p.puts,0);
});
test.after(()=>{fs.rmSync(root,{recursive:true,force:true});});
