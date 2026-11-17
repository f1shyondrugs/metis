import React,{useEffect,useRef,useState} from "react";import{createRoot}from"react-dom/client";
import{ReferencePicker}from"../components/reference-picker";import{RichComposerInput}from"../components/rich-composer-input";import{RichUserText}from"../components/rich-user-text";import{NotesBlockEditor}from"../components/notes/block-editor";import{useReferenceSearch}from"../components/use-reference-search";
import{CalendarPanel}from"../components/calendar/calendar-panel";import{ToolCallPreview}from"../components/tool-call-preview";import{Markdown}from"../components/markdown";import{CalendarEventCard}from"../components/calendar/calendar-event-card";import{PublicMarkdownContext}from"../components/public-markdown-context";
import{resolveReferenceQuery}from"../lib/reference-query";import{REFERENCE_KINDS,type ReferenceKind,type ReferenceResult}from"../lib/reference-search";
import{composerMentionQuery,replaceComposerMention,type ComposerMentionQuery}from"../lib/composer-references";
type Navigation={state:{snapshots:number;accountView:unknown};calendarOpen:boolean;openEvent:(id:string)=>void};
type Meta={event:{id:string;title:string};series:{id:string;title:string}};
const pause=(n=100)=>new Promise(r=>setTimeout(r,n));async function until(test:()=>boolean,label:string){for(let i=0;i<200;i++){if(test())return;await pause(40);}throw Error(label);}
function fill(input:HTMLInputElement|HTMLTextAreaElement,value:string){Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));}
export function runCalendarEventFixture(createNavigation:(window:Window)=>Navigation){
 const navigation=createNavigation(window);
 function Fixture(){
  const[text,setText]=useState(""),[nonce,setNonce]=useState(0),[query,setQuery]=useState(""),[kind,setKind]=useState<ReferenceKind|null>(null),[mention,setMention]=useState<ComposerMentionQuery|null>(null),[selected,setSelected]=useState<ReferenceResult[]>([]),[note,setNote]=useState(""),[meta,setMeta]=useState<Meta|null>(null),[results,setResults]=useState<string[]>([]),[publicCard,setPublicCard]=useState(false);
  const input=useRef<HTMLTextAreaElement>(null),events=useRef<string[]>([]);
  const search=useReferenceSearch({enabled:!!mention&&(!!kind||!!query),kind,query});
  useEffect(()=>{fetch("/fixture").then(r=>r.json()).then(setMeta);const event=(e:Event)=>{const id=(e as CustomEvent).detail?.id;if(typeof id==="string"){events.current.push(id);navigation.openEvent(id);}};const ref=(e:Event)=>{if((e as CustomEvent).detail?.kind==="calendar-event")event(e);};window.addEventListener("ai-chat:open-calendar-event",event);window.addEventListener("ai-chat:open-reference",ref);return()=>{window.removeEventListener("ai-chat:open-calendar-event",event);window.removeEventListener("ai-chat:open-reference",ref);};},[]);
  const choose=(item:ReferenceResult)=>{if(!mention)return;const next=replaceComposerMention(text,mention,item.label);if(!next)return;setSelected([item]);setText(next.value);setNonce(v=>v+1);setMention(null);};
  async function run(){
   const report:string[]=[];const check=(condition:unknown,label:string)=>{if(!condition)throw Error(label);report.push("PASS "+label);setResults([...report]);};
   try{
    await until(()=>!!meta&&!!input.current,"fixture ready");
    fill(input.current!,"@");await until(()=>document.querySelectorAll("[data-picker] [role=option]").length===REFERENCE_KINDS.length,"categories");
    check(!!document.querySelector('[data-picker] [aria-label="Calendar events"]'),"Add/context picker exposes Calendar events");
    (document.querySelector('[data-picker] [aria-label="Calendar events"]') as HTMLElement).click();
    await until(()=>!!document.querySelector('[data-picker] [aria-label="Search calendar events"]')&&search.results.length!==-1,"category selected");
    await until(()=>document.querySelector("[data-picker]")?.textContent?.includes("Project planning")===true,"real search result");
    check(document.querySelector("[data-picker]")?.textContent?.includes("Synthetic work"),"owner-scoped API search returns calendar context");
    ([...document.querySelectorAll<HTMLElement>("[data-picker] [role=option]")].find(e=>e.textContent?.includes("Project planning"))!).click();await until(()=>!!document.querySelector("[data-sent] a"),"selected mention");
    check(input.current?.value.startsWith("@")&&!document.querySelector("[data-picker]"),"selection inserts a saved event mention without leftover category");
    const link=document.querySelector<HTMLAnchorElement>("[data-sent] a")!;link.focus();
    await until(()=>!!document.querySelector('[data-internal-preview="calendar-event"] [aria-label="Calendar color"]'),"live hover");
    check(document.querySelector("[data-hover-preview]")?.textContent?.includes("Meeting room")||document.querySelector("[data-hover-preview]")?.textContent?.includes("Online"),"hover loads authoritative event details");
    const color=document.querySelector<HTMLElement>('[data-internal-preview] [aria-label="Calendar color"]')!;
    check(getComputedStyle(color).backgroundColor==="rgb(18, 164, 86)","hover shows the actual calendar color");
    link.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));link.blur();await pause();
    link.click();await until(()=>!!document.querySelector(".metis-calendar-selected-event"),"highlighted occurrence");
    check(navigation.calendarOpen&&location.search.includes("c=calendar")&&location.hash.startsWith("#event-"),"real AppShell event handler navigates to the calendar URL");
    check(navigation.state.snapshots>0,"calendar navigation preserves the active chat snapshot");
    check(document.querySelector(".metis-calendar-selected-event")?.textContent?.includes("Project planning"),"linked single event is highlighted");
    const md=document.querySelector<HTMLAnchorElement>("[data-agent-link] a")!;md.click();await until(()=>document.querySelector(".metis-calendar-selected-event")?.textContent?.includes("Weekly review")===true,"series focus");
    const params=new URLSearchParams({reference:meta!.series.id,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}),reference=await(await fetch("/api/calendar?"+params)).json();
    check(document.querySelector(".metis-calendar-selected-event")?.closest("[data-date]")?.getAttribute("data-date")===reference.occurrence.start.slice(0,10),"recurring link highlights the next occurrence from today, not the old anchor");
    check(document.body.textContent?.includes("Next occurrence from today"),"series selection is identified visibly");
    await until(()=>document.querySelector("[data-tool-card]")?.textContent?.includes("Project planning")===true,"automatic tool card");
    check(!!document.querySelector("[data-tool-card] [data-calendar-event-card]"),"successful create tool renders a real inline event card");
    check(!document.querySelector("[data-failed-card] [data-calendar-event-card]"),"failed create tool does not claim a saved event");
    check(!!document.querySelector("[data-explicit-card] [data-calendar-event-card]"),"calendar-event Markdown fence renders an embed");
    document.querySelector("[data-deferred-card]")?.scrollIntoView();await until(()=>!!document.querySelector("[data-deferred-card] [data-calendar-event-card]"),"deferred card");check(true,"truncated saved tool results resolve their event identity lazily");
    const card=document.querySelector<HTMLElement>("[data-tool-card] [data-calendar-event-card]")!;
    check(getComputedStyle(card).borderLeftColor==="rgb(18, 164, 86)","event card uses calendar color");
    const editor=document.querySelector<HTMLElement>(".notes-prosemirror")!;editor.focus();document.execCommand("insertText",false,"@events Project");
    await until(()=>!!document.querySelector(".notes-reference-popover [role=option]"),"notes search");
    (document.querySelector(".notes-reference-popover [role=option]") as HTMLElement).click();await until(()=>!!editor.querySelector('a[href^="calendar-event://"]'),"notes selection");
    check(true,"shared Notes editor can insert the same event reference");
    setPublicCard(true);await until(()=>!!document.querySelector("[data-public-card]"),"public card");
    check(document.querySelector("[data-public-card]")?.textContent==="Calendar event (private)"&&!document.querySelector("[data-public-card] a"),"public shares never expose account event details or navigation");
    fill(input.current!,"@events Project");await until(()=>!!document.querySelector("[data-picker] [role=option]"),"space shortcut");
    check(kind==="calendar-event"||document.querySelector("[data-picker]")?.getAttribute("data-kind")==="calendar-event","@events space query selects the calendar scope");
    check(document.body.scrollWidth<=innerWidth,"event references fit the viewport");
    await fetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,passed:true,results:report})});
   }catch(e){const failed=[...report,"FAIL "+String(e)];setResults(failed);await fetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,passed:false,results:failed})});}
  }
  const change=(value:string,cursor:number)=>{setText(value);const m=composerMentionQuery(value,cursor,cursor,selected.map(x=>x.label));setMention(m);const resolved=resolveReferenceQuery(m?.query||"");setKind(resolved.kind);setQuery(resolved.query);};
  return <main className="bg-background text-foreground p-4 space-y-4"><h1 className="text-sm">Calendar event references · synthetic data</h1>
   <button className="min-h-11 border px-3 rounded" onClick={()=>void run()}>Run event checks</button>
   <RichComposerInput ref={input} value={text} syncNonce={nonce} mentionLabels={selected.map(x=>x.label)} aria-label="Message" onChange={change}/>
   {mention?<div data-picker data-kind={kind}><ReferencePicker id="event-fixture" kind={kind} query={query} results={search.results} loading={search.loading} indexing={search.indexing} error={search.error} retry={search.retry} index={0} onIndex={()=>{}} onCategory={value=>{setKind(value);setQuery("");}} onQuery={setQuery} onKeyDown={()=>{}} onSelect={choose}/></div>:null}
   <div data-sent><RichUserText content={selected.map(x=>"@"+x.label).join(" ")} references={selected}/></div>
   {meta?<><div data-agent-link><Markdown content={"[Weekly review](calendar-event://"+meta.series.id+")"}/></div><div data-tool-card><ToolCallPreview inline tool={{name:"mcp__metis_ai__calendar_create_event",kind:"mcp",status:"completed",result:JSON.stringify({event:{id:meta.event.id}})}}/></div><div data-failed-card><ToolCallPreview inline tool={{name:"calendar_create_event",kind:"mcp",status:"error",result:JSON.stringify({event:{id:meta.event.id}})}}/></div><div data-explicit-card><Markdown content={'```calendar-event\n'+JSON.stringify({id:meta.event.id})+'\n```'}/></div>{publicCard?<div data-public-card><PublicMarkdownContext.Provider value={{noteIds:[],assets:{}}}><CalendarEventCard id={meta.event.id}/></PublicMarkdownContext.Provider></div>:null}</>:null}
   <div className="h-[650px] flex"><CalendarPanel userId="synthetic-event-owner"/></div>
   <div data-deferred-card><ToolCallPreview inline tool={{name:"calendar_create_event",kind:"mcp",status:"completed",result:"truncated",resultUrl:"/api/chats/fixture/tool-result?tool=created"}}/></div>
   <NotesBlockEditor noteId="synthetic-editor" value={note} onChange={setNote}/>
   <pre className="text-xs whitespace-pre-wrap">{results.join("\n")}</pre>
  </main>;
 }
 document.documentElement.classList.add("dark");createRoot(document.getElementById("root")!).render(<Fixture/>);
}
