import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {ProjectNotesPreview,PROJECT_NOTES_PREVIEW_LIMIT} from "../components/project-notes-preview";
import {notesNavigationHarnessSource} from "./project-notes-navigation-harness.mjs";
Object.assign(globalThis,{React});
const notes=Array.from({length:12},(_,i)=>({id:"note-"+i,title:"Note "+i+".md",color:"#112233"}));
test("project note summary is bounded, retains full count, titles and notes access",()=>{
 const html=renderToStaticMarkup(<ProjectNotesPreview notes={notes} onOpenNotes={()=>{}}/>);
 assert.equal((html.match(/<li\b/g)||[]).length,PROJECT_NOTES_PREVIEW_LIMIT);
 assert(html.includes("View all notes (12)"));assert(html.includes("Note 4"));assert(!html.includes("Note 5"));
 assert(!html.includes(".md"));assert(html.includes("title=\"Note 0\""));
 assert(html.includes("min-w-0 flex-1 truncate"));assert(html.includes("color:#112233"));
 const empty=renderToStaticMarkup(<ProjectNotesPreview notes={[]} onOpenNotes={()=>{}}/>);
 assert(empty.includes("Open notes"));assert(!empty.includes("View all notes"));
});
for(const noteId of ["nested-note",undefined]){
 test("actual ProjectHome callback survives route reconciliation for "+(noteId??"all notes"),()=>{
  const source=notesNavigationHarnessSource();
  const harness=vm.runInNewContext(source+";createNotesNavigationHarness()",{URL,URLSearchParams});
  const result=harness.open(noteId);
  assert.equal(result.notesOpen,true);assert.equal(result.focusedNoteId,noteId??null);
  assert.equal(result.url,"/?c=notes");assert.equal(result.workspaceOpen,false);
  assert.equal(result.workspaceFullscreen,false);assert.equal(result.mobileNavOpen,false);
  assert.equal(result.projectHomeId,"fixture-project","retain the project scope when opening its notebook");
 });
}
