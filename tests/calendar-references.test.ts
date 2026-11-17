/* eslint-disable @typescript-eslint/no-require-imports -- Isolated data is configured before server imports. */
import assert from "node:assert/strict";import test from "node:test";import fs from "node:fs";import os from "node:os";import path from "node:path";import {DateTime} from "luxon";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"metis-calendar-reference-test-"));Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"test.sqlite"),AI_CHAT_SECRETS_KEY:Buffer.alloc(32,7).toString("hex")});
const auth=require("../lib/auth") as typeof import("../lib/auth"),store=require("../lib/calendar/store") as typeof import("../lib/calendar/store"),refs=require("../lib/calendar/reference") as typeof import("../lib/calendar/reference"),db=require("../lib/db-store") as typeof import("../lib/db-store"),ical=require("../lib/calendar/ical") as typeof import("../lib/calendar/ical");
const{calendarEventToolId,calendarEventEmbedId}=require("../lib/calendar-event-link") as typeof import("../lib/calendar-event-link");
const{parseInternalLink,internalLinkNavigation}=require("../lib/internal-link") as typeof import("../lib/internal-link");
const{resolveReferenceQuery}=require("../lib/reference-query") as typeof import("../lib/reference-query");
const owner=auth.createUser("reference-owner","SYNTHETIC-ONLY").id,other=auth.createUser("reference-other","SYNTHETIC-ONLY").id,calendar=store.ensureCalendar(owner,"Work","#12a456");
const input={calendarId:calendar.id,title:"Weekly review",start:"2026-03-22T10:00:00+01:00",end:"2026-03-22T11:00:00+01:00",timeZone:"Europe/Berlin",recurrence:"FREQ=WEEKLY;COUNT=6",location:"Room 2",description:"Agenda"};
test("calendar references are searchable, account-checked and rehydrated rather than trusting submitted data",async()=>{
 const event=store.saveCalendarEvent(owner,input),search=refs.searchCalendarReferences(owner,"review Work",80,()=>{});
 assert.equal(search[0].id,event.id);assert.equal(search[0].kind,"calendar-event");assert.ok(!JSON.stringify(search).includes("BEGIN:VCALENDAR"));
 assert.deepEqual(refs.searchCalendarReferences(other,"",80,()=>{}),[]);assert.equal(refs.resolveCalendarReference(other,event.id),null);assert.throws(()=>refs.getCalendarReference(other,event.id),/not found/);
 const chat=db.createChat("Synthetic references",undefined,owner);db.saveChat(chat);
 const{resolveReferences}=require("../lib/context") as typeof import("../lib/context");
 const{resolveScopeReferences}=require("../lib/context-scope") as typeof import("../lib/context-scope");
 const forged={kind:"calendar-event" as const,id:event.id,label:"Forged",content:"Forged"};
 assert.equal(resolveReferences(owner,chat.id,[forged])[0].label,event.title);
 assert.equal(resolveScopeReferences(owner,chat.id,[{...forged,source:"explicit"}])[0].label,event.title);
 assert.deepEqual(resolveScopeReferences(other,chat.id,[{...forged,source:"explicit"}]),[]);
 assert.deepEqual(resolveScopeReferences(owner,chat.id,[{...forged,source:"explicit"}],true),[]);
 chat.incognito=true;db.saveChat(chat);assert.deepEqual(resolveReferences(owner,chat.id,[forged]),[]);
 store.deleteCalendarEvent(owner,event.id,event.version);assert.equal(refs.resolveCalendarReference(owner,event.id),null);assert.throws(()=>refs.getCalendarReference(owner,event.id),/not found/);
});
test("recurring links resolve today or next date across DST, not the old series anchor",()=>{
 const event=store.saveCalendarEvent(owner,input);
 assert.equal(refs.calendarReferenceOccurrence(event,"Europe/Berlin",DateTime.fromISO("2026-03-29T18:00:00+02:00"))?.start,"2026-03-29T08:00:00.000Z");
 assert.equal(refs.calendarReferenceOccurrence(event,"Europe/Berlin",DateTime.fromISO("2026-03-30T00:05:00+02:00"))?.start,"2026-04-05T08:00:00.000Z");
 assert.equal(refs.calendarReferenceOccurrence(event,"Europe/Berlin",DateTime.fromISO("2027-01-01T00:00:00Z")),null);
 const sparse=store.saveCalendarEvent(owner,{...input,start:"2024-02-29",end:"2024-03-01",allDay:true,recurrence:"FREQ=YEARLY;INTERVAL=4;COUNT=3"});
 assert.equal(refs.calendarReferenceOccurrence(sparse,"Pacific/Kiritimati",DateTime.fromISO("2026-11-17T10:00:00Z"))?.start,"2028-02-29");
});
test("exceptions and cancellations are respected by the next-occurrence projection",()=>{
 const raw="BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:exceptions@test\r\nDTSTART:20261101T100000Z\r\nDTEND:20261101T110000Z\r\nRRULE:FREQ=DAILY;COUNT=4\r\nSUMMARY:Series\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:exceptions@test\r\nRECURRENCE-ID:20261102T100000Z\r\nDTSTART:20261102T100000Z\r\nDTEND:20261102T110000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:exceptions@test\r\nRECURRENCE-ID:20261103T100000Z\r\nDTSTART:20261103T140000Z\r\nDTEND:20261103T150000Z\r\nSUMMARY:Moved review\r\nEND:VEVENT\r\nEND:VCALENDAR";
 const event={...store.saveCalendarEvent(owner,{...input,recurrence:""}),...ical.eventFields(raw),ics:raw};
 const next=refs.calendarReferenceOccurrence(event,"UTC",DateTime.fromISO("2026-11-02T00:00:00Z"));assert.equal(next?.start,"2026-11-03T14:00:00.000Z");assert.equal(next?.title,"Moved review");
});
test("canonical event links, category shortcuts and cards require saved identity and acknowledged success",()=>{
 const id="12345678-1234-1234-1234-123456789abc",target=parseInternalLink("calendar-event://"+id)!;
 assert.equal(target.kind,"calendar-event");assert.equal(internalLinkNavigation(target).href,"/?c=calendar#event-"+id);
 for(const raw of ["events review","events:review","kalender review"])assert.deepEqual(resolveReferenceQuery(raw),{kind:"calendar-event",query:"review"});
 assert.equal(calendarEventEmbedId(JSON.stringify({id})),id);assert.equal(calendarEventEmbedId('{"id":"fake"}'),null);
 for(const name of ["calendar_create_event","mcp__metis_ai__calendar_create_event"])assert.equal(calendarEventToolId(name,{},JSON.stringify({content:[{type:"text",text:JSON.stringify({event:{id}})}]}),"completed"),id);
 assert.equal(calendarEventToolId("call_mcp_tool",{tool:"calendar_create_event"},JSON.stringify({event:{id}}),"completed"),id);
 for(const status of ["running","error","canceled"])assert.equal(calendarEventToolId("calendar_create_event",{},JSON.stringify({event:{id}}),status),null);
 assert.equal(calendarEventToolId("calendar_create_event",{},JSON.stringify({event:{id},isError:true}),"completed"),null);
 assert.equal(calendarEventToolId("calendar_list_events",{},JSON.stringify({event:{id}}),"completed"),null);
 assert.equal(calendarEventToolId("calendar_create_event",{id},undefined,"completed"),null);
});
test("preview APIs return current calendar color/details but no foreign or deleted data",async()=>{
 const event=store.saveCalendarEvent(owner,{...input,recurrence:""}),token=auth.authenticateUser("reference-owner","SYNTHETIC-ONLY")!.token,foreignToken=auth.authenticateUser("reference-other","SYNTHETIC-ONLY")!.token;
 const route=require("../app/api/internal-link-preview/route") as typeof import("../app/api/internal-link-preview/route");
 const request=(session:string)=>new Request("http://localhost/api/internal-link-preview?kind=calendar-event&id="+event.id,{headers:session?{cookie:"ai_chat_auth="+session}:{}});
 assert.equal((await route.GET(request(""))).status,401);assert.equal((await route.GET(request(foreignToken))).status,404);
 const response=await route.GET(request(token));assert.equal(response.status,200);const body=await response.json();assert.equal(body.color,"#12a456");assert.equal(body.title,input.title);assert.ok(body.details.some((d:{value:string})=>d.value==="Room 2"));assert.ok(!JSON.stringify(body).includes("BEGIN:VCALENDAR"));
 store.deleteCalendarEvent(owner,event.id,event.version);assert.equal((await route.GET(request(token))).status,404);
});
