"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import {DateTime} from "luxon";
import {ChevronLeft,ChevronRight,Plus,Link,RefreshCw} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from "@/components/ui/dialog";
import {ConfirmDialog} from "@/components/confirm-dialog";
import {CalendarConflict} from "./calendar-conflict";
import {CalendarFilter} from "./calendar-filter";
import {CalendarConnections,calendarAction} from "./calendar-connections";
import {createClientId} from "@/lib/client-id";
import type {CalendarConnection,CalendarEvent,CalendarGroup,CalendarOccurrence,EventInput} from "@/lib/calendar/types";
import {CalendarTimeZoneSelect} from "./calendar-time-zone-select";
import {useCalendarTimeZone} from "./use-calendar-time-zone";
import {allDayEventRange,convertEventTimeZone,eventEditorTimeZone,eventLocalDateTime,eventLocalValue,newCalendarEvent,nextAllDayDate} from "@/lib/calendar/time-zone";
import "./calendar.css";
type CalendarData={calendars:CalendarGroup[];connections:CalendarConnection[];events:CalendarOccurrence[];conflicts:{id:string;eventId:string;calendarName:string}[];googleOAuth:{configured:boolean;redirectUri:string}};
function EventEditor({event,calendars,defaultTimeZone,onClose,onSaved}:{event:Partial<CalendarEvent>;calendars:CalendarGroup[];defaultTimeZone:string;onClose:()=>void;onSaved:()=>void}){
 const [zone,setZone]=useState(()=>eventEditorTimeZone(event,defaultTimeZone));
 const [allDay,setAllDay]=useState(!!event.allDay),[error,setError]=useState(""),[busy,setBusy]=useState(false),[confirmDelete,setConfirmDelete]=useState(false);
 const [start,setStart]=useState(eventLocalValue(event.start||new Date().toISOString(),zone,allDay)),[end,setEnd]=useState(eventLocalValue(event.end||new Date(Date.now()+3600000).toISOString(),zone,allDay));
 const key=useRef(createClientId()),pending=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const readOnly=event.readOnly||!DateTime.now().setZone(zone).isValid;
 async function submit(form:HTMLFormElement){
  if(pending.current)return;pending.current=true;setBusy(true);setError("");
  try{
   const data=new FormData(form);
   if(allDay&&(!nextAllDayDate(start)||!nextAllDayDate(end)||end<=start))throw Error("For an all-day event, end must be at least the day after start.");
   function date(value:string,reference?:string){return allDay?value.slice(0,10):eventLocalDateTime(value,zone,reference).toISO()!;}
   const body:EventInput={calendarId:String(data.get("calendarId")),title:String(data.get("title")),description:String(data.get("description")||""),location:String(data.get("location")||""),start:date(start,event.start),end:date(end,event.end),allDay,timeZone:zone,...(data.get("reminder")==="preserve"?{}:{reminderMinutes:data.get("reminder")==="none"?[]:[Number(data.get("reminder"))]}),recurrence:String(data.get("recurrence")||event.recurrence||""),...(event.id?{id:event.id,version:event.version}:{idempotencyKey:key.current})};
   await calendarAction({action:"save",event:body});if(mounted.current){onSaved();onClose();}
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Could not save event.");}
  finally{pending.current=false;if(mounted.current)setBusy(false);}
 }
 return <><Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" closeButtonDisabled={busy}>
  <DialogHeader><DialogTitle>{event.id?"Event":"New event"}</DialogTitle><DialogDescription>{event.recurrence?"Changes apply to the entire recurring series.":readOnly?"This calendar is read-only.":"Changes are saved in Metis and synchronized to connected calendars."}</DialogDescription></DialogHeader>
  <form id="calendar-event-form" className="space-y-3" onSubmit={e=>{e.preventDefault();void submit(e.currentTarget);}}>
   <label className="block text-sm">Title<Input name="title" defaultValue={event.title||""} maxLength={500} required disabled={readOnly} autoFocus/></label>
   <label className="block text-sm">Calendar<select name="calendarId" defaultValue={event.calendarId||calendars.find(c=>!c.readOnly)?.id} disabled={!!event.id||readOnly} className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3">{calendars.filter(c=>!c.readOnly||c.id===event.calendarId).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   {event.id?<input type="hidden" name="calendarId" value={event.calendarId}/>:null}
   <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={allDay} disabled={readOnly} onChange={e=>{setAllDay(e.target.checked);if(e.target.checked){const range=allDayEventRange(start,end);setStart(range.start);setEnd(range.end);}else{setStart(start.slice(0,10)+"T09:00");setEnd(end.slice(0,10)+"T10:00");}}}/>All day</label>
   <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="block text-sm">Start<Input type={allDay?"date":"datetime-local"} value={start} required disabled={readOnly} onChange={e=>{const value=e.target.value;setStart(value);if(allDay&&nextAllDayDate(value))setEnd(current=>allDayEventRange(value,current).end);}}/></label><label className="block text-sm">{allDay?"End (exclusive)":"End"}<Input type={allDay?"date":"datetime-local"} value={end} min={allDay?nextAllDayDate(start)||undefined:undefined} required disabled={readOnly} onChange={e=>setEnd(allDay?allDayEventRange(start,e.target.value).end:e.target.value)}/></label></div>
   {allDay?<p className="text-xs text-muted-foreground">End is not included. For one day, choose the following date as the end.</p>:null}
   {!allDay?<><CalendarTimeZoneSelect name="timeZone" value={zone} disabled={readOnly||busy} onChange={next=>{try{const converted=convertEventTimeZone(start,end,zone,next,allDay,event);setStart(converted.start);setEnd(converted.end);setZone(next);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not change time zone.");}}}/><p className="text-xs text-muted-foreground">Changing the time zone converts these times without moving the event.</p></>:null}
   <label className="block text-sm">Notification<select name="reminder" defaultValue={event.id?"preserve":"none"} disabled={readOnly} className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3">{event.id?<option value="preserve">Keep existing alerts{event.reminderMinutes?.length?" ("+event.reminderMinutes.map(v=>v===0?"at start":v+" min before").join(", ")+")":""}</option>:null}<option value="none">None (preserve other alarm types)</option><option value="0">At event start</option><option value="5">5 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select><span className="mt-1 block text-xs text-muted-foreground">Delivered by your connected calendar app, subject to its notification settings.</span></label>
   <label className="block text-sm">Location<Input name="location" defaultValue={event.location||""} maxLength={2000} disabled={readOnly}/></label>
   <details><summary className="cursor-pointer py-2 text-sm text-muted-foreground">More options</summary>
    <label className="block text-sm">Description<textarea name="description" defaultValue={event.description||""} maxLength={20000} disabled={readOnly} className="mt-1 min-h-20 w-full rounded-md border border-input bg-background p-2"/></label>
    <label className="mt-3 block text-sm">Repeat<select name="recurrence" defaultValue={event.recurrence||""} disabled={readOnly||!!event.recurrence} className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3">{event.recurrence?<option value={event.recurrence}>Existing recurrence (preserved)</option>:<><option value="">Does not repeat</option><option value="FREQ=DAILY">Daily</option><option value="FREQ=WEEKLY">Weekly</option><option value="FREQ=MONTHLY">Monthly</option><option value="FREQ=YEARLY">Yearly</option></>}</select></label>
   </details>
   {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
  </form>
  <DialogFooter>{event.id&&!readOnly?<Button variant="ghost" size="action" disabled={busy} onClick={()=>setConfirmDelete(true)} className="mr-auto text-destructive">Delete</Button>:null}<Button variant="ghost" size="action" disabled={busy} onClick={onClose}>Close</Button>{!readOnly?<Button size="action" type="submit" form="calendar-event-form" disabled={busy}>{busy?"Saving…":"Save event"}</Button>:null}</DialogFooter>
 </DialogContent></Dialog>
 <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={event.recurrence?"Delete the entire series?":"Delete event?"} description="This removes the Metis event and its linked copies from writable connected calendars." confirmLabel="Delete event" onConfirm={async()=>{await calendarAction({action:"delete",id:event.id,version:event.version});onSaved();onClose();}}/>
 </>;
}
export function CalendarPanel({userId}:{userId?:string}={}){
 const timeZone=useCalendarTimeZone(userId);
 const calendar=useRef<FullCalendar>(null),[data,setData]=useState<CalendarData|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[title,setTitle]=useState("Calendar"),[view,setView]=useState("dayGridMonth"),[connections,setConnections]=useState(false),[event,setEvent]=useState<Partial<CalendarEvent>|null>(null),[hidden,setHidden]=useState<string[]>([]);
 const [conflictId,setConflictId]=useState<string|null>(null);
 const [range,setRange]=useState<{start:string;end:string}|null>(null),[revision,setRevision]=useState(0),mounted=useRef(true),syncing=useRef(false),opening=useRef(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const refresh=useCallback(()=>setRevision(v=>v+1),[]);
 useEffect(()=>{
  if(!range)return;const controller=new AbortController();
  fetch("/api/calendar?"+new URLSearchParams(range),{cache:"no-store",signal:controller.signal}).then(async r=>{const value=await r.json();if(!r.ok)throw Error(value.error||"Could not load calendar.");if(!controller.signal.aborted){setData(value);setError("");}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();
 },[range,revision]);
 useEffect(()=>{const timer=setInterval(refresh,30000);return()=>clearInterval(timer);},[refresh]);
 async function sync(){if(syncing.current)return;syncing.current=true;setBusy(true);setError("");try{await calendarAction({action:"sync"});if(mounted.current)refresh();}catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Sync failed.");}finally{syncing.current=false;if(mounted.current)setBusy(false);}}
 async function openEvent(id:string){const epoch=++opening.current;try{const r=await fetch("/api/calendar?id="+encodeURIComponent(id)),v=await r.json();if(!r.ok)throw Error(v.error||"Could not open event.");if(mounted.current&&epoch===opening.current)setEvent(v.event);}catch(e){if(mounted.current&&epoch===opening.current)setError(e instanceof Error?e.message:"Could not open event.");}}
 function newEvent(start=new Date().toISOString(),allDay=false){setEvent(newCalendarEvent(start,allDay,timeZone.zone));}
 return <section className="metis-calendar flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Calendar">
  <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3 sm:px-5">
   <div className="w-full min-w-0 sm:w-64"><CalendarTimeZoneSelect label="Calendar time zone" name="calendarTimeZone" value={timeZone.preference} onChange={timeZone.choose} device={timeZone.device} disabled={!timeZone.ready}/></div>
   <Button variant="ghost" size="icon-action" className="ml-auto" aria-label="Sync calendars" disabled={busy} onClick={()=>void sync()}><RefreshCw className={busy?"size-4 animate-spin motion-reduce:animate-none":"size-4"}/></Button>
   <Button variant="outline" size="action" aria-label="Connections" onClick={()=>setConnections(true)}><Link className="size-4"/><span className="hidden sm:inline">Connections</span><span className="sr-only sm:hidden">Connections</span></Button>
   <Button size="action" onClick={()=>newEvent()} disabled={!data?.calendars.some(c=>!c.readOnly)}><Plus className="size-4"/>New event</Button>
   <div className="flex w-full flex-wrap items-center gap-1 pt-1">
    <Button variant="ghost" size="icon-action" aria-label="Previous period" onClick={()=>calendar.current?.getApi().prev()}><ChevronLeft className="size-4"/></Button><Button variant="ghost" size="icon-action" aria-label="Next period" onClick={()=>calendar.current?.getApi().next()}><ChevronRight className="size-4"/></Button>
    <h2 className="mr-auto min-w-0 text-sm font-medium" aria-live="polite">{title}</h2>
    <Button variant="ghost" size="action" onClick={()=>calendar.current?.getApi().today()}>Today</Button>
    <div className="ml-auto flex rounded-md bg-muted/40 p-0.5 sm:ml-0" aria-label="Calendar view">{[["dayGridMonth","Month"],["timeGridWeek","Week"]].map(([value,label])=><Button key={value} variant={view===value?"secondary":"ghost"} size="action" aria-pressed={view===value} onClick={()=>{calendar.current?.getApi().changeView(value);setView(value);}}>{label}</Button>)}</div>
   </div>
  </header>
  {timeZone.sessionOnly?<p role="status" className="px-4 py-2 text-xs text-muted-foreground">Time zone preference is available for this session only.</p>:null}
  {error?<div role="alert" className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-sm text-destructive">{error}<Button variant="ghost" size="action" onClick={refresh}>Retry</Button></div>:null}
  {!data&&!error?<p role="status" className="px-4 pt-3 text-sm text-muted-foreground">Loading calendar…</p>:null}
  {data?<CalendarFilter calendars={data.calendars} hidden={hidden} onToggle={(id,visible)=>setHidden(v=>visible?v.filter(value=>value!==id):[...new Set([...v,id])])}>
   {!data.connections.some(c=>c.enabled)?<Button variant="ghost" size="action" className="hidden text-xs sm:inline-flex" onClick={()=>setConnections(true)}>Connect iCloud or Google</Button>:<span>{data.connections.some(c=>c.enabled&&c.error)?"Sync needs attention":data.connections.some(c=>c.enabled&&c.status!=="ready")?"Waiting for first sync":"Native sync enabled"}</span>}
  </CalendarFilter>:null}
  {data&&!error&&data.events.length===0?<p role="status" className="px-4 pt-2 text-xs text-muted-foreground">No events in this period.</p>:null}
  {data?.conflicts.length?<div role="status" className="border-b border-border px-4 py-2 text-sm">{data.conflicts.length} sync conflict{data.conflicts.length===1?"":"s"}. No version was overwritten.{data.conflicts.map(c=><div key={c.id} className="mt-2 flex flex-wrap items-center gap-2"><span>{c.calendarName}</span><Button variant="outline" size="action" onClick={()=>setConflictId(c.id)}>Review conflict</Button></div>)}</div>:null}
  <div className="min-h-0 flex-1 overflow-auto p-2 sm:p-4"><div className={view==="timeGridWeek"?"min-w-[620px] h-full":"h-full min-w-0"}>
   {timeZone.ready?<FullCalendar ref={calendar} timeZone={timeZone.zone} plugins={[dayGridPlugin,timeGridPlugin,interactionPlugin,luxonPlugin]} initialView="dayGridMonth" headerToolbar={false} height="100%" firstDay={1} locale="en-gb" nowIndicator allDaySlot stickyHeaderDates dayMaxEvents={3} eventDisplay="block" displayEventEnd eventTimeFormat={{hour:"2-digit",minute:"2-digit",hour12:false}}
    events={(data?.events||[]).filter(e=>!hidden.includes(e.calendarId)).map(e=>({id:e.id,title:e.title,start:e.start,end:e.end,allDay:e.allDay,color:data?.calendars.find(c=>c.id===e.calendarId)?.color,extendedProps:{eventId:e.eventId}}))}
    datesSet={info=>{setTitle(info.view.title);setRange(current=>current?.start===info.startStr&&current.end===info.endStr?current:{start:info.startStr,end:info.endStr});}}
    dateClick={info=>newEvent(info.dateStr,info.allDay)} eventClick={info=>void openEvent(info.event.extendedProps.eventId)}
   />:null}
  </div></div>
  {data&&event?<EventEditor key={event.id||"new"} event={event} calendars={data.calendars} defaultTimeZone={timeZone.zone} onClose={()=>setEvent(null)} onSaved={refresh}/>:null}
  {conflictId?<CalendarConflict key={conflictId} id={conflictId} onClose={()=>setConflictId(null)} onChanged={refresh}/>:null}
  {data&&connections?<CalendarConnections connections={data.connections} googleOAuth={data.googleOAuth} onClose={()=>setConnections(false)} onChanged={refresh}/>:null}
 </section>;
}
