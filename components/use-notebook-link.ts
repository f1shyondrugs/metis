"use client";
import {useSyncExternalStore} from "react";
import {parseNotebookLink} from "@/lib/notebook-link";
const subscribe=()=>()=>{};
const clientOrigin=()=>window.location.origin;
const serverOrigin=()=>undefined;
/** Hydration-safe, origin-bound recognition shared by editor, Markdown and message links. */
export function useNotebookLink(href:string|undefined){
 const origin=useSyncExternalStore<string|undefined>(subscribe,clientOrigin,serverOrigin);
 return parseNotebookLink(href,origin);
}
