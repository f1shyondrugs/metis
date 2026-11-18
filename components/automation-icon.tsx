"use client";
import {CalendarClock} from "lucide-react";
import {NoteIcon} from "./notes/note-icon";
export function AutomationIcon({value,className="size-4"}:{value?:string|null;className?:string}){
 return value?<NoteIcon value={value} className={className}/>:<CalendarClock aria-hidden="true" className={className}/>;
}
