"use client";
import type{ReferenceResult}from"@/lib/reference-search";
import{LinkIcon}from"./link-icon";import{NoteIcon}from"./notes/note-icon";import{NotebookProjectIcon}from"./notes/notebook-project-icon";import{AutomationIcon}from"./automation-icon";
export function ReferenceResultIcon({item}:{item:ReferenceResult}){
 return <span data-reference-result-icon={item.kind} className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">
  {item.kind==="note"?<NoteIcon value={item.icon} className="size-4"/>:item.kind==="automation"?<AutomationIcon value={item.icon}/>:<LinkIcon kind={item.kind} className="!mr-0 !size-4"/>}
 </span>;
}
export function ReferenceResultMetadata({item}:{item:ReferenceResult}){
 const context=item.calendar?.name||item.project?.name;
 let detail=item.detail||"";
 if(context&&detail.startsWith(context))detail=detail.slice(context.length).replace(/^[ ·/]+/u,"");
 if(!context&&!detail)return null;
 return <span data-reference-metadata className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
  {item.project?<span data-reference-project={item.project.id} title={item.project.name} className="inline-flex min-w-0 max-w-[65%] shrink items-center gap-1"><NotebookProjectIcon project={item.project}/><span className="truncate">{item.project.name}</span></span>:null}
  {item.calendar?<span data-reference-calendar={item.calendar.id} title={item.calendar.name} className="inline-flex min-w-0 max-w-[65%] shrink items-center gap-1"><span aria-label="Calendar color" className="size-2 shrink-0 rounded-full" style={{backgroundColor:/^#[a-f0-9]{6}$/i.test(item.calendar.color)?item.calendar.color:undefined}}/><span className="truncate">{item.calendar.name}</span></span>:null}
  {detail?<><span aria-hidden="true" className={context?"shrink-0":"hidden"}>·</span><span className="min-w-0 flex-1 truncate" title={detail}>{detail}</span></>:null}
 </span>;
}
