/** Real shared-page fixture with synthetic note data; no private app session. */
import React from "react";
import { createRoot } from "react-dom/client";
import { SharedNoteTree } from "../components/notes/shared-note-tree";
import type { PublicNoteShare } from "../lib/note-share-types";
Object.assign(globalThis,{React});
const code = "# Project overview\n\nThe subfiles belong at the top of this document. The reading column keeps its usual width.\n\n## Planning\n\nCapture requirements and turn the next steps into a plan.\n\n## Resources\n\nKeep useful references together.\n\n" + "More document content.\n\n".repeat(40);
let fullWidth = false;
const share = (): PublicNoteShare => ({rootId:"root",assets:{},notes:[
  {id:"root",title:"Project guide",content:code,parentId:null,sortKey:0,icon:"📚",fullWidth,createdAt:"2026-01-01",updatedAt:"2026-11-09"},
  ...Array.from({length:8},(_,i)=>({id:"child-"+i,title:["Overview","Research","Design","Implementation","Testing","Release","Resources","Archive"][i],
    content:"This is the selected subfile.",parentId:"root",sortKey:i,icon:i===0?"🦁":i===2?"lucide:palette:#ff9900":null,fullWidth:false,createdAt:"2026-01-01",updatedAt:"2026-11-09"})),
]});
const fetcher = window.fetch.bind(window);
window.fetch = async (input, init) => String(input).startsWith("/api/shared-notes/") ? Response.json(share()) : fetcher(input,init);
document.body.style.cssText="margin:0;background:#141414;color:#eee;font:14px system-ui";
document.documentElement.style.cssText="--background:#141414;--foreground:#eee;--muted:#252525;--muted-foreground:#aaa;--border:#444;--popover:#242424;--popover-foreground:#eee;--primary:#ddd;--ring:#aaa";
const host=document.createElement("div");document.body.append(host);
createRoot(host).render(<SharedNoteTree token="fixture" initialShare={share()}/>);
const controls=document.createElement("aside");controls.style.cssText="position:fixed;z-index:100;bottom:16px;left:16px;max-width:245px;padding:12px;background:#242424;border:1px solid #444;border-radius:8px;font:12px system-ui";
const report=document.createElement("pre");report.id="results";report.style.cssText="white-space:pre-wrap;margin-top:8px";
const results:string[]=[];
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(value:unknown,text:string)=>{results.push((value?"PASS ":"FAIL ")+text);report.textContent=results.join("\n");};
const test=document.createElement("button");test.id="run";test.textContent="Check current layout";
test.onclick=async()=>{
  const section=host.querySelector<HTMLElement>("[data-note-subfiles]")!;
  const nav=section.querySelector("nav")!;
  const article=section.closest("article")!,title=article.querySelector("[data-note-title]")!,body=article.querySelector(".markdown-body")!;
  const pane=section.closest("[data-note-page-scroll]")!;
  if(section.dataset.layout==="floating"){
    check(nav.querySelectorAll("li").length===8,"floating list shows all eight subfiles");
    check(nav.getBoundingClientRect().left>=article.getBoundingClientRect().right+20&&nav.getBoundingClientRect().right<=pane.getBoundingClientRect().right-12,"floating list uses only the free right margin");
    check(Math.abs(nav.getBoundingClientRect().top-title.getBoundingClientRect().top)<2,"floating list aligns with title");
  }else{
    check(nav.querySelectorAll("li").length===5,"inline list shows five subfiles");
    check(nav.getBoundingClientRect().top>=title.getBoundingClientRect().bottom&&nav.getBoundingClientRect().top<body.getBoundingClientRect().top,"inline list is below title and above content");
    const more=nav.querySelector<HTMLButtonElement>("[aria-expanded]")!;
    more.click();await pause(80);
    check(nav.querySelectorAll("li").length===8&&more.getAttribute("aria-expanded")==="true","disclosure reveals the remaining subfiles");
    more.click();await pause(80);
    check(nav.querySelectorAll("li").length===5,"disclosure collapses to five");
  }
  check(!host.querySelector("input:not([disabled]),textarea,[contenteditable=true]"),"shared page stays read-only");
  void fetcher("/results",{method:"POST",body:JSON.stringify(results)});
};
const width=document.createElement("button");width.id="full-width";width.textContent="Toggle full width";width.style.marginLeft="8px";
width.onclick=()=>{fullWidth=!fullWidth;window.dispatchEvent(new Event("focus"));};
const hide=document.createElement("button");hide.id="hide-controls";hide.textContent="Hide controls";hide.style.marginLeft="8px";hide.onclick=()=>{controls.hidden=true;};
controls.append(test,width,hide,report);document.body.append(controls);
