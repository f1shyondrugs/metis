import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {ReferencePicker,referenceLabel} from "../components/reference-picker";
import {ProjectNotesPreview} from "../components/project-notes-preview";
import {useReferenceSearch} from "../components/use-reference-search";
import {REFERENCE_KINDS,type ReferenceKind,type ReferenceResult} from "../lib/reference-search";
declare global{interface Window{createNotesNavigationHarness:()=>{open:(noteId?:string)=>{notesOpen:boolean;focusedNoteId:string|null;url:string;projectHomeId:string};};runChecks:()=>Promise<void>;}}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check:()=>boolean,label:string){for(let i=0;i<200;i++){if(check())return;await sleep(50);}throw Error(label);}
function Fixture(){
 const [kind,setKind]=useState<ReferenceKind|null>(null),[query,setQuery]=useState(""),[index,setIndex]=useState(0),[notes,setNotes]=useState<Array<{id:string;title:string;color?:string}>>([]),[opened,setOpened]=useState(""),[report,setReport]=useState<string[]>([]);
 const refs=useReferenceSearch<ReferenceResult>({enabled:Boolean(kind||query.trim()),chatId:"",kind,query});
 useEffect(()=>{fetch("/fixture-data").then(response=>response.json()).then(data=>setNotes(data.notes));},[]);
 const choose=(next:ReferenceKind|null)=>{setKind(next);setQuery("");setIndex(0);};
 function open(noteId?:string){const result=window.createNotesNavigationHarness().open(noteId);if(!result.notesOpen||result.url!=="/?c=notes")throw Error("Project route bounced back");setOpened(result.focusedNoteId??"all-notes");}
 useEffect(()=>{
  window.runChecks=async()=>{
   const results:string[]=[];const check=(label:string,condition:boolean)=>{if(!condition)throw Error(label);results.push("PASS "+label);setReport([...results]);};
   try{
    await wait(()=>notes.length===9,"Notes fixture loaded");
    const category=(value:string)=>document.querySelector<HTMLButtonElement>('[data-fixture-picker] button[aria-label="'+value+'"]');
    const back=()=>document.querySelector<HTMLButtonElement>('[data-fixture-picker] button[aria-label="All categories"]')?.click();
    function search(value:string){const input=document.querySelector<HTMLInputElement>('[data-fixture-picker] input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));}
    const options=()=>[...document.querySelectorAll<HTMLElement>('[data-fixture-picker] [role="option"]')];
    const ready=(expectedKind:string,expectedQuery="")=>()=>{
     const root=document.querySelector<HTMLElement>("[data-fixture-picker]");
     return root?.dataset.kind===expectedKind&&root.dataset.query===expectedQuery&&root.querySelector("[aria-busy]")?.getAttribute("aria-busy")==="false"&&options().length>0;
    };
    check("Nine reference categories",options().length===9);
    for(const categoryKind of REFERENCE_KINDS){category(referenceLabel(categoryKind))!.click();await wait(ready(categoryKind),"Results for "+categoryKind);check("Searchable category "+categoryKind,options().length>0);back();await wait(()=>Boolean(category("Chats")),"Back to categories");}
    category("Chats")!.click();await wait(ready("chat"),"Chats");search("bodyonlyneedle");await wait(()=>ready("chat","bodyonlyneedle")()&&options().length===1&&options()[0].textContent?.includes("Unrelated conversation")===true,"Message-only search");
    check("Message-only matches deduplicated to one conversation",options().length===1);
    back();await wait(()=>Boolean(category("Notes")),"Categories");category("Notes")!.click();await wait(ready("note"),"Notes");search("tailnoteneedle");await wait(()=>ready("note","tailnoteneedle")()&&options().some(row=>row.textContent?.includes("Long note")),"Full note search");check("Note content beyond 6000 characters found",true);
    for(const [label,needle,expected]of [["Plans","tailplanneedle","Long plan"],["Canvases","tailcanvasneedle","Long canvas"]]){
     back();await wait(()=>Boolean(category(label)),"Categories");category(label)!.click();await wait(ready(label==="Plans"?"plan":"canvas"),label);search(needle);await wait(()=>ready(label==="Plans"?"plan":"canvas",needle)()&&options().some(row=>row.textContent?.includes(expected)),label+" full text");check(label+" full content found",true);
    }
    const preview=document.querySelector('[data-slot="project-home-notes"]')!;
    check("Project notes preview limited to five",preview.querySelectorAll("li").length===5);
    const all=[...preview.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent?.includes("View all notes (9)"));check("All nine notes remain reachable",Boolean(all));
    const title=preview.querySelector<HTMLElement>("li:nth-child(2) span")!;
    check("Long title is visually truncated",title.scrollWidth>title.clientWidth);
    check("Preview stays within viewport",preview.getBoundingClientRect().right<=window.innerWidth+1);
    (preview.querySelector("li button") as HTMLButtonElement).click();await wait(()=>document.querySelector("[data-opened-note]")?.textContent?.includes(notes[0].id)===true,"Direct note navigation");
    check("Actual hub callback opens the selected note and survives route reconciliation",true);
    all!.click();await wait(()=>document.querySelector("[data-opened-note]")?.textContent?.includes("all-notes")===true,"All notes navigation");check("View all opens the project notebook",true);
    setReport([...results,"COMPLETE"]);
    await fetch("/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({width:window.innerWidth,results,passed:true})});
   }catch(error){const failed=[...results,"FAIL "+(error instanceof Error?error.message:String(error))];setReport(failed);await fetch("/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({width:window.innerWidth,results:failed,passed:false})});}
  };
 },[notes]);
 return <main className="mx-auto grid max-w-3xl gap-5 p-4 text-foreground"><header><h1 className="text-lg font-semibold">References and project notes</h1><p className="text-xs text-muted-foreground">Synthetic test workspace · {window.innerWidth}px</p><p data-result-status className="mt-2 text-xs">{report.at(-1)==="COMPLETE"?"Checks complete":""}</p></header>
 <section data-fixture-picker data-kind={kind??""} data-query={query} className="rounded-xl border border-border bg-popover p-1.5"><ReferencePicker id="reference-fixture" kind={kind} query={query} results={refs.results} loading={refs.loading} indexing={refs.indexing} notice={refs.notice} error={refs.error} retry={refs.retry} index={index} onIndex={setIndex} onCategory={choose} onQuery={setQuery} onSelect={item=>setOpened(item.id)} onKeyDown={()=>{}}/></section>
 <section className="min-w-0 rounded-xl border border-border p-4"><h2 className="mb-4 font-medium">Project Hub</h2><ProjectNotesPreview notes={notes} onOpenNotes={open}/><p data-opened-note className="break-all text-xs text-muted-foreground">{opened?"Opened: "+opened:"Select a note to open it directly."}</p></section>
 <button className="min-h-11 rounded-lg border border-border px-3 text-sm" onClick={()=>void window.runChecks()}>Run browser checks</button>
 <pre data-report className="whitespace-pre-wrap break-words text-xs">{report.join("\n")}</pre></main>;
}
document.documentElement.classList.add("dark");document.body.className="bg-background";
createRoot(document.getElementById("root")!).render(<Fixture/>);
