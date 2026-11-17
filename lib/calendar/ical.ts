import ICAL from "ical.js";
import {getVtimezoneComponent} from "@touch4it/ical-timezones";
import {DateTime} from "luxon";
import {createHash} from "node:crypto";
import {CalendarError,type CalendarEvent,type CalendarOccurrence,type EventInput} from "./types";
const MAX_ICS=1024*1024;
export function parseCalendar(ics:string){
 if(typeof ics!=="string"||Buffer.byteLength(ics)>MAX_ICS)throw new CalendarError("Calendar item exceeds the supported size.",413);
 try{const c=new ICAL.Component(ICAL.parse(ics));if(c.name!=="vcalendar")throw Error();const e=c.getAllSubcomponents("vevent");if(!e.length||e.length>1000||e.some(v=>typeof v.getFirstPropertyValue("uid")!=="string"||!String(v.getFirstPropertyValue("uid")).trim()||String(v.getFirstPropertyValue("uid")).length>1000)||new Set(e.map(v=>String(v.getFirstPropertyValue("uid")))).size!==1)throw Error();
 for(const event of e)for(const key of ["dtstart","dtend","recurrence-id"]){const zone=event.getFirstProperty(key)?.getParameter("tzid");if(typeof zone!=="string"||zone==="UTC"||c.getAllSubcomponents("vtimezone").some(t=>t.getFirstPropertyValue("tzid")===zone))continue;if(!DateTime.now().setZone(zone).isValid)throw new CalendarError("The source calendar uses an unknown time zone. Its original is retained.",409,"unsupported");const timezone=getVtimezoneComponent(zone);if(!timezone)throw new CalendarError("A time zone definition is missing from the source calendar.",409,"unsupported");c.addSubcomponent(new ICAL.Component(ICAL.parse(timezone)));}
 return c;}
 catch(e){if(e instanceof CalendarError)throw e;throw new CalendarError("Invalid calendar item.");}
}
function main(c:ICAL.Component){return c.getAllSubcomponents("vevent").find(e=>!e.hasProperty("recurrence-id"))||c.getFirstSubcomponent("vevent")!;}
function timeValue(t:ICAL.Time){return t.isDate?t.toString().slice(0,10):t.zone===ICAL.Timezone.localTimezone?t.toString():t.toJSDate().toISOString();}
export function eventFields(ics:string){
 const c=parseCalendar(ics),m=main(c),e=new ICAL.Event(m);
 if(!e.startDate)throw new CalendarError("Calendar item has no start.");
 const end=e.endDate||e.startDate;
 return {uid:String(e.uid),title:String(e.summary||"Untitled event"),description:String(e.description||""),location:String(e.location||""),start:timeValue(e.startDate),end:timeValue(end),allDay:e.startDate.isDate,timeZone:String(m.getFirstProperty("dtstart")?.getParameter("tzid")||(e.startDate.zone===ICAL.Timezone.localTimezone?"floating":"UTC")),recurrence:String(m.getFirstPropertyValue("rrule")||"")};
}
export function normalizedEventHash(ics:string){
 const c=parseCalendar(ics);
 const rows=c.getAllSubcomponents("vevent").map(v=>{
  const e=new ICAL.Event(v);return {...eventFields(new ICAL.Component(["vcalendar",[],[...c.getAllSubcomponents("vtimezone").map(t=>t.toJSON()),v.toJSON()]]).toString()),recurrenceId:v.getFirstPropertyValue("recurrence-id")?.toString()||"",status:v.getFirstPropertyValue("status")||"",rules:["rrule","rdate","exdate"].flatMap(k=>v.getAllProperties(k).map(p=>p.toICALString())).sort(),alarms:v.getAllSubcomponents("valarm").map(a=>a.toString()).sort(),duration:e.duration.toString()};
 }).sort((a,b)=>a.recurrenceId.localeCompare(b.recurrenceId));
 return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
function isoTime(value:string,allDay:boolean,zone:string,calendar:ICAL.Component){
 if(allDay){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!DateTime.fromISO(value).isValid)throw new CalendarError("Use a valid all-day date.");return ICAL.Time.fromDateString(value);}
 if(!DateTime.local().setZone(zone).isValid)throw new CalendarError("Choose a valid time zone.");
 const dt=DateTime.fromISO(value,{zone,setZone:true});if(!dt.isValid||!/[zZ]|[+-]\d{2}:\d{2}$/.test(value))throw new CalendarError("Timed events require an ISO time with an explicit offset.");
  if(zone==="UTC")return ICAL.Time.fromJSDate(dt.toUTC().toJSDate(),true);
 let timezone=calendar.getAllSubcomponents("vtimezone").find(t=>t.getFirstPropertyValue("tzid")===zone);
 if(!timezone){const data=getVtimezoneComponent(zone);if(!data)throw new CalendarError("This time zone cannot be exported safely.");timezone=new ICAL.Component(ICAL.parse(data));calendar.addSubcomponent(timezone);}
 const local=dt.setZone(zone),t=new ICAL.Time({year:local.year,month:local.month,day:local.day,hour:local.hour,minute:local.minute,second:local.second},new ICAL.Timezone({component:timezone,tzid:zone}));
 if(t.toJSDate().getTime()!==dt.toMillis())throw new CalendarError("This time zone definition needs an update. Choose UTC or edit the event in its source calendar.");
 return t;
}
export function writeEvent(input:EventInput,uid:string,previous?:string){
 const c=previous?parseCalendar(previous):new ICAL.Component(["vcalendar",[["version",{},"text","2.0"],["prodid",{},"text","-//Metis//Calendar//EN"]],[]]);
 const m=previous?main(c):new ICAL.Component("vevent");if(!previous)c.addSubcomponent(m);
 const start=isoTime(input.start,!!input.allDay,input.timeZone||"UTC",c),end=isoTime(input.end,!!input.allDay,input.timeZone||"UTC",c);
 if(end.compare(start)<=0)throw new CalendarError("End must be after start.");
 m.updatePropertyWithValue("uid",uid);m.updatePropertyWithValue("summary",input.title);m.updatePropertyWithValue("description",input.description||"");m.updatePropertyWithValue("location",input.location||"");
 m.removeAllProperties("duration");for(const [name,value] of [["dtstart",start],["dtend",end]] as const){m.removeAllProperties(name);const p=new ICAL.Property(name);p.resetType(input.allDay?"date":"date-time");p.setValue(value);if(!input.allDay&&input.timeZone&&input.timeZone!=="UTC")p.setParameter("tzid",input.timeZone);m.addProperty(p);}m.updatePropertyWithValue("dtstamp",ICAL.Time.now());
 const oldRule=String(m.getFirstPropertyValue("rrule")||"");
 if((input.recurrence||"")!==oldRule){if(c.getAllSubcomponents("vevent").length>1)throw new CalendarError("A recurring series with exceptions cannot change its rule here.");m.removeAllProperties("rrule");if(input.recurrence){try{m.updatePropertyWithValue("rrule",ICAL.Recur.fromString(input.recurrence));}catch{throw new CalendarError("Invalid recurrence rule.");}}}
 return c.toString();
}
/** New cross-provider replicas never send invitations; target scheduling metadata is retained on updates. */
export function mirrorPayload(ics:string,target?:string){
 const c=parseCalendar(ics),old=target?parseCalendar(target):null;
 for(const v of c.getAllSubcomponents("vevent")){
  const rid=String(v.getFirstPropertyValue("recurrence-id")||"");
  const previous=old?.getAllSubcomponents("vevent").find(e=>String(e.getFirstPropertyValue("recurrence-id")||"")===rid);
  for(const name of ["attendee","organizer","x-microsoft-cdo-owner-critical-change","x-microsoft-cdo-attendee-critical-change"]){v.removeAllProperties(name);for(const prop of previous?.getAllProperties(name)||[])v.addProperty(new ICAL.Property(prop.toJSON()));}
 }
 c.removeAllProperties("method");
 return c.toString();
}
export function calendarRange(from:string,to:string){const min=Date.parse(from),max=Date.parse(to);if(typeof from!=="string"||typeof to!=="string"||!Number.isFinite(min)||!Number.isFinite(max)||max<=min||max-min>370*86400000)throw new CalendarError("Choose a calendar range up to one year.");return {min,max};}
export function expandEvent(event:CalendarEvent,from:string,to:string):CalendarOccurrence[]{
 if(event.deleted)return [];
 const c=parseCalendar(event.ics),m=main(c),exceptions=c.getAllSubcomponents("vevent").filter(v=>v!==m),e=new ICAL.Event(m,{exceptions:exceptions.map(v=>new ICAL.Event(v))});
 const out:CalendarOccurrence[]=[];let {min,max}=calendarRange(from,to);let steps=0;
 // Floating and all-day values follow the viewer’s wall clock, not the server time zone.
 if(e.startDate.isDate||e.startDate.zone===ICAL.Timezone.localTimezone){min=DateTime.fromISO(from,{setZone:true}).toUTC(0,{keepLocalTime:true}).toMillis();max=DateTime.fromISO(to,{setZone:true}).toUTC(0,{keepLocalTime:true}).toMillis();}
 const instant=(t:ICAL.Time)=>t.isDate||t.zone===ICAL.Timezone.localTimezone?DateTime.fromObject({year:t.year,month:t.month,day:t.day,hour:t.hour,minute:t.minute,second:t.second},{zone:"UTC"}).toMillis():t.toJSDate().getTime();
 const add=(start:ICAL.Time,end:ICAL.Time,item:ICAL.Event)=>{
  if(item.component.getFirstPropertyValue("status")==="CANCELLED")return;
  const startMs=instant(start),endMs=instant(end);
  if(endMs>min&&startMs<max){const {ics:omitted,...publicEvent}=event;void omitted;out.push({...publicEvent,id:event.id+":"+start.toString(),eventId:event.id,title:item.summary||event.title,start:timeValue(start),end:timeValue(end)});}
 };
 if(!e.isRecurring()){add(e.startDate,e.endDate,e);return out;}
 const it=e.iterator();let next:ICAL.Time|null;
 while((next=it.next())){
  if(++steps>100000||out.length>=3000)throw new CalendarError("This recurring calendar item exceeds the display limit.",413);
  if(instant(next)>=max)break;
  const d=e.getOccurrenceDetails(next);add(d.startDate,d.endDate,d.item);
 }
 return out;
}
