import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import {webcrypto} from "node:crypto";
import {createClientId} from "../lib/client-id";
import {createNoteMutationId,stableNoteIdempotencyKey} from "../lib/note-save-state";
import {createCustomTheme,createDefaultAppearanceState} from "../lib/appearance-storage";
import {getThemePreset,DEFAULT_THEME_ID} from "../lib/appearance-theme";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const source=fs.readFileSync(new URL("../components/notes/notes-workspace.tsx",import.meta.url),"utf8");
const tree=ts.createSourceFile("notes-workspace.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function handler(name:string,scope:Record<string,unknown>){
 let found:ts.FunctionDeclaration|undefined;
 function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;else ts.forEachChild(node,visit);}
 visit(tree);assert.ok(found,name);
 const js=ts.transpileModule(found.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 return new Function(...Object.keys(scope),js+";return "+name+";")(...Object.values(scope)) as (...args:unknown[])=>Promise<unknown>;
}
function httpCrypto(t:test.TestContext){
 const original=Object.getOwnPropertyDescriptor(globalThis,"crypto");
 Object.defineProperty(globalThis,"crypto",{configurable:true,value:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,"crypto",original);else Reflect.deleteProperty(globalThis,"crypto");});
}
function harness(flush=async()=>true){
 const requests:Array<{url:string;init?:RequestInit}>=[];
 const errors:string[]=[],opened:string[]=[],saved:unknown[]=[];
 const note={id:"server-note",version:7,title:"Original",content:"Original text",kind:"note",projectId:null};
 const noop=()=>{};
 const scope={
  createClientId,navigationSerial:{current:0},projectId:null,notes:[{id:"book",kind:"issuebook"}],flush,
  setWorking:noop,setCache:noop,scopeKey:(id:string|null)=>id||"none",setExpanded:noop,setSelectedId:noop,setMode:noop,setSidebar:noop,setCreation:noop,
  setError:(error:string)=>{if(error)errors.push(error);},embedded:true,saved:(value:unknown)=>saved.push(value),
  openNote:async(id:string)=>{opened.push(id);return true;},selectedId:"server-note",selected:note,load:async()=>{},
  json:async(url:string,init?:RequestInit)=>{
   requests.push({url,init});
   if(init?.method==="POST"&&url==="/api/issues")return {issue:{id:"server-issue",noteId:"server-note",key:"TEST-1"}};
   if(url.endsWith("/duplicate"))return {notes:[note],rootId:"copy-note"};
   return {note};
  },
 };
 return {call:(name:string,...args:unknown[])=>handler(name,scope)(...args),requests,errors,opened,saved,note};
}
test("HTTP notebooks create pages, issuebooks and issue files without native randomUUID",async t=>{
 httpCrypto(t);const h=harness();
 await h.call("createFile",null,{title:"Local page",content:"Keep my text"});
 await h.call("createFile",null,{title:"Local issues",kind:"issuebook"});
 await h.call("createFile","book",{title:"Local issue",content:"Unchanged description"});
 assert.deepEqual(h.errors,[]);
 const writes=h.requests.filter(r=>r.init?.method==="POST");
 assert.deepEqual(writes.map(r=>r.url),["/api/notes","/api/notes","/api/issues"]);
 const keys=writes.map(r=>new Headers(r.init?.headers).get("Idempotency-Key")!);
 for(const key of keys)assert.match(key,uuid);
 assert.equal(new Set(keys).size,keys.length);
 const bodies=writes.map(r=>JSON.parse(String(r.init?.body)));
 assert.equal(bodies[0].content,"Keep my text");assert.equal(bodies[1].kind,"issuebook");
 assert.equal(bodies[2].description,"Unchanged description");assert.equal(bodies[2].issuebookId,"book");
});
test("HTTP note updates, duplication and task conversion retain versions and source content",async t=>{
 httpCrypto(t);const h=harness();
 await h.call("patch",h.note,{title:"Renamed"});
 await h.call("duplicate",h.note);
 const issue=await h.call("createIssue","Task text","block-1","checkbox");
 assert.deepEqual(h.errors,[]);assert.deepEqual(issue,{id:"server-issue",key:"TEST-1"});
 const writes=h.requests.filter(r=>r.init?.method);
 for(const write of writes)assert.match(new Headers(write.init?.headers).get("Idempotency-Key")!,uuid);
 assert.equal(JSON.parse(String(writes[0].init?.body)).version,7);
 assert.deepEqual(h.opened,["copy-note"]);
 assert.equal(h.saved.length,1);
 const body=JSON.parse(String(writes.at(-1)!.init?.body));
 assert.deepEqual(body.source,{noteId:"server-note",sourceId:"block-1",kind:"checkbox",excerpt:"Task text"});
});
test("HTTP collaborative flush sends a request ID and waits for durable confirmation",async t=>{
 httpCrypto(t);
 const code=fs.readFileSync(new URL("../components/notes/collaborative-note-editor.tsx",import.meta.url),"utf8");
 const document=ts.createSourceFile("collaborative-note-editor.tsx",code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let callback:ts.Expression|undefined;
 function visit(node:ts.Node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(document)==="flush"&&node.initializer&&ts.isCallExpression(node.initializer))callback=node.initializer.arguments[0];
  else ts.forEachChild(node,visit);
 }
 visit(document);assert.ok(callback);
 const pending=new Map<string,(ok:boolean)=>void>(),sent:Array<{type:string;requestId:string}>=[];
 const scope={
  createClientId,fatal:false,requestAcks:{current:pending},setError:()=>assert.fail("flush must succeed"),
  client:{provider:{isSynced:true,hasUnsyncedChanges:false,sendStateless:(payload:string)=>{
   const request=JSON.parse(payload);sent.push(request);assert.match(request.requestId,uuid);
   pending.get(request.requestId)!(true);pending.delete(request.requestId);
  }}},
 };
 const js=ts.transpileModule("const flush="+callback.getText(document),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const flush=new Function(...Object.keys(scope),js+";return flush;")(...Object.values(scope));
 assert.equal(await flush(),true);assert.equal(sent.length,1);assert.equal(sent[0].type,"flush");assert.equal(pending.size,0);
});
test("HTTP page creation still waits for the current draft to flush",async t=>{
 httpCrypto(t);const h=harness(async()=>false);
 await h.call("createFile",null,{title:"Do not create before saving"});
 assert.equal(h.requests.length,0);assert.deepEqual(h.errors,[]);
});
test("HTTP autosave and custom theme IDs use the same random source while preserving explicit IDs",t=>{
 httpCrypto(t);
 const mutation=createNoteMutationId();assert.match(mutation,uuid);
 const key=stableNoteIdempotencyKey("note-1",mutation);
 assert.equal(key,stableNoteIdempotencyKey("note-1",mutation));
 const theme=getThemePreset(DEFAULT_THEME_ID)!;
 const state=createCustomTheme(createDefaultAppearanceState(),theme);
 assert.match(state.selected,new RegExp("^custom-"+uuid.source.slice(1)));
 assert.equal(createCustomTheme(createDefaultAppearanceState(),theme,"custom-existing").selected,"custom-existing");
});
