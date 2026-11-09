/** Synthetic authenticated fixture for actual NotesWorkspace and live editing. */
import React from "react";
import {createRoot} from "react-dom/client";
import type {Editor} from "@tiptap/core";
import {NotesWorkspace} from "../components/notes/notes-workspace";
Object.assign(globalThis,{React});
document.body.style.cssText="margin:0;background:#141414;color:#eee;font:14px system-ui";
document.documentElement.style.cssText="--background:#141414;--foreground:#eee;--muted:#252525;--muted-foreground:#aaa;--border:#444;--popover:#242424;--popover-foreground:#eee;--primary:#ddd;--ring:#aaa;--card:#141414;--accent:#2b2b2b;--secondary:#252525";
const host=document.createElement("main");host.style.cssText="height:100dvh";document.body.append(host);
const results:string[]=[];const report=document.createElement("pre");report.id="results";report.style.cssText="white-space:pre-wrap;font-size:11px;max-height:180px;overflow:auto";
const check=(value:unknown,label:string)=>{results.push((value?"PASS ":"FAIL ")+label);report.textContent=results.join("\n");void fetch("/results",{method:"POST",body:JSON.stringify(results)});};
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
type EditorElement=HTMLElement&{editor:Editor};
function editor(){return host.querySelector<EditorElement>(".notes-prosemirror")?.editor;}
const controls=document.createElement("aside");controls.style.cssText="position:fixed;right:16px;bottom:16px;z-index:110;padding:12px;background:#242424;border:1px solid #555;border-radius:8px;max-width:310px;font:12px system-ui";
function button(id:string,title:string,action:()=>void){const b=document.createElement("button");b.id=id;b.textContent=title;b.style.cssText="padding:8px;margin:2px;border:1px solid #555;border-radius:4px";b.onclick=action;controls.append(b);}
let info:{noteId:string;projectId:string;userId:string};
let copied="";
Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async(value:string)=>{copied=value;}}});
button("check-ui","Check editor",()=>{
 const e=editor();check(Boolean(e),"actual live Notes editor loaded");
 check(!host.textContent?.includes("Invalid metis-block source"),"legacy link block renders without source error");
 check(Boolean(host.querySelector('a[href="https://example.com"]')),"recovered link keeps its destination");
 check(host.textContent?.includes("Live editing"),"live editing status is visible");
 check(host.querySelectorAll("[data-note-live-editor] span[title][aria-label]").length>=2,"participant indicators are visible");
});
button("check-section","Check section link and scroll",()=>void(async()=>{
 const e=editor()!;const toc=host.querySelector(".notes-table-of-contents")!;
 const copy=toc.querySelector<HTMLButtonElement>('[aria-label="Copy link to Last section"]')!;copy.click();await pause(300);
 check(copied.startsWith("note://"+info.noteId+"#block-"),"copy heading link uses a persistent block identity");
 const target=Array.from(toc.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent==="Last section")!;target.click();await pause(1300);
 const heading=host.querySelector<HTMLElement>(".notes-prosemirror h2")!,pane=host.querySelector<HTMLElement>("[data-note-page-scroll]")!;
 const gap=heading.getBoundingClientRect().top-pane.getBoundingClientRect().top;
 check(gap>=16&&gap<=40,"last heading near top: gap="+Math.round(gap)+" width="+window.innerWidth+" scroll="+pane.scrollTop+" height="+pane.clientHeight);
 const response=await fetch("/api/notes/"+info.noteId);const data=await response.json();
 check(data.note.content.includes("<!-- metis:block:"),"section identity is saved in Markdown");
 check(Boolean(e)&&!e.isDestroyed,"section navigation preserves the editor");
})());
button("add-text","Insert my text",()=>{
 const e=editor()!;let pos=0;e.state.doc.descendants((node,p)=>{if(node.type.name==="paragraph"&&node.textContent.includes("Shared work begins"))pos=p;});
 e.chain().focus().insertContentAt(pos+1,location.hostname==="localhost"?"Bob live edit. ":"Alice live edit. ").run();
});
button("check-spell","Check spellcheck",()=>{
 const dom=host.querySelector<HTMLElement>(".notes-prosemirror")!;
 check(dom.getAttribute("spellcheck")==="false","Off disables browser spellcheck");
 check(host.querySelector<HTMLInputElement>("[data-note-title]")!.spellcheck===false,"Off also disables spelling in the file title");
});
button("check-color","Check saved color",()=>void(async()=>{
 check(Boolean(host.querySelector('[data-block-color="blue"]')),"blue block marker is rendered");
 const data=await(await fetch("/api/notes/"+info.noteId)).json();
 check(data.note.content.includes('"blockColor":"blue"'),"block color is durably saved with the link");
})());
button("check-source","Check collaborative Markdown",()=>void(async()=>{
 const e=editor()!;const before=e.getText();
 const mode=Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent?.trim()==="Markdown")!;mode.click();await pause(150);
 const cm=host.querySelector<HTMLElement>(".cm-content")!;
 check(cm.getAttribute("contenteditable")==="true","collaborative Markdown remains editable");
 const source=(await(await fetch("/api/notes/"+info.noteId)).json()).note.content as string;
 const content=source.replace("Finish here.","Finish here. Source edit.");
 // Dispatch the same CodeMirror input path as typing.
 const view=(await import("@codemirror/view")).EditorView.findFromDOM(cm)!;
 view.dispatch({changes:{from:0,to:view.state.doc.length,insert:content}});await pause(500);
 Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent?.trim()==="Blocks")!.click();await pause(200);
 check(e===editor()&&!e.isDestroyed,"mode switching keeps the live editor instance");
 check(e.getText().includes("Source edit.")&&e.getText().includes(before.split("\n")[0]),"source edit preserves existing rich content");
 const saved=(await(await fetch("/api/notes/"+info.noteId)).json()).note.content;
 check(saved.includes("Source edit."),"source mode changes are confirmed by the live server");
})());
button("check-remote","Check merged edits",()=>{
 check(editor()!.getText().includes("Source edit."),"remote Markdown changes appear as blocks");
 check(editor()!.getText().includes("Alice live edit.")&&editor()!.getText().includes("Bob live edit."),"both users' text edits are preserved");
});
let localUndoSource="",undoBaseline=0;
button("source-local","Start source undo check",()=>void(async()=>{
 const mode=Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent?.trim()==="Markdown")!;mode.click();await pause(150);
 const cm=host.querySelector<HTMLElement>(".cm-content")!;
 const view=(await import("@codemirror/view")).EditorView.findFromDOM(cm)!;
 localUndoSource=view.state.doc.toString();
 undoBaseline=(localUndoSource.match(/Bob live edit\./g)||[]).length;
 const at=localUndoSource.indexOf("Shared work begins");
 view.dispatch({changes:{from:at,insert:"Local undo fixture. "}});view.focus();
})());
button("source-undo","Check local undo",()=>void(async()=>{
 const cm=host.querySelector<HTMLElement>(".cm-content")!,view=(await import("@codemirror/view")).EditorView.findFromDOM(cm)!;
 check((view.state.doc.toString().match(/Bob live edit\./g)||[]).length>undoBaseline,"remote edit reaches the Markdown source editor");
 (await import("@codemirror/commands")).undo(view);await pause(300);
 const text=view.state.doc.toString();
 check(!text.includes("Local undo fixture."),"Undo removes my own source edit");
 check((text.match(/Bob live edit\./g)||[]).length>undoBaseline,"Undo preserves the other user's remote edit");
})());
let resizeTimer:ReturnType<typeof setTimeout>;
window.addEventListener("resize",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{
 check(document.documentElement.scrollWidth<=window.innerWidth+1,"no horizontal overflow at "+window.innerWidth+"px");
 const nav=host.querySelector<HTMLElement>(".notes-editor-mode");
 check(!nav||nav.getBoundingClientRect().right<=window.innerWidth,"editor controls fit at "+window.innerWidth+"px");
},200);});
button("review-mode","Read-only visual review",()=>{
 const e=editor()!;e.setEditable(false);
 const input=host.querySelector<HTMLInputElement>("[data-note-title]")!;
 const title=document.createElement("h1");title.textContent=input.value;title.className=input.className;input.replaceWith(title);
 host.querySelector<HTMLElement>("[data-note-page-scroll]")!.scrollTo({top:0});
 controls.hidden=true;
});
button("hide-controls","Hide fixture controls",()=>{controls.hidden=true;});
controls.append(report);document.body.append(controls);
fetch("/fixture").then(r=>r.json()).then(value=>{info=value;createRoot(host).render(<NotesWorkspace initialProjectId={info.projectId} focusNoteId={info.noteId}/>);});
