"use client";
import {useEffect,useRef,useState} from "react";
import {CalendarDays,ArrowUpRight} from "lucide-react";
import {useInternalLinkPreview} from "@/components/use-internal-link-preview";
import {usePublicMarkdownShare} from "@/components/public-markdown-context";
import {loadToolPayload} from "@/lib/tool-result-client";
import {calendarEventToolId} from "@/lib/calendar-event-link";
import {internalLinkNavigation} from "@/lib/internal-link";
/** Deferred results are fetched only near the viewport; retain just the saved ID. */
export function DeferredCalendarEventCard({name,input,resultUrl,status}:{name:string;input?:string;resultUrl:string;status:string}){
 const share=usePublicMarkdownShare(),host=useRef<HTMLDivElement>(null);
 const[state,setState]=useState<{url:string;id:string|null;error?:boolean}|null>(null),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(share)return;
  const controller=new AbortController();let current=true,timer:ReturnType<typeof setTimeout>|undefined;
  const load=()=>{
   timer=setTimeout(()=>controller.abort(),8000);
   void loadToolPayload(resultUrl,controller.signal).then(payload=>{if(current)setState({url:resultUrl,id:calendarEventToolId(name,payload.input??input,payload.result,status)});})
   .catch(()=>{if(current)setState({url:resultUrl,id:null,error:true});}).finally(()=>clearTimeout(timer));
  };
  let observer:IntersectionObserver|undefined;
  if(typeof IntersectionObserver==="undefined")load();else{observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer?.disconnect();load();}},{rootMargin:"200px"});if(host.current)observer.observe(host.current);}
  return()=>{current=false;controller.abort();clearTimeout(timer);observer?.disconnect();};
 },[name,input,resultUrl,status,retry,share]);
 if(share)return <p>Calendar event (private)</p>;
 const value=state?.url===resultUrl?state:null;
 return <div ref={host}>{value?.id?<CalendarEventCard id={value.id}/>:value?.error?<p role="status" className="text-xs">Calendar event details unavailable. <button className="min-h-11 underline" onClick={()=>setRetry(v=>v+1)}>Retry</button></p>:!value?<p role="status" className="my-3 text-xs text-muted-foreground">Checking calendar event…</p>:null}</div>;
}
/** Live account-checked projection, not caller-provided event fields. Public shares stay private. */
export function CalendarEventCard({id}:{id:string}){
 const share=usePublicMarkdownShare(),host=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{
  if(share)return;
  if(typeof IntersectionObserver==="undefined"){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:"200px"});
  if(host.current)observer.observe(host.current);return()=>observer.disconnect();
 },[share]);
 const target={kind:"calendar-event" as const,id},navigation=internalLinkNavigation(target);
 const{preview,state,retry}=useInternalLinkPreview(target,null,visible&&!share);
 if(share)return <p className="my-2 text-sm text-muted-foreground">Calendar event (private)</p>;
 return <div ref={host} data-calendar-event-card={id} className="my-3 min-w-0 overflow-hidden rounded-lg border border-border border-l-4 bg-card p-3" style={{borderLeftColor:preview?.color&&/^#[a-f0-9]{6}$/i.test(preview.color)?preview.color:undefined}}>
  {state==="loading"?<p role="status" className="text-xs text-muted-foreground">Loading calendar event…</p>:state==="error"?<div role="status" className="text-xs text-muted-foreground">Event unavailable. It may have been deleted or is not shared with this account. <button className="min-h-11 underline" onClick={retry}>Retry</button></div>:preview?<>
   <a href={navigation.href} className="flex min-h-11 items-center gap-2 text-sm font-medium hover:underline" onClick={e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();window.dispatchEvent(new CustomEvent(navigation.event,{detail:navigation.detail}));}}>
    <CalendarDays className="size-4 shrink-0" aria-hidden="true"/><span className="min-w-0 flex-1 break-words">{preview.title}</span><ArrowUpRight className="size-4 shrink-0" aria-hidden="true"/>
   </a>
   {preview.description?<p className="mt-1 line-clamp-2 whitespace-pre-line break-words text-xs text-muted-foreground">{preview.description}</p>:null}
   <dl className="mt-2 space-y-1 text-xs">{preview.details.map(d=><div key={d.label} className="flex gap-3"><dt className="w-28 shrink-0 text-muted-foreground">{d.label}</dt><dd className="min-w-0 break-words">{d.value}</dd></div>)}</dl>
  </>:null}
 </div>;
}
