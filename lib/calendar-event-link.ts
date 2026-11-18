import {unwrapToolRecord} from "./tool-call-display";
import {resolveMcpToolName} from "./tool-kind";
export function calendarEventEmbedId(source:string):string|null{
 try{const value=JSON.parse(source);return typeof value?.id==="string"&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value.id)?value.id:null;}catch{return null;}
}
export function calendarEventMutation(name:string,input:unknown){return /(?:^|__|[.:/-])calendar_(?:create|update)_event$/i.test(resolveMcpToolName(name,input));}
/** Only a successful acknowledged creation/update result can create an automatic card. */
export function calendarEventToolId(name:string,input:unknown,result:unknown,status:string):string|null{
 if(!/^(completed|success|succeeded|done)$/i.test(status)||!calendarEventMutation(name,input))return null;
 const payload=unwrapToolRecord(result);
 if(!payload||payload.isError||payload.error||payload.ok===false||payload.success===false)return null;
 const event=payload.event as Record<string,unknown>|undefined;
 return event?calendarEventEmbedId(JSON.stringify({id:event.id})):null;
}
