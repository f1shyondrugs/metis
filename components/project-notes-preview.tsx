"use client";
import {StickyNote} from "lucide-react";
import {noteDisplayTitle} from "@/lib/notes-tree";

export const PROJECT_NOTES_PREVIEW_LIMIT=5;
export function ProjectNotesPreview({notes,onOpenNotes}:{notes:readonly {id:string;title:string;color?:string}[];onOpenNotes:(noteId?:string)=>void}){
 return <section className="grid min-w-0 gap-2 pb-10" data-slot="project-home-notes">
  <h3 className="text-sm font-medium">Notes</h3>
  {!notes.length?<button type="button" className="flex items-center gap-2 rounded-xl px-2 py-2 text-left text-sm text-muted-foreground hover:bg-muted/40" onClick={()=>onOpenNotes()}><StickyNote className="size-3.5"/>Open notes</button>:<>
   <ul className="grid min-w-0 gap-1 text-sm">
    {notes.slice(0,PROJECT_NOTES_PREVIEW_LIMIT).map(note=>{
     const title=noteDisplayTitle(note.title)||"Untitled note";
     return <li key={note.id} className="min-w-0"><button type="button" title={title} className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-muted/40" onClick={()=>onOpenNotes(note.id)}>
      <StickyNote className="size-3.5 shrink-0" style={{color:note.color||"#fef08a"}}/>
      <span className="min-w-0 flex-1 truncate">{title}</span>
     </button></li>;
    })}
   </ul>
   {notes.length>PROJECT_NOTES_PREVIEW_LIMIT?<button type="button" className="min-h-9 w-fit rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground" onClick={()=>onOpenNotes()}>View all notes ({notes.length})</button>:null}
  </>}
 </section>;
}
