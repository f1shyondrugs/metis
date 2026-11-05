import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import {renderToStaticMarkup} from "react-dom/server";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
require.extensions[".css"]=()=>{};
const loaded=import("../components/notes/shared-note-tree");
import type {PublicNoteShare} from "../lib/note-share-types";
Object.assign(globalThis,{React});
const token="q".repeat(43);
const share:PublicNoteShare={rootId:"root",assets:{},notes:[
 {id:"root",title:"Public root.md",content:"Public text",parentId:null,sortKey:1,icon:"📚",fullWidth:false,createdAt:"2026-01-01",updatedAt:"2026-01-02"},
 {id:"child",title:"Child",content:"Child text",parentId:"root",sortKey:2,icon:null,fullWidth:false,createdAt:"2026-01-01",updatedAt:"2026-01-02"},
 {id:"grandchild",title:"Grandchild",content:"Nested text",parentId:"child",sortKey:3,icon:null,fullWidth:false,createdAt:"2026-01-01",updatedAt:"2026-01-02"}
]};
test("shared navigation stays inside the supplied subtree and breadcrumbs stop at the shared root",async()=>{
 const {sharedNoteSelection,sharedNoteBreadcrumbs}=await loaded;
 assert.equal(sharedNoteSelection(share,"grandchild")?.id,"grandchild");
 assert.equal(sharedNoteSelection(share,"private-parent")?.id,"root");
 assert.deepEqual(sharedNoteBreadcrumbs(share,"grandchild").map(note=>note.id),["root","child","grandchild"]);
 assert.deepEqual(sharedNoteBreadcrumbs(share,"private-parent"),[]);
});
test("public tree shows only read-only note navigation and no editor actions",async()=>{
 const {SharedNoteTree}=await loaded;
 const html=renderToStaticMarkup(<SharedNoteTree token={token} initialShare={share}/>);
 assert.match(html,/Public root/);
 assert.doesNotMatch(html,/Public root\.md/);
 assert.match(html,/Child/);
 assert.match(html,/Public text/);
 assert.match(html,/Read only/);
 assert.doesNotMatch(html,/contenteditable|<textarea|New file|File options|Save changes|Actions for/);
});
test("checklist-only shared notes retain visible read-only tasks",async()=>{
 const {SharedNoteTree}=await loaded;
 const checklist={...share,notes:share.notes.map(note=>note.id==="root"?{...note,content:"",todos:[{id:"task",content:"Review the shared draft",status:"in_progress" as const}]}:note)};
 const html=renderToStaticMarkup(<SharedNoteTree token={token} initialShare={checklist}/>);
 assert.match(html,/Review the shared draft/);
 assert.match(html,/In progress/);
 assert.match(html,/disabled/);
 assert.doesNotMatch(html,/This page is empty/);
});
