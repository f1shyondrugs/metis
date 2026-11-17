import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {NotebookPresenceBar} from "../components/notes/notebook-presence-bar";
import {NotebookProjectIcon} from "../components/notes/notebook-project-icon";
import {notebookDocumentPeers,uniqueNotebookPeers,type NotebookPeer,type NotebookPerson} from "../lib/notebook-presence";
Object.assign(globalThis,{React});
const self:NotebookPerson={id:"self",username:"preview",name:"Preview",avatar:null,color:"#556677"};
const peer=(id:string,noteId="alpha",sessionId=id):NotebookPeer=>({sessionId,user:{...self,id,username:id,name:id},note:{id:noteId,title:"Note "+noteId}});
const controls={following:null,onFollow:()=>{},onStop:()=>{},onReconnect:()=>{}};
const bar=(overrides:Partial<React.ComponentProps<typeof NotebookPresenceBar>>={})=>renderToStaticMarkup(<NotebookPresenceBar peers={[]} self={self} noteId="alpha" connected notice="" {...controls} {...overrides}/>);
test("solo, overview and other-note sessions do not occupy a presence row",()=>{
 for(const props of [{},{noteId:null},{peers:[peer("other","beta")]},{peers:[peer("self")]},{peers:[peer("other")],self:null},{peers:[peer("other")],connected:false}])assert.equal(bar(props),"");
});
test("document participants are filtered before account deduplication",()=>{
 const elsewhere=peer("other","beta","elsewhere"),here=peer("other","alpha","here"),samePersonAgain=peer("other","alpha","again");
 assert.deepEqual(notebookDocumentPeers([elsewhere,here,samePersonAgain,peer("self")],self.id,"alpha"),[here]);
 assert.deepEqual(uniqueNotebookPeers([elsewhere,here],self.id),[elsewhere],"cross-note discovery keeps its existing one-account projection");
 const html=bar({peers:[elsewhere,here,samePersonAgain,peer("third","beta")]});
 assert.ok(html.includes("Live editing"));assert.ok(html.includes("People in this document"));
 assert.equal((html.match(/aria-label="@other — viewing/g)||[]).length,1);
 assert.ok(!html.includes("@third"));assert.ok(!html.includes("Only you here"));
});
test("presence is hidden again when the final other account leaves or changes notes",()=>{
 assert.ok(bar({peers:[peer("other")]}).includes("Live editing"));
 assert.equal(bar({peers:[peer("other","beta")]}),"");
 assert.equal(bar({peers:[]}),"");
});
test("disconnected recovery is still visible without the participant row or avatars",()=>{
 const html=bar({connected:false,notice:"Sign in again, then retry."});
 assert.ok(html.includes("Notebook presence notice"));assert.ok(html.includes("Sign in again"));assert.ok(html.includes(">Retry<"));
 assert.ok(!html.includes("Live editing"));assert.ok(!html.includes("People in this document"));
});
test("project marks reuse the saved glyph/color, uploaded logo or folder fallback",()=>{
 const project={id:"project",icon:"code",color:"#ffbb00",logoStoredName:undefined,updatedAt:"2026-11-15"};
 const glyph=renderToStaticMarkup(<NotebookProjectIcon project={project}/>);
 assert.ok(glyph.includes('color:#ffbb00'));assert.ok(glyph.includes("<svg"));
 const other=renderToStaticMarkup(<NotebookProjectIcon project={{...project,icon:"rocket",color:"#0088aa"}}/>);
 assert.notEqual(glyph,other);assert.ok(other.includes("color:#0088aa"));assert.ok(other.includes("lucide-rocket"));
 const logo=renderToStaticMarkup(<NotebookProjectIcon project={{...project,logoStoredName:"saved-logo.png"}}/>);
 assert.ok(logo.includes("<img"));assert.ok(logo.includes("/api/projects/project/logo"));assert.ok(!logo.includes("<svg"));
 const none=renderToStaticMarkup(<NotebookProjectIcon project={null}/>);
 assert.ok(none.includes("lucide-folder-open"));assert.ok(!none.includes("<img"));
});
