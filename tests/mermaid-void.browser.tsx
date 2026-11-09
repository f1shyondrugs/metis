/** Isolated fixture for the real renderer, notebook source engine and workspace wrappers. */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { MermaidDiagram } from "../components/mermaid-diagram";
import { NotesBlockEditor } from "../components/notes/block-editor";
import { EditableMarkdown } from "../components/editable-markdown";
Object.assign(globalThis, { React });
const code = "flowchart LR\n A[Capture idea] --> B[Notebook]\n B --> C{Ready?}\n C -->|Yes| D[Canvas]\n C -->|Plan| E[Plan]\n E --> F[Build]\n D --> F";
const fence = String.fromCharCode(96).repeat(3);
const doc = "# Diagram\n\n" + fence + "mermaid\n" + code + "\n" + fence + "\n\nKeep this paragraph.";
const result: string[] = [];
const status = document.createElement("pre"); status.id = "results";
const report = (pass: unknown, text: string) => { result.push((pass ? "PASS " : "FAIL ") + text); status.textContent = result.join("\n"); };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const host = document.createElement("main"); host.style.cssText = "max-width:1000px;margin:auto;padding:20px";
document.body.style.cssText = "margin:0;background:#141414;color:#eee;font:14px system-ui";
document.documentElement.style.cssText = "--background:#141414;--foreground:#eee;--muted:#252525;--muted-foreground:#aaa;--border:#444;--popover:#242424;--popover-foreground:#eee;--ring:#aaa";
status.style.cssText = "white-space:pre-wrap;padding:20px;color:#a5d6a7;font-size:12px";
document.body.append(host, status);
let lastDocument = doc;
function Fixture() {
  const [documentValue, setDocument] = useState(doc);
  const [surface, setSurface] = useState("notebook");
  const [checks, setChecks] = useState(false);
  const change = (next: string) => { lastDocument = next; setDocument(next); };
  async function run() {
    setChecks(true);
    const viewport = host.querySelector<HTMLElement>("[data-mermaid-viewport]")!;
    const content = viewport.firstElementChild as HTMLElement;
    report(viewport.clientHeight >= 300 && viewport.clientWidth > 0, "canvas has a usable viewport");
    const before = content.style.transform;
    viewport.dispatchEvent(new WheelEvent("wheel", {bubbles:true,cancelable:true,deltaX:1000000,deltaY:1000000}));
    await pause(60);
    report(content.style.transform !== before, "wheel pans without document bounds");
    viewport.dispatchEvent(new WheelEvent("wheel", {bubbles:true,cancelable:true,ctrlKey:true,deltaY:-100,clientX:100,clientY:200}));
    await pause(60);
    report(Number(viewport.dataset.zoom) > 0, "anchored zoom remains valid after distant pan");
    (host.querySelector('[aria-label="Fit diagram"]') as HTMLButtonElement).click();
    await pause(60);
    const box = content.getBoundingClientRect(), frame = viewport.getBoundingClientRect();
    report(Math.abs(box.x + box.width / 2 - frame.x - frame.width / 2) < 1 && Math.abs(box.y + box.height / 2 - frame.y - frame.height / 2) < 1 && box.width <= frame.width && box.height <= frame.height, "fit centers the whole diagram inside its viewport");
    const ownCard = host.querySelector('[data-editor-control="mermaid"]')!;
    (Array.from(ownCard.querySelectorAll("button")).find(button => button.textContent === "Code") as HTMLButtonElement).click();
    await pause(100);
    const cm = EditorView.findFromDOM(host.querySelector('[aria-label="Mermaid source"]') as HTMLElement)!;
    report(Boolean(cm), "Mermaid Code uses the notebook CodeMirror engine");
    cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:code.replace("Build","Ship")}});
    await pause(250);
    report(lastDocument.includes("Ship") && lastDocument.endsWith("Keep this paragraph."), "edit persists only the embedded Mermaid source");
    cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:code}});
    await pause(250);
    report(lastDocument === doc, surface + " source edit round-trips without touching surrounding Markdown");
    report(cm.dom.isConnected && EditorView.findFromDOM(cm.contentDOM) === cm, "source editor keeps its instance after autosave");
    void fetch("/results", {method:"POST",body:JSON.stringify(result)});
    setChecks(false);
  }
  async function fullscreenChecks() {
    const card = host.querySelector('[data-editor-control="mermaid"]')!;
    (Array.from(card.querySelectorAll("button")).find(button => button.textContent === "Code") as HTMLButtonElement).click();
    await pause(80);
    (card.querySelector('[aria-label="Open flowchart fullscreen"]') as HTMLButtonElement).click();
    await pause(100);
    const dialog = window.document.querySelector('[role="dialog"]')!;
    const cm = EditorView.findFromDOM(dialog.querySelector('[aria-label="Mermaid source"]') as HTMLElement)!;
    cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:code.replace("Build","Fullscreen ship")}});
    await pause(250);
    report(lastDocument.includes("Fullscreen ship"), "fullscreen edits reach the owning Markdown document");
    cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:code}});
    await pause(250);
    report(lastDocument === doc, "fullscreen source round-trip preserves the document");
    (dialog.querySelector('[aria-label="Exit fullscreen"]') as HTMLButtonElement).click();
    await pause(100);
    const publicCard = host.querySelector("#public")!;
    (Array.from(publicCard.querySelectorAll("button")).find(button => button.textContent === "Code") as HTMLButtonElement).click();
    await pause(100);
    const readonly = EditorView.findFromDOM(publicCard.querySelector('[aria-label="Mermaid source"]') as HTMLElement)!;
    readonly.dispatch({changes:{from:0,to:readonly.state.doc.length,insert:"must remain unchanged"}});
    report(readonly.state.sliceDoc() === code, "public source remains read-only");
    void fetch("/results", {method:"POST",body:JSON.stringify(result)});
  }
  return <>
    <h1 style={{fontSize:22,marginBottom:16}}>Mermaid canvas</h1>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:16}}>
      {["notebook","canvas","plan"].map(value => <button key={value} onClick={()=>setSurface(value)}>{value}</button>)}
      <button id="fullscreen-checks" onClick={()=>void fullscreenChecks()}>Fullscreen checks</button>
      <button id="run-checks" disabled={checks} onClick={()=>void run()}>Run checks</button>
    </div>
    <section id="editor" key={surface}>
      {surface === "notebook" ? <NotesBlockEditor editorId="fixture-note" value={documentValue} onChange={change}/> :
        <EditableMarkdown editorId={"fixture-"+surface} value={documentValue} onChange={change} aria-label={surface+" content"}/>}
    </section>
    <h2 style={{margin:"24px 0 12px",fontSize:16}}>Public read-only diagram</h2>
    <section id="public"><MermaidDiagram code={code} publicShare/></section>
  </>;
}
createRoot(host).render(<Fixture/>);
