"use client";
import { useEffect, useState } from "react";
import { SpellCheck } from "lucide-react";
import { NOTES_SPELLCHECK_CHOICES, notesSpellcheckChoice, type NotesSpellcheckChoice } from "@/lib/notes-spellcheck";
import { DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
export function useNotesSpellcheck(ownerId?: string | null) {
  const key = ownerId ? "metis:notes:spellcheck:" + ownerId : "";
  const [state,setState] = useState<{key:string;value:NotesSpellcheckChoice}>({key:"",value:"auto"});
  useEffect(() => {
    const read = () => { try {setState({key,value:notesSpellcheckChoice(localStorage.getItem(key))});} catch {setState({key,value:"auto"});} };
    if(!key)return; read();
    const listener = (event:StorageEvent) => {if(event.key===key||event.key===null)read();};
    const changed=(event:Event)=>{const detail=(event as CustomEvent<{key:string;value:unknown}>).detail;if(detail?.key===key)setState({key,value:notesSpellcheckChoice(detail.value)});};
    window.addEventListener("storage",listener);window.addEventListener("metis:spellcheck-changed",changed);
    return()=>{window.removeEventListener("storage",listener);window.removeEventListener("metis:spellcheck-changed",changed);};
  },[key]);
  const value = state.key === key ? state.value : "auto";
  return [value,(next:NotesSpellcheckChoice)=>{setState({key,value:next});try{if(key)localStorage.setItem(key,next);}catch{/* Session selection remains usable. */}if(key)window.dispatchEvent(new CustomEvent("metis:spellcheck-changed",{detail:{key,value:next}}));}] as const;
}
export function NotesSpellcheckMenu({value,onChange}:{value:NotesSpellcheckChoice;onChange:(value:NotesSpellcheckChoice)=>void}) {
  return <DropdownMenuSub><DropdownMenuSubTrigger className="min-h-11 sm:min-h-8"><SpellCheck className="size-4"/>Spellcheck</DropdownMenuSubTrigger>
    <DropdownMenuSubContent className="max-h-[70dvh] overflow-y-auto"><DropdownMenuRadioGroup value={value} onValueChange={next=>onChange(notesSpellcheckChoice(next))}>
      {NOTES_SPELLCHECK_CHOICES.map(([id,label])=><DropdownMenuRadioItem key={id} value={id} className="min-h-11 sm:min-h-8">{label}</DropdownMenuRadioItem>)}
    </DropdownMenuRadioGroup><p className="max-w-52 px-3 py-2 text-xs text-muted-foreground">Uses your browser’s installed dictionaries.</p></DropdownMenuSubContent>
  </DropdownMenuSub>;
}
