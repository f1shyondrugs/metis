"use client";
import {useMemo} from "react";
import {DEVICE_TIME_ZONE,calendarTimeZones} from "@/lib/calendar/time-zone";
export function CalendarTimeZoneSelect({value,onChange,device,disabled=false,name,label="Time zone"}:{value:string;onChange:(zone:string)=>void;device?:{zone:string;detected:boolean};disabled?:boolean;name?:string;label?:string}){
 const deviceZone=device?.zone;
 const zones=useMemo(()=>calendarTimeZones([value,...(deviceZone?[deviceZone]:[])]),[value,deviceZone]);
 return <label className="block min-w-0 text-sm">{label}<select name={name} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)} className="mt-1 h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm">
  {device?<option value={DEVICE_TIME_ZONE}>Device time zone ({device.detected?device.zone:"unavailable; using UTC"})</option>:null}
  {!zones.includes(value)&&value!==DEVICE_TIME_ZONE?<option value={value}>{value} (unavailable)</option>:null}
  {zones.map(zone=><option key={zone} value={zone}>{zone.replaceAll("_"," ")}</option>)}
 </select></label>;
}
