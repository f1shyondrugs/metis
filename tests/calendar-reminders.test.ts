/* eslint-disable @typescript-eslint/no-require-imports -- Load storage only after selecting an isolated database. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ICAL from "ical.js";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"metis-calendar-reminders-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"test.sqlite"),AI_CHAT_SECRETS_KEY:Buffer.alloc(32,3).toString("hex")});
const {createUser}=require("../lib/auth") as typeof import("../lib/auth");
const store=require("../lib/calendar/store") as typeof import("../lib/calendar/store");
const ical=require("../lib/calendar/ical") as typeof import("../lib/calendar/ical");
const owner=createUser("reminder-test","Synthetic-Reminder-Test").id;
const calendar=store.ensureCalendar(owner);
const input={calendarId:calendar.id,title:"Weekly payment check",start:"2026-03-23T20:00:00+01:00",end:"2026-03-23T20:10:00+01:00",timeZone:"Europe/Berlin",recurrence:"FREQ=WEEKLY;BYDAY=MO;COUNT=3"};
test("start-time alarm survives storage, retry, mirror and Berlin DST",()=>{
 const payload={...input,reminderMinutes:[0],idempotencyKey:"weekly-alarm"};
 const event=store.saveCalendarEvent(owner,payload);
 assert.equal(store.saveCalendarEvent(owner,payload).id,event.id);
 assert.deepEqual(event.reminderMinutes,[0]);
 assert.match(event.ics,/BEGIN:VTIMEZONE/);
 const alarm=ical.parseCalendar(event.ics).getFirstSubcomponent("vevent")!.getFirstSubcomponent("valarm")!;
 assert.equal(alarm.getFirstPropertyValue("action"),"DISPLAY");
 assert.equal((alarm.getFirstPropertyValue("trigger") as ICAL.Duration).toSeconds(),0);
 assert.deepEqual(ical.eventFields(ical.mirrorPayload(event.ics)).reminderMinutes,[0]);
 const times=ical.expandEvent(event,"2026-03-23T00:00:00Z","2026-04-07T00:00:00Z");
 assert.deepEqual(times.map(e=>e.start),["2026-03-23T19:00:00.000Z","2026-03-30T18:00:00.000Z","2026-04-06T18:00:00.000Z"]);
 assert.ok(times.every(e=>e.reminderMinutes?.[0]===0));
 assert.throws(()=>store.saveCalendarEvent(owner,{...payload,reminderMinutes:[15]}),/already used/);
});
test("omitted alarms preserve original data; explicit updates preserve unsupported alarm types",()=>{
 const first=store.saveCalendarEvent(owner,{...input,reminderMinutes:[15]});
 const c=ical.parseCalendar(first.ics),m=c.getFirstSubcomponent("vevent")!;
 const audio=new ICAL.Component("valarm");audio.updatePropertyWithValue("action","AUDIO");audio.updatePropertyWithValue("trigger",ICAL.Duration.fromSeconds(-60));m.addSubcomponent(audio);
 const raw=c.toString();
 const preserved=ical.writeEvent({...input,title:"Renamed"},first.uid,raw);
 assert.deepEqual(ical.eventFields(preserved).reminderMinutes,[15]);
 assert.match(preserved,/ACTION:AUDIO/);
 const cleared=ical.writeEvent({...input,reminderMinutes:[]},first.uid,raw);
 assert.deepEqual(ical.eventFields(cleared).reminderMinutes,[]);
 assert.match(cleared,/ACTION:AUDIO/);
 const replaced=ical.writeEvent({...input,reminderMinutes:[0,0,30]},first.uid,raw);
 assert.deepEqual(ical.eventFields(replaced).reminderMinutes,[0,30]);
 assert.equal(ical.parseCalendar(replaced).getFirstSubcomponent("vevent")!.getAllSubcomponents("valarm").length,3);
 assert.match(replaced,/ACTION:AUDIO/);
 assert.notEqual(ical.normalizedEventHash(cleared),ical.normalizedEventHash(raw));
});
test("alarm validation bounds writes and preserves other owners",()=>{
 for(const reminderMinutes of [[-1],[0.5],[40321],[0,1,2,3,4,5],["0"],null]){
  assert.throws(()=>store.saveCalendarEvent(owner,{...input,reminderMinutes}),/valid event/);
 }
 const other=createUser("other-reminder-test","Synthetic-Other-Reminder").id;
 const e=store.saveCalendarEvent(owner,{...input,reminderMinutes:[0]});
 assert.throws(()=>store.getCalendarEvent(other,e.id),/not found/);
});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
