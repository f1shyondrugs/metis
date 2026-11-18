"use client";
import {useEffect,useState} from "react";
import {subscribeToWindowEvents} from "@/lib/browser-events";
import {DEVICE_TIME_ZONE,calendarTimeZoneKey,calendarTimeZonePreference,deviceCalendarTimeZone,validCalendarTimeZone} from "@/lib/calendar/time-zone";
type ZoneState={owner:string|undefined;preference:string;device:ReturnType<typeof deviceCalendarTimeZone>;sessionOnly:boolean};
export function useCalendarTimeZone(owner?:string){
 const [state,setState]=useState<ZoneState|null>(null);
 useEffect(()=>{
  const key=owner?calendarTimeZoneKey(owner):null;
  let preference=DEVICE_TIME_ZONE,sessionOnly=false;
  try{if(key)preference=calendarTimeZonePreference(window.localStorage.getItem(key));}catch{sessionOnly=true;}
  setState({owner,preference,device:deviceCalendarTimeZone(),sessionOnly});
  const refresh=()=>{if(document.visibilityState==="hidden")return;const device=deviceCalendarTimeZone();setState(old=>old&&old.owner===owner&&(old.device.zone!==device.zone||old.device.detected!==device.detected)?{...old,device}:old);};
  const storage=(event:Event)=>{const e=event as StorageEvent;if(key&&(e.key===key||e.key===null))setState(old=>old&&old.owner===owner?{...old,preference:calendarTimeZonePreference(e.newValue)}:old);};
  const off=subscribeToWindowEvents(["focus","pageshow"],refresh),offStorage=subscribeToWindowEvents(["storage"],storage),offVisible=subscribeToWindowEvents(["visibilitychange"],refresh,document);
  return()=>{off();offStorage();offVisible();};
 },[owner]);
 const ready=!!state&&state.owner===owner;
 const preference=ready?state.preference:DEVICE_TIME_ZONE;
 const device=ready?state.device:{zone:"UTC",detected:false};
 function choose(value:string){
  if(!ready||value!==DEVICE_TIME_ZONE&&!validCalendarTimeZone(value))return;
  let sessionOnly=false;
  try{if(owner)window.localStorage.setItem(calendarTimeZoneKey(owner),value);}catch{sessionOnly=true;}
  setState(old=>old&&old.owner===owner?{...old,preference:value,sessionOnly}:old);
 }
 return{ready,preference,zone:preference===DEVICE_TIME_ZONE?device.zone:preference,device,choose,sessionOnly:ready&&state.sessionOnly};
}
