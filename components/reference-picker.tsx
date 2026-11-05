"use client";

import type { KeyboardEvent, ReactNode, Ref } from "react";
import { ArrowLeft, Brain, ClipboardList, File as FileIcon, MessageSquare, Palette, PanelRight, Search, StickyNote, Terminal } from "lucide-react";
import { REFERENCE_KINDS, type ReferenceKind, type ReferenceResult } from "@/lib/reference-search";
import { cn } from "@/lib/utils";

export const referenceLabel = (kind: ReferenceKind) => ({
  file:"Files",canvas:"Canvases",plan:"Plans",note:"Notes",issue:"Issues",browser:"Browser",terminal:"Terminals",memory:"Memories",chat:"Chats",
})[kind];
export const referenceIcon = (kind: ReferenceKind) => ({
  file:FileIcon,canvas:Palette,plan:ClipboardList,note:StickyNote,issue:ClipboardList,browser:PanelRight,terminal:Terminal,memory:Brain,chat:MessageSquare,
})[kind];

export function ReferencePicker({ id, rootRef, inputRef, kind, query, results, loading, indexing, notice, error, retry,
  index, onIndex, onCategory, onQuery, onSelect, onKeyDown, optionIdPrefix = id, prefix, prefixCount = 0,
}: {
  id:string;optionIdPrefix?:string;rootRef?:Ref<HTMLDivElement>;inputRef?:Ref<HTMLInputElement>;kind:ReferenceKind|null;query:string;results:readonly ReferenceResult[];
  loading:boolean;indexing:boolean;notice?:string;error?:string;retry:()=>void;index:number;
  onIndex:(index:number)=>void;onCategory:(kind:ReferenceKind|null)=>void;onQuery:(query:string)=>void;onSelect:(item:ReferenceResult)=>void;
  onKeyDown:(event:KeyboardEvent<HTMLInputElement>)=>void;prefix?:ReactNode;prefixCount?:number;
}) {
  const categories=!kind&&!query.trim();
  const count=(categories?REFERENCE_KINDS.length:results.length)+prefixCount;
  return <div ref={rootRef} className="reference-picker text-sm">
    <div className="sticky top-0 z-10 -mx-1.5 -mt-1.5 mb-1 flex items-center gap-1 border-b border-border/50 bg-popover px-2 py-1.5">
      {!categories ? <button type="button" aria-label="All categories" title="All categories" className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        onMouseDown={event=>event.preventDefault()} onClick={()=>onCategory(null)}><ArrowLeft className="size-4"/></button>
        : <Search className="mx-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>}
      <input ref={inputRef} type="search" role="combobox" aria-expanded={true}
        aria-label={kind?"Search "+referenceLabel(kind).toLowerCase():"Search context"} placeholder={kind?"Search "+referenceLabel(kind).toLowerCase()+"…":"Search context…"}
        value={query} aria-autocomplete="list" aria-controls={id}
        aria-activedescendant={index>=0&&index<count?optionIdPrefix+"-option-"+index:undefined}
        className="h-9 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        onKeyDown={onKeyDown} onChange={event=>onQuery(event.target.value)}/>
      {kind?<span className="pr-1 text-[11px] text-muted-foreground">{referenceLabel(kind)}</span>:null}
    </div>
    <div id={id} role="listbox" aria-label="Context references" aria-busy={loading}>
      {prefix}
      {categories ? <div className="flex flex-col gap-0.5">{REFERENCE_KINDS.map((category,position)=>{
        const Icon=referenceIcon(category),selected=position+prefixCount===index;
        return <button key={category} id={optionIdPrefix+"-option-"+(position+prefixCount)} role="option" aria-selected={selected} type="button"
          aria-label={referenceLabel(category)} title={referenceLabel(category)} onMouseEnter={()=>onIndex(position+prefixCount)}
          className={cn("flex min-h-9 max-sm:min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-muted-foreground hover:bg-muted hover:text-foreground",selected&&"bg-muted text-foreground")}
          onMouseDown={event=>event.preventDefault()} onClick={()=>onCategory(category)}><Icon className="size-4" aria-hidden="true"/><span className="text-xs">{referenceLabel(category)}</span></button>;
      })}</div> : loading ? <p role="status" className="px-2.5 py-4 text-center text-xs text-muted-foreground">Searching…</p>
        : error ? <div role="alert" className="px-2.5 py-3 text-xs"><p>{error}</p><button type="button" className="mt-2 underline underline-offset-2" onMouseDown={event=>event.preventDefault()} onClick={retry}>Try again</button></div>
        : results.length ? results.map((item,position)=>{
          const Icon=referenceIcon(item.kind),selected=position+prefixCount===index;
          return <button key={[item.kind,item.id,item.chatId||""].join(":")} type="button" id={optionIdPrefix+"-option-"+(position+prefixCount)} role="option" aria-selected={selected}
            className={cn("flex min-h-9 max-sm:min-h-11 w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left",selected?"bg-muted":"hover:bg-muted/60")}
            onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>onIndex(position+prefixCount)} onClick={()=>onSelect(item)}>
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
            <span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-1.5"><span className="min-w-0 truncate text-xs text-foreground">{item.label}</span>
              {item.isCurrentChat?<span className="shrink-0 rounded bg-secondary px-1.5 text-[10px] text-secondary-foreground">In this chat</span>:null}</span>
              {item.detail?<span className="block truncate text-[11px] text-muted-foreground">{item.detail}</span>:null}
            </span>
          </button>;
        }) : prefixCount ? null : <p role="status" className="px-2.5 py-4 text-center text-xs text-muted-foreground">{indexing?"Preparing more results…":query?"No matching references.":"No "+referenceLabel(kind||"file").toLowerCase()+" available."}</p>}
    </div>
    {indexing&&results.length>0?<p role="status" className="px-2.5 py-2 text-xs text-muted-foreground">Preparing more results…</p>:null}
    {notice?<p role="status" className="px-2.5 py-2 text-xs text-muted-foreground">{notice} <button type="button" className="underline" onMouseDown={event=>event.preventDefault()} onClick={retry}>Try again</button></p>:null}
  </div>;
}
