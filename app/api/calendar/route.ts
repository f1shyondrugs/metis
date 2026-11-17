import {getAuthenticatedUserId} from "@/lib/auth";
import {requestOriginAllowed} from "@/lib/request-network";
import {CalendarError} from "@/lib/calendar/types";
import {listCalendars,listCalendarEvents,getCalendarEvent,saveCalendarEvent,deleteCalendarEvent,listCalendarConflicts} from "@/lib/calendar/store";
import {listConnections,disconnectCalendar,saveCalendarCredentials} from "@/lib/calendar/connections";
import {syncCalendarAccount,resolveCalendarConflict,calendarConflictDetail} from "@/lib/calendar/sync";
import {importLegacyCalendarConnection} from "@/lib/calendar/migration";
import {startCalendarOAuth,configureCalendarOAuth,calendarOAuthSetup} from "@/lib/calendar/oauth";
import {z} from "zod";
export const runtime="nodejs";export const dynamic="force-dynamic";
import {calendarResponse,calendarFailure,calendarBody} from "@/lib/calendar/http";
export async function GET(req:Request){
 const owner=await getAuthenticatedUserId(req);if(!owner)return calendarResponse({error:"Unauthorized"},401);
 try{const url=new URL(req.url);if(url.searchParams.has("conflict"))return calendarResponse({conflict:calendarConflictDetail(owner,url.searchParams.get("conflict")!)});if(url.searchParams.has("id")){const {ics:_,...event}=getCalendarEvent(owner,url.searchParams.get("id")!);return calendarResponse({event});}
 const start=url.searchParams.get("start"),end=url.searchParams.get("end");
 return calendarResponse({calendars:listCalendars(owner),connections:listConnections(owner),conflicts:listCalendarConflicts(owner),googleOAuth:calendarOAuthSetup(owner),events:start&&end?listCalendarEvents(owner,start,end):[]});}
 catch(error){return calendarFailure(error);}
}
export async function POST(req:Request){
 const owner=await getAuthenticatedUserId(req);if(!owner)return calendarResponse({error:"Unauthorized"},401);
 if(!requestOriginAllowed(req))return calendarResponse({error:"Forbidden origin"},403);
 try{
  const body=await calendarBody(req,64000);
  if(body.action==="save"){const {ics:_,...event}=saveCalendarEvent(owner,body.event);return calendarResponse({event},body.event.id?200:201);}
  if(body.action==="delete"){const value=z.object({id:z.string().uuid(),version:z.number().int().positive()}).parse(body);return calendarResponse(deleteCalendarEvent(owner,value.id,value.version));}
  if(body.action==="sync")return calendarResponse(await syncCalendarAccount(owner,{force:true}));
  if(body.action==="import"){const provider=z.enum(["icloud","google"]).parse(body.provider);const connection=await importLegacyCalendarConnection(owner,provider);return calendarResponse({connection});}
  if(body.action==="connect_icloud"){const value=z.object({username:z.string().trim().email().max(320),password:z.string().min(1).max(200)}).strict().parse(body.credentials);const connection=saveCalendarCredentials(owner,"icloud",value,"iCloud");value.password="";return calendarResponse({connection});}
  if(body.action==="configure_google"){const value=z.object({clientId:z.string().max(400),clientSecret:z.string().max(1000)}).strict().parse(body.credentials);const result=configureCalendarOAuth(owner,value.clientId,value.clientSecret);value.clientSecret="";return calendarResponse(result);}
  if(body.action==="connect_google")return calendarResponse(await startCalendarOAuth(owner));
  if(body.action==="disconnect")return calendarResponse(disconnectCalendar(owner,z.string().uuid().parse(body.id)));
  if(body.action==="resolve"){const v=z.object({id:z.string().uuid(),choice:z.enum(["metis","remote"]),version:z.number().int().positive()}).parse(body);return calendarResponse(resolveCalendarConflict(owner,v.id,v.choice,v.version));}
  throw new CalendarError("Unknown calendar action.");
 }catch(error){return calendarFailure(error);}
}
