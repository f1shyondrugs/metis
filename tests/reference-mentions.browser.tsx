import React,{useEffect,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {ReferencePicker} from "../components/reference-picker";
import {RichComposerInput} from "../components/rich-composer-input";
import {RichUserText} from "../components/rich-user-text";
import {NotesBlockEditor} from "../components/notes/block-editor";
import {useReferenceSearch} from "../components/use-reference-search";
import {composerMentionQuery,replaceComposerMention,composerReferenceKeyAction,type ComposerMentionQuery} from "../lib/composer-references";
import {resolveReferenceQuery,REFERENCE_SHORTCUTS} from "../lib/reference-query";
import {REFERENCE_KINDS,type ReferenceKind,type ReferenceResult} from "../lib/reference-search";
const requestLog:Array<{kind:string|null;q:string|null}>=[];
const originalFetch=window.fetch;
window.fetch=(input,init)=>{const value=String(input);if(value.startsWith("/api/references?")){const url=new URL(value,location.href);requestLog.push({kind:url.searchParams.get("kind"),q:url.searchParams.get("q")});}return originalFetch(input,init);};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check:()=>boolean,label:string){for(let n=0;n<200;n++){if(check())return;await sleep(40);}throw Error(label);}
function Fixture(){
 const [text,setText]=useState(""),[nonce,setNonce]=useState(0),[mention,setMention]=useState<ComposerMentionQuery|null>(null),[manual,setManual]=useState<ReferenceKind|null>(null),[search,setSearch]=useState<string|undefined>(),[index,setIndex]=useState(0),[selected,setSelected]=useState<ReferenceResult[]>([]),[report,setReport]=useState<string[]>([]),[note,setNote]=useState("");
 const input=useRef<HTMLTextAreaElement>(null),draft=useRef(""),eventLog=useRef<ReferenceResult[]>([]),requests=useRef(requestLog);
 const {kind,query}=resolveReferenceQuery(search??mention?.query??"",manual);
 const refs=useReferenceSearch({enabled:Boolean(mention&&(kind||query)),kind,query});
 useEffect(()=>{const listener=(event:Event)=>eventLog.current.push((event as CustomEvent).detail);window.addEventListener("ai-chat:open-reference",listener);return()=>window.removeEventListener("ai-chat:open-reference",listener);},[]);
 const choose=(item:ReferenceResult)=>{if(!mention)return;const result=replaceComposerMention(text,mention,item.label);if(!result)return;draft.current=result.value;setText(result.value);setNonce(n=>n+1);setSelected(items=>[...items.filter(old=>old.id!==item.id),item]);setMention(null);requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(result.cursor,result.cursor);});};
 const key=(event:React.KeyboardEvent)=>{if(!mention)return;const categories=!kind&&!query;const action=composerReferenceKeyAction({key:event.key,count:categories?9:refs.results.length,index});if(!action)return;event.preventDefault();if(action.type==="move")setIndex(action.index);else if(action.type==="dismiss")setMention(null);else if(categories){setManual(REFERENCE_KINDS[action.index]);setSearch("");}else choose(refs.results[action.index]);};
 const change=(value:string,cursor:number)=>{draft.current=value;setText(value);setMention(composerMentionQuery(value,cursor,cursor,selected.map(item=>item.label)));setSearch(undefined);setManual(null);setIndex(0);};
 async function run(){
 const results:string[]=[];const check=(label:string,ok:boolean)=>{if(!ok)throw Error(label);results.push("PASS "+label);setReport([...results]);};
 const type=(value:string)=>{const element=input.current!;element.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(element,value);element.setSelectionRange(value.length,value.length);element.dispatchEvent(new Event("input",{bubbles:true}));};
 try{
 for(const k of REFERENCE_KINDS){type("@"+REFERENCE_SHORTCUTS[k]);await wait(()=>document.querySelector("[data-picker]")?.getAttribute("data-kind")===k&&document.querySelector("[data-picker] [aria-busy]")?.getAttribute("aria-busy")==="false"&&requests.current.some(req=>req.kind===k&&req.q===""),"Scoped "+k);check("Shortcut filters "+k,requests.current.some(req=>req.kind===k&&req.q===""));}
 type("@chats");await wait(()=>Boolean(document.querySelector("[data-picker] [aria-label='Search chats']")),"Chat field");
 const popupInput=document.querySelector<HTMLInputElement>("[data-picker] input")!;
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(popupInput,"Mathe");
 popupInput.dispatchEvent(new Event("input",{bubbles:true}));
 await wait(()=>document.querySelector("[data-picker]")?.getAttribute("data-kind")==="chat"&&document.querySelector("[data-picker]")?.getAttribute("data-query")==="Mathe","Scoped popup search");
 check("Typing into popup retains shortcut category",true);
 (document.querySelector("[data-picker] [aria-label='All categories']") as HTMLButtonElement).click();
 await wait(()=>document.querySelectorAll("[data-picker] [role=option]").length===9,"Back categories");
 check("Back clears shortcut scope",true);
 type("@chats:Mathe");await wait(()=>document.querySelector("[data-picker]")?.getAttribute("data-query")==="Mathe"&&Boolean(document.querySelector("[data-picker] [role=option]")),"Filtered chat");
 check("Colon query only reaches chat search",requests.current.some(req=>req.kind==="chat"&&req.q==="Mathe"));
 input.current!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
 await wait(()=>input.current?.value.includes("@Mathe course")===true&&!document.querySelector("[data-picker]"),"Selected replacement");
 check("Enter replaces prefix without leftovers",input.current!.value==="@Mathe course ");
 const chatLink=document.querySelector<HTMLAnchorElement>("[data-sent] a")!;
 check("Saved mention is an icon link with dotted underline",chatLink.tagName==="A"&&getComputedStyle(chatLink).textDecorationStyle==="dotted"&&Boolean(chatLink.querySelector("[data-link-icon-kind=chat]")));
 chatLink.focus();await wait(()=>Boolean(document.querySelector("[role=tooltip] [data-reference-preview=chat]")),"Focus preview");
 check("Keyboard focus opens reference tooltip",chatLink.hasAttribute("aria-describedby"));
 const tooltip=document.querySelector<HTMLElement>("[role=tooltip]")!,rect=tooltip.getBoundingClientRect();
 check("Tooltip fits viewport",rect.left>=0&&rect.right<=innerWidth+1);
 chatLink.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await wait(()=>!document.querySelector("[role=tooltip]"),"Escape");
 check("Escape dismisses tooltip",true);chatLink.click();check("Click routes saved chat identity",eventLog.current.at(-1)?.kind==="chat"&&eventLog.current.at(-1)?.id===chatLink.getAttribute("href")?.split("=")[1]);
 const modified=new MouseEvent("click",{bubbles:true,cancelable:true,ctrlKey:true});chatLink.addEventListener("click",event=>{if(event.ctrlKey)event.preventDefault();},{once:true});const count=eventLog.current.length;chatLink.dispatchEvent(modified);
 check("Ctrl-click keeps native chat link semantics",eventLog.current.length===count&&chatLink.getAttribute("href")?.startsWith("/?c=")===true);
 type("@notes:Exam");await wait(()=>Boolean(document.querySelector("[data-picker] [role=option]"))&&document.querySelector("[data-picker]")?.getAttribute("data-query")==="Exam","Notes results");
 (document.querySelector("[data-picker] [role=option]") as HTMLButtonElement).click();
 await wait(()=>Boolean(document.querySelector("[data-sent] [data-reference-kind=note]")),"Note selected");
 const noteLink=document.querySelector<HTMLAnchorElement>("[data-sent] [data-reference-kind=note]")!;
 noteLink.focus();await wait(()=>document.querySelector("[role=tooltip]")?.textContent?.includes("Exam preparation content")===true,"Live document preview");
 check("Note tooltip loads authenticated document preview",true);noteLink.click();
 check("Note click routes selected identity",eventLog.current.at(-1)?.kind==="note");
 const editor=document.querySelector<HTMLElement>(".notes-prosemirror")!;editor.focus();document.execCommand("insertText",false,"@chats:Mathe");
 await wait(()=>Boolean(document.querySelector(".notes-reference-popover [aria-label='Search chats']"))&&Boolean(document.querySelector(".notes-reference-popover [role=option]")),"Notes category shortcut");
 check("Real Notes editor scopes @chats: query",true);
 (document.querySelector(".notes-reference-popover [role=option]") as HTMLButtonElement).click();
 await wait(()=>Boolean(editor.querySelector("a[href^='metis://reference/chat/']")),"Notes link inserted");
 check("Notes replaces entire scoped mention with saved link",!editor.textContent?.includes("@chats:")&&editor.textContent?.includes("Mathe course")===true);
 setReport([...results,"COMPLETE"]);await fetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,passed:true,results})});
 }catch(error){const failed=[...results,"FAIL "+String(error)];setReport(failed);await fetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,passed:false,results:failed})});}
 }
 return <main className="mx-auto max-w-3xl space-y-4 p-4 text-foreground"><h1 className="font-semibold">Category shortcuts and reference links</h1><p className="text-xs text-muted-foreground">Synthetic browser fixture · {innerWidth}px</p>
 <section className="rounded-lg border border-border p-3"><RichComposerInput ref={input} value={text} syncNonce={nonce} onChange={change} onSelectionChange={(value,start,end)=>{if(value===draft.current)setMention(composerMentionQuery(value,start,end,selected.map(item=>item.label)));}} mentionLabels={selected.map(item=>item.label)} onKeyDown={key} aria-label="Message"/>
 {mention?<div data-picker data-kind={kind??""} data-query={query} className="mt-2 bg-popover p-1.5"><ReferencePicker id="fixture" kind={kind} query={query} results={refs.results} loading={refs.loading} indexing={refs.indexing} error={refs.error} retry={refs.retry} index={index} onIndex={setIndex} onCategory={value=>{setManual(value);setSearch("");}} onQuery={value=>{setManual(kind);setSearch(value);}} onKeyDown={key} onSelect={choose}/></div>:null}</section>
 <section data-sent className="rounded-lg border border-border p-3 leading-7"><h2 className="mb-2 text-xs text-muted-foreground">Sent references</h2><RichUserText content={selected.map(item=>"@"+item.label).join(" · ")} references={selected}/></section>
 <section><h2 className="text-sm">Notes editor</h2><NotesBlockEditor value={note} onChange={setNote} noteId="fixture-editor"/></section>
 <button className="min-h-11 rounded-lg border border-border px-3" onClick={()=>void run()}>Run browser checks</button><pre className="whitespace-pre-wrap text-xs">{report.join("\n")}</pre></main>;
}
document.documentElement.classList.add("dark");document.body.className="bg-background";
createRoot(document.getElementById("root")!).render(<Fixture/>);
