"use client";

import React, { Component, Suspense, useEffect, useId, useState, type ReactNode } from "react";
import { HtmlEmbed } from "@/components/html-embed";
import { GraphBoard } from "@/components/graph-board";
import { ChartBoard } from "@/components/chart-board";
import { Markdown } from "@/components/markdown";
import { OverlayFilePreview } from "@/components/overlay-file-preview";
import { normalizeTheme } from "@/lib/appearance-theme";
import type { OverlayItem, OverlayState } from "@/lib/desktop-overlay";
export type { OverlayItem, OverlayState } from "@/lib/desktop-overlay";
// Native appearance v1 is deliberately not the persisted browser settings schema.
function nativeTheme(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const value = input as {version?:unknown;mode?:unknown;variables?:unknown};
  if(value.version!==1)return null;
  try {
    const theme=normalizeTheme({format:"metis-theme",version:1,name:"Native desktop",mode:value.mode,variables:value.variables});
    return {mode:theme.mode,entries:Object.entries(theme.variables)};
  }catch{return null;}
}

// Only the public preload surface is callable from this renderer.
type OverlayBridge = {
  state:()=>Promise<OverlayState>; onState:(cb:(state:OverlayState)=>void)=>()=>void;
  interact:(id:string|null)=>Promise<unknown>; remove:(id:string)=>Promise<unknown>;
  clear:()=>Promise<unknown>; undo:()=>Promise<unknown>;
};
function bridge() { return (window as Window & {metisOverlay?:OverlayBridge}).metisOverlay; }

class PreviewBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed ? <p role="alert">This preview could not be displayed.</p> : this.props.children;}
}

function CardContent({item}:{item:OverlayItem}) {
  const content=item.content;
  if(!content)return <p role="status">No preview content.</p>;
  const code=content.source ?? JSON.stringify(content.spec ?? {});
  switch(content.kind) {
    case "html": return <HtmlEmbed source={content.source || ""}/>;
    case "graph": return <GraphBoard code={code} readOnly/>;
    case "chart": return <ChartBoard code={code} readOnly/>;
    case "markdown":
      // Images and fenced rich content can load remote resources or escape the card.
      // Rich content has its own explicitly typed card; prose stays prose here.
      return <Markdown publicShare={{noteIds:[],assets:{}}} content={(content.source || "").replace(/!\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/\x60{3}[\s\S]*?\x60{3}/g,match=>"    "+match.split("\n").join("\n    "))}/>;
    case "file": {
      const file=content.file;
      if(!file)return <p role="alert">Missing file preview.</p>;
      return <OverlayFilePreview key={JSON.stringify(content)} file={file} content={content}/>;
    }
    default:return <p role="alert">Unsupported preview type.</p>;
  }
}

function Shape({item:i}:{item:OverlayItem}) {
  const uid=useId().replace(/:/g,""), color=i.color || "var(--primary)";
  const common={stroke:color,strokeWidth:i.strokeWidth ?? 2,fill:i.fill || "none",opacity:i.opacity ?? 1};
  const points=i.points?.map(p=>p.x+","+p.y).join(" ");
  if(i.type==="spotlight")return <g opacity={i.opacity ?? .65}>
    <defs><mask id={uid} maskUnits="userSpaceOnUse" x={i.x} y={i.y} width={i.width} height={i.height}>
      <rect x={i.x} y={i.y} width={i.width} height={i.height} fill="white"/>
      {i.holes?.map((h,n)=>h.shape==="ellipse"
        ? <ellipse key={n} cx={h.x+h.width/2} cy={h.y+h.height/2} rx={h.width/2} ry={h.height/2} fill="black"/>
        : <rect key={n} x={h.x} y={h.y} width={h.width} height={h.height} rx={h.radius} fill="black"/>)}
    </mask></defs><rect x={i.x} y={i.y} width={i.width} height={i.height} fill={i.fill || i.color || "#000"} mask={"url(#"+uid+")"}/>
  </g>;
  if(i.type==="ellipse")return <ellipse {...common} cx={i.x+i.width/2} cy={i.y+i.height/2} rx={i.width/2} ry={i.height/2}/>;
  if(i.type==="text")return <text x={i.x} y={i.y} dominantBaseline="hanging" fill={color} opacity={i.opacity ?? 1} fontSize={i.fontSize ?? 20}>
    {(i.text || "").split("\n").map((line,n)=><tspan key={n} x={i.x} dy={n ? "1.3em" : 0}>{line}</tspan>)}
  </text>;
  if(i.type==="path")return <polyline {...common} points={points} strokeLinecap="round" strokeLinejoin="round"/>;
  if(i.type==="line" || i.type==="arrow")return <g>
    {i.type==="arrow" && <defs><marker id={uid} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={color}/></marker></defs>}
    <line {...common} x1={i.points?.[0]?.x ?? i.x} y1={i.points?.[0]?.y ?? i.y} x2={i.points?.[1]?.x ?? i.x+i.width} y2={i.points?.[1]?.y ?? i.y+i.height}
      markerEnd={i.type==="arrow" ? "url(#"+uid+")" : undefined} markerStart={i.type==="arrow" && i.doubleArrow ? "url(#"+uid+")" : undefined}/>
  </g>;
  return <rect {...common} x={i.x} y={i.y} width={i.width} height={i.height} rx={i.radius ?? 0}
    {...(i.type==="highlight" ? {fill:i.fill || color,opacity:i.opacity ?? .25,stroke:"none"} : {})}/>;
}

