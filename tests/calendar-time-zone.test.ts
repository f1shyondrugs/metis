import assert from "node:assert/strict";
import test from "node:test";
import {DateTime} from "luxon";
import {DEVICE_TIME_ZONE,calendarTimeZoneKey,calendarTimeZonePreference,calendarTimeZones,convertEventTimeZone,deviceCalendarTimeZone,eventEditorTimeZone,eventLocalDateTime,eventLocalValue,newCalendarEvent,validCalendarTimeZone} from "../lib/calendar/time-zone";
test("device default is detected at the client boundary, with a disclosed UTC fallback",()=>{
 assert.deepEqual(deviceCalendarTimeZone(()=>"Pacific/Auckland"),{zone:"Pacific/Auckland",detected:true});
 assert.deepEqual(deviceCalendarTimeZone(()=>""),{zone:"UTC",detected:false});
 assert.deepEqual(deviceCalendarTimeZone(()=>{throw Error("unavailable");}),{zone:"UTC",detected:false});
 assert.equal(calendarTimeZonePreference(null),DEVICE_TIME_ZONE);
 assert.equal(calendarTimeZonePreference("Europe/Berlin"),"Europe/Berlin");
 assert.equal(calendarTimeZonePreference("server-default"),DEVICE_TIME_ZONE);
 assert.notEqual(calendarTimeZoneKey("account/a"),calendarTimeZoneKey("account/b"));
});
test("existing event zones are retained and date-only floating values stay editable",()=>{
 assert.equal(eventEditorTimeZone({timeZone:"America/New_York"},"Pacific/Auckland"),"America/New_York");
 assert.equal(eventEditorTimeZone({},"Pacific/Auckland"),"Pacific/Auckland");
 assert.equal(eventEditorTimeZone({allDay:true,timeZone:"floating"},"Europe/Berlin"),"Europe/Berlin");
 assert.equal(eventEditorTimeZone({timeZone:"unsupported/custom"},"Europe/Berlin"),"unsupported/custom");
});
test("zone choices include UTC, detected aliases and valid event zones without duplicates",()=>{
 const choices=calendarTimeZones(["Europe/Berlin","Asia/Kolkata","UTC"]);
 for(const zone of ["UTC","Europe/Berlin","Asia/Kolkata"])assert.ok(choices.includes(zone));
 assert.equal(choices.length,new Set(choices).size);
 assert.ok(choices.every(validCalendarTimeZone));
});
test("changing an event zone preserves both instants across date boundaries and DST",()=>{
 const converted=convertEventTimeZone("2026-03-29T01:30","2026-03-29T03:30","Europe/Berlin","America/New_York",false);
 assert.deepEqual(converted,{start:"2026-03-28T20:30",end:"2026-03-28T21:30"});
 assert.equal(eventLocalDateTime(converted.start,"America/New_York").toMillis(),eventLocalDateTime("2026-03-29T01:30","Europe/Berlin").toMillis());
});
test("ambiguous fall-back times preserve each existing event's explicit offset",()=>{
 for(const iso of ["2026-11-01T01:30:00-04:00","2026-11-01T01:30:00-05:00"]){
  assert.equal(eventLocalDateTime("2026-11-01T01:30","America/New_York",iso).toMillis(),DateTime.fromISO(iso).toMillis());
  const converted=convertEventTimeZone("2026-11-01T01:30","2026-11-01T02:30","America/New_York","UTC",false,{start:iso});
  assert.equal(DateTime.fromISO(converted.start,{zone:"UTC"}).toMillis(),DateTime.fromISO(iso).toMillis());
 }
});
test("nonexistent DST times are rejected rather than shifted silently",()=>{
 assert.throws(()=>eventLocalDateTime("2026-03-29T02:30","Europe/Berlin"),/does not exist/);
 assert.throws(()=>convertEventTimeZone("2026-03-29T02:30","2026-03-29T04:00","Europe/Berlin","UTC",false),/does not exist/);
 assert.throws(()=>convertEventTimeZone("2026-01-01T12:00","2026-01-01T13:00","UTC","unknown/invalid",false),/valid time zone/);
});
test("all-day date clicks are independent of the device and display offset",()=>{
 for(const zone of ["Pacific/Kiritimati","Pacific/Honolulu","Europe/Berlin"]){
  assert.deepEqual(newCalendarEvent("2026-03-29",true,zone),{start:"2026-03-29",end:"2026-03-30",allDay:true,timeZone:zone});
 }
 assert.deepEqual(convertEventTimeZone("2026-03-29","2026-03-30","UTC","Asia/Tokyo",true),{start:"2026-03-29",end:"2026-03-30"});
 assert.equal(eventLocalValue("2026-03-29","Pacific/Honolulu",true),"2026-03-29");
});
test("new timed drafts use the visible minute precision, not unrepresentable milliseconds",()=>{
 const e=newCalendarEvent("2026-11-17T14:21:59.123Z",false,"Europe/Berlin");
 assert.equal(e.start,"2026-11-17T15:21:00.000+01:00");
 assert.equal(e.end,"2026-11-17T16:21:00.000+01:00");
});
test("timed clicks keep the selected-zone instant and a one-hour duration",()=>{
 const e=newCalendarEvent("2026-03-29T01:30:00+01:00",false,"Europe/Berlin");
 assert.equal(e.start,"2026-03-29T01:30:00.000+01:00");
 assert.equal(e.end,"2026-03-29T03:30:00.000+02:00");
 assert.equal(DateTime.fromISO(e.end).toMillis()-DateTime.fromISO(e.start).toMillis(),3600000);
});
