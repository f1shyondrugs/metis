import React,{useState} from "react";import {createRoot} from "react-dom/client";
import {DocumentConvertItems,DocumentConversionDialog} from "../components/document-conversion";
import {NotesSpellcheckMenu,useNotesSpellcheck} from "../components/notes/spellcheck-menu";
import {NotesBlockEditor} from "../components/notes/block-editor";
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent} from "../components/ui/dropdown-menu";
import {applyAppearanceTheme,createDefaultAppearanceState,getSelectedTheme} from "../lib/appearance-storage";
import type {ConversionSource,ConvertedDocument,DocumentKind} from "../lib/document-conversion-types";
const root=createRoot(document.getElementById("root")!);
const fixture=await(await fetch("/api/fixture")).json();
const results:string[]=[];const converted:ConvertedDocument[]=[];
const wait=(ms=80)=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(ok:unknown,label:string)=>results.push((ok?"PASS ":"FAIL ")+label);
const originalFetch=fetch.bind(window);let failOnce=false,dropOnce=false,delayResponse=false;
window.fetch=async(input,init)=>{if(String(input)==="/api/documents/convert"&&failOnce){failOnce=false;return Response.json({error:"Synthetic save failure"},{status:503});}const response=await originalFetch(input,init);if(String(input)==="/api/documents/convert"&&delayResponse){delayResponse=false;await wait(350);}if(String(input)==="/api/documents/convert"&&dropOnce){dropOnce=false;throw Error("Synthetic lost reply");}return response;};
function Surface({kind}:{kind:DocumentKind}){
 const [value,setValue]=useState("# Editable document\n\nKeep this text."),[target,setTarget]=useState<DocumentKind|null>(null);
 const [choice,setChoice]=useNotesSpellcheck(fixture.owner);
 const source:ConversionSource={kind,id:kind==="note"?fixture.noteId:kind+"-source",chatId:kind==="note"?undefined:fixture.chatId,version:1,title:kind+" original",content:value};
 return <section className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4" data-surface-kind={kind}>
  <header className="flex items-center gap-2"><h1 className="flex-1 text-lg font-semibold">{kind==="note"?"Note":kind==="canvas"?"Canvas":"Plan"} document</h1>
  <DropdownMenu><DropdownMenuTrigger className="size-11 rounded-md border" aria-label="Document actions">···</DropdownMenuTrigger><DropdownMenuContent align="end">
   <NotesSpellcheckMenu value={choice} onChange={setChoice}/><DocumentConvertItems kind={kind} onChoose={setTarget}/>
  </DropdownMenuContent></DropdownMenu></header>
  <input aria-label="Document title" defaultValue={source.title} spellCheck={choice!=="off"} lang={choice!=="auto"&&choice!=="off"?choice:undefined} className="min-h-11 rounded-md border p-2"/>
  <NotesBlockEditor value={value} onChange={setValue} spellcheckChoice={choice} aria-label="Document body"/>
  {target?<DocumentConversionDialog source={source} target={target} onClose={()=>setTarget(null)} onConverted={result=>{converted.push(result);}}/>:null}
 </section>;
}
function Companion(){const[value]=useNotesSpellcheck(fixture.owner);return <output data-companion-choice={value}/>;}
async function mount(kind:DocumentKind){root.render(<><Surface key={kind} kind={kind}/><Companion/></>);await wait(250);for(let i=0;i<100&&!document.querySelector(".ProseMirror");i++)await wait(20);}
function control(text:string){return [...document.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemradio"],button')].find(el=>el.textContent?.trim()===text);}
async function press(el:HTMLElement|undefined|null){if(!el)throw Error("Missing control; visible buttons: "+[...document.querySelectorAll("button")].map(e=>e.textContent).join(", "));el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,pointerType:"mouse"}));el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,button:0,pointerType:"mouse"}));el.click();await wait(260);}
async function menu(sub:string){await wait(220);await press(document.querySelector<HTMLElement>('[aria-label="Document actions"]'));await press(control(sub));await wait(120);}
async function chooseTarget(kind:DocumentKind,target:DocumentKind){
 await menu("Convert to");
 check([...document.querySelectorAll('[role="menuitem"]')].filter(el=>["Canvas","Plan","Note"].includes(el.textContent?.trim()||"")).length===2,"only other document types offered from "+kind);
 await press(control(target==="note"?"Note":target==="plan"?"Plan":"Canvas"));
 check(!!document.querySelector('[role="dialog"]')&&document.querySelector('[role="dialog"]')!.textContent?.includes("original"),"conversion dialog discloses original preservation");
}
async function run(){
 localStorage.removeItem("metis:notes:spellcheck:"+fixture.owner);applyAppearanceTheme(document.documentElement,getSelectedTheme(createDefaultAppearanceState()),"midnight");
 for(const kind of ["canvas","plan","note"] as const){
  await mount(kind);
  await menu("Spellcheck");await press(control("Off"));
  check(document.querySelector(".ProseMirror")?.getAttribute("spellcheck")==="false"&&document.querySelector<HTMLInputElement>('input[aria-label="Document title"]')?.spellcheck===false,"Off applies to real editor and title: "+kind);
  check(document.querySelector("output")?.getAttribute("data-companion-choice")==="off","same-tab sibling preference synchronizes: "+kind);
  await menu("Spellcheck");await press(control("German"));
  check(document.querySelector(".ProseMirror")?.getAttribute("spellcheck")==="true"&&document.querySelector(".ProseMirror")?.getAttribute("lang")==="de-DE","German applies to actual editor: "+kind);
  for(const target of (["canvas","plan","note"] as const).filter(t=>t!==kind)){
   const count=converted.length;await chooseTarget(kind,target);
   await press(control("Convert to "+(target==="note"?"Note":target==="plan"?"Plan":"Canvas")));
   for(let i=0;i<100&&converted.length===count;i++)await wait(20);
   check(converted.length===count+1&&converted.at(-1)?.kind===target,"real authenticated API conversion "+kind+" to "+target);
   check((converted.at(-1)?.note||converted.at(-1)?.workspace)?.content==="# Editable document\n\nKeep this text.","Markdown retained for "+kind+" to "+target);
  }
 }
 await mount("canvas");await chooseTarget("canvas","note");failOnce=true;
 const count=converted.length;await press(control("Convert to Note"));check(!!document.querySelector('[role="alert"]')&&!!document.querySelector('[role="dialog"]')&&converted.length===count,"failed conversion stays open without success or data loss");
 await press(control("Retry conversion"));for(let i=0;i<100&&converted.length===count;i++)await wait(20);
 check(converted.length===count+1&&!document.querySelector('[role="dialog"]'),"explicit retry succeeds");
 await chooseTarget("canvas","note");dropOnce=true;await press(control("Convert to Note"));await press(control("Retry conversion"));await wait(120);
 check(converted.length===count+2,"lost response retry returns one persisted converted copy");
 await menu("Spellcheck");await press(control("Off"));await mount("plan");
 check(document.querySelector(".ProseMirror")?.getAttribute("spellcheck")==="false","spellcheck persists across document switches");
 await menu("Spellcheck");await press(control("Browser default"));
 check(document.querySelector(".ProseMirror")?.getAttribute("spellcheck")==="true"&&!document.querySelector(".ProseMirror")?.getAttribute("lang"),"Browser default removes language override");
 await chooseTarget("plan","canvas");
 const beforeLeaving=converted.length;delayResponse=true;control("Convert to Canvas")!.click();await wait(30);root.render(<div/>);await wait(500);
 check(converted.length===beforeLeaving&&!document.querySelector('[role="dialog"]'),"late conversion result cannot reopen a document after navigation");
 await mount("plan");await chooseTarget("plan","canvas");
 check(document.documentElement.scrollWidth<=innerWidth+1,"responsive actions and dialog do not overflow");
 const report={width:innerWidth,results};await originalFetch("/report",{method:"POST",body:JSON.stringify(report)});
 const pre=document.createElement("pre");pre.hidden=true;pre.textContent=JSON.stringify(report);document.body.append(pre);
}
void run().catch(async error=>{check(false,String(error));await originalFetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,results,error:String(error)})});});