export function DesktopOverlay() {
  const [scene,setScene]=useState<OverlayState|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{
    let live=true;
    const api=bridge();
    const accept=(next:OverlayState)=>{if(live)setScene(current=>!current || next.revision>=current.revision ? next : current);};
    const unsubscribe=api?.onState(accept);
    void api?.state().then(accept).catch(()=>{if(live)setError("Could not load the desktop overlay.");});
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();void api?.clear().catch(()=>{if(live)setError("Could not clear the overlay.");});}};
    window.addEventListener("keydown",escape,true);
    return ()=>{live=false;unsubscribe?.();window.removeEventListener("keydown",escape,true);};
  },[]);
  useEffect(()=>{
    const theme=nativeTheme(scene?.appearance);
    if(!theme)return;
    const root=document.documentElement;
    const previous=theme.entries.map(([key])=>[key,root.style.getPropertyValue(key),root.style.getPropertyPriority(key)]);
    const scheme=root.style.colorScheme,mode=root.dataset.metisTheme,dark=root.classList.contains("dark");
    for(const [key,value] of theme.entries)root.style.setProperty(key,value);
    root.style.colorScheme=theme.mode;root.dataset.metisTheme=theme.mode;root.classList.toggle("dark",theme.mode==="dark");
    return ()=>{
      for(const [key,value,priority] of previous){if(value)root.style.setProperty(key,value,priority);else root.style.removeProperty(key);}
      root.style.colorScheme=scheme;if(mode===undefined)delete root.dataset.metisTheme;else root.dataset.metisTheme=mode;root.classList.toggle("dark",dark);
    };
  },[scene?.appearance]);
  async function action(run:(api:OverlayBridge)=>Promise<unknown>) {
    const api=bridge();if(!api || busy)return;
    setBusy(true);setError("");
    try{await run(api);}catch{setError("The overlay action failed. Try again.");}finally{setBusy(false);}
  }
  const interactive=scene?.items.find(i=>i.id===scene.interactiveId && i.type==="card");
  return <main data-desktop-overlay="" aria-label="Desktop overlay" style={{position:"fixed",inset:0,pointerEvents:"none",overflow:"hidden"}}>
    <style>{`
      html:has([data-desktop-overlay]),body:has([data-desktop-overlay]){background:transparent!important;overflow:hidden!important}
      [data-overlay-card] [aria-label*="fullscreen" i],[data-overlay-card] .markdown-code-toolbar{display:none!important}
      [data-overlay-card] a{pointer-events:none!important}
      [data-overlay-card] iframe{max-width:100%}\n      [data-overlay-card] [data-overlay-file]{height:100%}\n      [data-overlay-card] [data-file-embed="pdf"] iframe{min-height:0;height:100%}
      [data-overlay-toolbar] button{min-height:44px;min-width:44px;padding:8px;border-radius:6px}
      [data-overlay-toolbar] button:focus-visible{outline:2px solid var(--ring,var(--primary));outline-offset:2px}
      [data-overlay-toolbar] button:hover{background:var(--muted)}
    `}</style>
    {scene && <div style={{position:"absolute",width:scene.display.width,height:scene.display.height}}>
      {scene.items.map(item=>item.type==="card" ? <section key={item.id} data-overlay-card={item.id} data-overlay-interactive={item.id===interactive?.id ? "" : undefined} aria-label={item.text || item.content?.kind || "Preview"}
        inert={item.id!==interactive?.id || undefined} style={{position:"absolute",left:item.x,top:item.y,width:item.width,height:item.height,opacity:item.opacity ?? 1,
        pointerEvents:item.id===interactive?.id ? "auto" : "none",display:"flex",flexDirection:"column",overflow:"hidden",border:"1px solid var(--border)",borderRadius:item.radius ?? 12,background:"var(--background)",color:"var(--foreground)",boxShadow:"0 4px 18px #0003"}}
        onClickCapture={event=>{if((event.target as Element).closest('a,[aria-label*="fullscreen" i]')){event.preventDefault();event.stopPropagation();}}}>
        <header style={{flexShrink:0,padding:"10px 14px",borderBottom:"1px solid var(--border)",fontSize:12,fontWeight:600}}>{item.text || (item.content?.kind==="file" ? item.content.file?.name : item.content?.kind?.toUpperCase()) || "Preview"}</header>
        <div data-overlay-content="" style={{overflow:"auto",minHeight:0,padding:12,flex:1}}>
          <PreviewBoundary key={JSON.stringify(item.content)}><Suspense fallback={<p role="status">Loading preview…</p>}><CardContent item={item}/></Suspense></PreviewBoundary>
        </div>
      </section> : <svg key={item.id} aria-hidden="true" width={scene.display.width} height={scene.display.height} style={{position:"absolute",inset:0,overflow:"visible",pointerEvents:"none"}}><Shape item={item}/></svg>)}
    </div>}
    {interactive && <div data-overlay-toolbar="" data-overlay-interactive="" role="toolbar" aria-label="Overlay controls" style={{position:"fixed",right:8,bottom:8,maxWidth:"calc(100vw - 16px)",pointerEvents:"auto",display:"flex",gap:4,padding:4,border:"1px solid var(--border)",borderRadius:10,background:"var(--background)",color:"var(--foreground)"}}>
      <button disabled={busy} onClick={()=>void action(api=>api.interact(null))}>Done</button>
      <button disabled={busy} onClick={()=>void action(api=>api.remove(interactive.id))}>Delete</button>
      <button disabled={busy} onClick={()=>void action(api=>api.clear())}>Clear</button>
      <button disabled={busy} onClick={()=>void action(api=>api.undo())}>Undo</button>
    </div>}
    {error && <p role="alert" style={{position:"fixed",top:8,right:8,background:"var(--background)",color:"var(--foreground)",padding:12}}>{error}</p>}
  </main>;
}
