import {DateTime} from "luxon";
import {calendarDb,getCalendarEvent,eventFromRow} from "./store";
import {calendarEventRecurs,expandEvent} from "./ical";
import {CalendarError,type CalendarEvent,type CalendarOccurrence} from "./types";
import {validCalendarTimeZone} from "./time-zone";
import {referenceMatches,type ReferenceResult} from "../reference-search";

export function calendarEventReference(event:CalendarEvent,calendarName:string):ReferenceResult{
 return{kind:"calendar-event",id:event.id,label:event.title,detail:[calendarName,event.start,event.recurrence?"Recurring":""].filter(Boolean).join(" · "),
 content:JSON.stringify({id:event.id,calendar:calendarName,title:event.title,description:event.description.slice(0,4000),location:event.location,start:event.start,end:event.end,allDay:event.allDay,timeZone:event.timeZone,recurrence:event.recurrence,version:event.version})};
}
function calendarInfo(owner:string,id:string){
 return calendarDb().prepare("SELECT name,color FROM calendar_groups WHERE owner=? AND id=?").get(owner,id) as {name:string;color:string}|undefined;
}
export function resolveCalendarReference(owner:string|undefined,id:string):ReferenceResult|null{
 if(!owner)return null;
 try{const event=getCalendarEvent(owner,id),calendar=calendarInfo(owner,event.calendarId);return !event.deleted&&calendar?calendarEventReference(event,calendar.name):null;}catch(error){if(error instanceof CalendarError&&error.status===404)return null;throw error;}
}
export function searchCalendarReferences(owner:string,query:string,limit:number,check:()=>void):ReferenceResult[]{
 if(!owner)return[];
 const rows=calendarDb().prepare("SELECT e.*,g.read_only,g.name FROM calendar_events e JOIN calendar_groups g ON g.id=e.group_id AND g.owner=e.owner WHERE e.owner=? AND e.deleted=0 ORDER BY e.id LIMIT 10001").iterate(owner);
 const results:ReferenceResult[]=[];let count=0,bytes=0;
 for(const value of rows){
  check();const row=value as Parameters<typeof eventFromRow>[0]&{name:string};
  if(++count>10000||(bytes+=Buffer.byteLength(row.ics))>32*1024*1024)throw new CalendarError("Too many calendar items to search.",413);
  const event=eventFromRow(row);
  if(referenceMatches(query,event.title,row.name,event.location,event.description)){
   results.push(calendarEventReference(event,row.name));if(results.length>=limit)break;
  }
 }
 return results;
}
/** Today first, then the next real expanded occurrence (including recurrence exceptions).
 * Sparse recurrences are searched in bounded year windows; exhausted series have no invented next date. */
export function calendarReferenceOccurrence(event:CalendarEvent,zone:string,now:DateTime=DateTime.now()):CalendarOccurrence|null{
 if(event.deleted)return null;
 if(!calendarEventRecurs(event)){const{ics,...rest}=event;void ics;return{...rest,id:event.id+":"+event.start,eventId:event.id};}
 let from=now.setZone(validCalendarTimeZone(zone)?zone:"UTC").startOf("day");
 for(let year=0;year<10;year++){
  const to=from.plus({days:366});
  const occurrences=expandEvent(event,from.toISO()!,to.toISO()!).sort((a,b)=>DateTime.fromISO(a.start,{zone:"UTC"}).toMillis()-DateTime.fromISO(b.start,{zone:"UTC"}).toMillis());
  if(occurrences.length)return occurrences[0];
  from=to;
 }
 return null;
}
export function getCalendarReference(owner:string,id:string,zone="UTC"){
 const event=getCalendarEvent(owner,id),calendar=calendarInfo(owner,event.calendarId);
 if(event.deleted||!calendar)throw new CalendarError("Event not found.",404);
 const occurrence=calendarReferenceOccurrence(event,zone);
 const{ics,...safe}=event;void ics;
 return{event:safe,calendar,occurrence,upcoming:Boolean(occurrence),recurring:calendarEventRecurs(event)};
}
