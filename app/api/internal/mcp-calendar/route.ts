import {getChat} from "@/lib/db-store";
import {getJob} from "@/lib/db-jobs";
import {internalRunLeaseAuthorized} from "@/lib/internal-run-lease";
import {bearerTokenMatches} from "@/lib/security";
import {calendarResponse,calendarFailure,calendarBody} from "@/lib/calendar/http";
import {listCalendars,listCalendarEvents,getCalendarEvent,saveCalendarEvent,deleteCalendarEvent} from "@/lib/calendar/store";
import {listConnections} from "@/lib/calendar/connections";
import {CalendarError} from "@/lib/calendar/types";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(req:Request){
 if(!bearerTokenMatches(req,process.env.MCP_BEARER_TOKEN))return calendarResponse({error:"Unauthorized"},401);
 const owner=req.headers.get("x-ai-chat-user-id")||"",chatId=req.headers.get("x-ai-chat-id")||"",jobId=req.headers.get("x-ai-chat-job-id")||"";
 if(!owner||!chatId||!jobId||!internalRunLeaseAuthorized(req,jobId))return calendarResponse({error:"Unauthorized"},401);
 const chat=getChat(chatId,owner),job=getJob(jobId);
 if(!chat||!job||job.chatId!==chatId||job.userId!==owner)return calendarResponse({error:"Run context does not match this account"},403);
 if(chat.incognito||req.headers.get("x-ai-chat-incognito")==="1")return calendarResponse({error:"Calendar is unavailable in Incognito."},403);
 try{
  const body=await calendarBody(req,40000);
  if(body.action==="calendars")return calendarResponse({calendars:listCalendars(owner),connections:listConnections(owner)});
  if(body.action==="list")return calendarResponse({events:listCalendarEvents(owner,body.start,body.end,body.calendarId)});
  if(body.action==="get"){const {ics:omitted,...event}=getCalendarEvent(owner,body.id);void omitted;return calendarResponse({event});}
  if(body.action==="create"||body.action==="update"){const {action:omitted,...input}=body;void omitted;if(body.action==="create"&&(!input.idempotencyKey||input.id))throw new CalendarError("A creation idempotency key is required.");if(body.action==="update"&&!input.id)throw new CalendarError("An event ID is required.");const {ics:raw,...event}=saveCalendarEvent(owner,input);void raw;return calendarResponse({event});}
  if(body.action==="delete")return calendarResponse(deleteCalendarEvent(owner,body.id,body.version));
  throw new CalendarError("Unknown calendar action.");
 }catch(error){return calendarFailure(error);}
}
