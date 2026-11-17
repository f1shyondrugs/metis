import {DateTime,IANAZone} from "luxon";
export const DEVICE_TIME_ZONE="device";
export function validCalendarTimeZone(value:unknown):value is string{
 return typeof value==="string"&&value.length<=120&&(value==="UTC"||IANAZone.isValidZone(value));
}
export function deviceCalendarTimeZone(resolve=()=>Intl.DateTimeFormat().resolvedOptions().timeZone){
 try{const zone=resolve();if(validCalendarTimeZone(zone))return{zone,detected:true};}catch{}
 return{zone:"UTC",detected:false};
}
export function calendarTimeZonePreference(value:unknown){
 return validCalendarTimeZone(value)?value:DEVICE_TIME_ZONE;
}
export function calendarTimeZoneKey(owner:string){return "metis:calendar-time-zone:"+encodeURIComponent(owner);}
export function calendarTimeZones(include:string[]=[]){
 let zones:string[]=[];
 try{if(typeof Intl.supportedValuesOf==="function")zones=Intl.supportedValuesOf("timeZone");}catch{}
 return [...new Set(["UTC",...zones,...include])].filter(validCalendarTimeZone).sort((a,b)=>a.localeCompare(b,"en"));
}
export function eventEditorTimeZone(event:{timeZone?:string;allDay?:boolean},fallback:string){
 // Date-only values have no TZID. Keep their dates and use the selected display
 // zone only if the user later changes the draft to a timed event.
 return event.allDay?(validCalendarTimeZone(event.timeZone)?event.timeZone:fallback):(event.timeZone||fallback);
}
export function eventLocalValue(value:string,zone:string,allDay:boolean){
 return allDay?value.slice(0,10):DateTime.fromISO(value,{zone}).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm");
}
export function eventLocalDateTime(value:string,zone:string,referenceISO?:string){
 const reference=referenceISO?DateTime.fromISO(referenceISO,{zone}).setZone(zone):null;
 if(reference?.isValid&&reference.toFormat("yyyy-MM-dd'T'HH:mm")===value)return reference;
 const parsed=DateTime.fromISO(value,{zone});
 if(!parsed.isValid||parsed.toFormat("yyyy-MM-dd'T'HH:mm")!==value)throw Error("This local time does not exist in the selected time zone.");
 return parsed;
}
export function convertEventTimeZone(start:string,end:string,from:string,to:string,allDay:boolean,reference:{start?:string;end?:string}={}){
 if(!validCalendarTimeZone(to))throw Error("Choose a valid time zone.");
 if(allDay)return{start,end};
 const convert=(value:string,original?:string)=>value?eventLocalDateTime(value,from,original).setZone(to).toFormat("yyyy-MM-dd'T'HH:mm"):"";
 return{start:convert(start,reference.start),end:convert(end,reference.end)};
}
export function newCalendarEvent(start:string,allDay:boolean,timeZone:string){
 const date=DateTime.fromISO(allDay?start.slice(0,10):start,{zone:allDay?"UTC":timeZone}).startOf("minute");
 if(!date.isValid)throw Error("Choose a valid calendar date.");
 return{start:allDay?date.toISODate()!:date.toISO()!,end:allDay?date.plus({days:1}).toISODate()!:date.plus({hours:1}).toISO()!,allDay,timeZone};
}
