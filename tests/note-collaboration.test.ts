import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import WebSocket,{WebSocketServer} from "ws";
import * as Y from "yjs";
import {getSchema} from "@tiptap/core";
import {prosemirrorJSONToYXmlFragment} from "@tiptap/y-tiptap";
import {notesEditorExtensions} from "../lib/notes-editor-extensions";
import {HocuspocusProvider,HocuspocusProviderWebsocket} from "@hocuspocus/provider";

const root=mkdtempSync(path.join(os.tmpdir(),"metis-note-collab-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root,CHAT_PASSWORD:"",METIS_AI_BOOTSTRAP_PASSWORD:"",CHAT_LEGACY_HEADER_AUTH:"false"});
import {NoteCollaborationProvider,NoteCollaborationWebsocket} from "../lib/note-collaboration-provider";
const imports=Promise.all([import("../lib/auth"),import("../lib/projects"),import("../lib/project-sharing"),import("../lib/shared-context"),import("../lib/sqlite"),import("../lib/note-collaboration-store"),import("../lib/note-collaboration-server"),import("../lib/note-collaboration-document"),import("../app/api/notes/[id]/collaboration/route")]);
let modules:Awaited<typeof imports>,owner:{id:string;username:string},member:{id:string;username:string},stranger:{id:string;username:string},projectId:string,noteId:string,tokenA:string,tokenB:string;
let app:http.Server,wss:WebSocketServer,service:ReturnType<Awaited<typeof imports>[6]["createNoteCollaborationServer"]>,origin:string;
const peers:Array<{document:Y.Doc;provider:HocuspocusProvider;socket:HocuspocusProviderWebsocket}>=[];
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>boolean,label:string){for(let i=0;i<300;i++){if(check())return;await pause(10);}throw Error("Timed out: "+label);}
before(async()=>{
 modules=await imports;
 const [auth,projects,sharing,notes]=modules;
 owner=auth.createUser("collab-owner","fixture-password");member=auth.createUser("collab-member","fixture-password");stranger=auth.createUser("collab-other","fixture-password");
 tokenA=auth.authenticateUser(owner.username,"fixture-password")!.token;tokenB=auth.authenticateUser(member.username,"fixture-password")!.token;
 projectId=projects.createProject({ownerId:owner.id,name:"Live fixture",instructions:""}).id;
 noteId=notes.createNote({ownerId:owner.id,projectId,title:"Live",content:"Shared words.\n"}).id;
 const invite=sharing.inviteProjectMember(projectId,owner.id,member.username);sharing.respondProjectInvitation(invite.id,member.id,"accept");
 service=modules[6].createNoteCollaborationServer();
 app=http.createServer((_,res)=>res.writeHead(404).end());wss=new WebSocketServer({noServer:true,maxPayload:2*1024*1024});
 app.on("upgrade",(req,socket,head)=>wss.handleUpgrade(req,socket,head,ws=>modules[6].handleNoteCollaborationConnection(service,ws,req)));
 await new Promise<void>(resolve=>app.listen(0,"127.0.0.1",resolve));origin="http://127.0.0.1:"+(app.address() as {port:number}).port;
});
after(async()=>{
 for(const peer of peers){peer.provider.destroy();peer.socket.destroy();peer.document.destroy();}
 service.closeConnections();for(const socket of wss.clients)socket.terminate();for(const doc of service.documents.values())doc.destroy();service.documents.clear();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>app.close(()=>resolve()));
 modules[4].getDatabase().close();rmSync(root,{recursive:true,force:true});
});
function connect(user:{id:string;username:string},token:string,id=noteId){
 const session=modules[5].getNoteCollaborationSession(id,user)!;
 const document=new Y.Doc();Y.applyUpdate(document,Buffer.from(session.state,"base64"));
 class Socket extends WebSocket{constructor(url:string){super(url,{headers:{cookie:"ai_chat_auth="+token,origin}});}}
 const socket=new NoteCollaborationWebsocket({url:origin.replace("http","ws")+"/ws/notes",WebSocketPolyfill:Socket,autoConnect:false,maxAttempts:0,initialDelay:0});
 const provider=new NoteCollaborationProvider({websocketProvider:socket,name:session.documentName,document,token:"cookie-session",onClose:({event})=>{if(event.code>=4400)socket.disconnect();}});
 provider.attach();
 provider.awareness?.setLocalStateField("user",session.user);
 void socket.connect().catch(()=>{});
 const peer={document,provider,socket};peers.push(peer);return peer;
}
function text(document:Y.Doc){return modules[7].noteCollaborationMarkdown(document,50000);}
function insert(document:Y.Doc,value:string){
 const paragraph=document.getXmlFragment("default").toArray()[0] as Y.XmlElement;
 const node=paragraph.toArray()[0] as Y.XmlText;node.insert(0,value);
}
let a:ReturnType<typeof connect>,b:ReturnType<typeof connect>;
test("sessions are authenticated and retain existing project/private boundaries",async()=>{
 const response=await modules[8].GET(new Request(origin+"/api/notes/x/collaboration"),{params:Promise.resolve({id:noteId})});
 assert.equal(response.status,401);
 assert.equal(modules[5].getNoteCollaborationSession(noteId,stranger),null);
 const privateNote=modules[3].createNote({ownerId:owner.id,title:"Private",content:"Not shared"});
 assert.equal(modules[5].getNoteCollaborationSession(privateNote.id,member),null);
 const session=modules[5].getNoteCollaborationSession(noteId,owner)!;
 const clone=new Y.Doc();Y.applyUpdate(clone,Buffer.from(session.state,"base64"));assert.equal(text(clone),"Shared words.\n");clone.destroy();
});
test("two real WebSocket editors merge concurrent/offline updates and persist a restartable snapshot",async()=>{
 a=connect(owner,tokenA);b=connect(member,tokenB);
 await until(()=>a.provider.isSynced&&b.provider.isSynced,"initial sync");
 await until(()=>a.provider.awareness!.getStates().size===2,"both participants");
 a.socket.disconnect();await pause(50);
 insert(a.document,"ALPHA ");insert(b.document,"BETA ");
 await until(()=>modules[3].getNote(noteId,owner.id)!.content.includes("BETA"),"member persisted");
 void a.socket.connect().catch(()=>{});
 await until(()=>a.provider.isSynced&&!a.provider.hasUnsyncedChanges&&text(a.document)===text(b.document)&&text(a.document).includes("ALPHA")&&text(a.document).includes("BETA"),"merged edits");
 assert.equal(modules[3].getNote(noteId,owner.id)!.content,text(a.document));
 const snapshot=modules[5].noteCollaborationRow(noteId)!;
 const restored=new Y.Doc();Y.applyUpdate(restored,snapshot.state);assert.equal(text(restored),text(a.document));restored.destroy();
});
test("Markdown mode changes sync through the real server without losing other users' edits",async()=>{
 const before=text(a.document);
 modules[7].applyNoteCollaborationSource(a.document,before.replace("Shared words.","Shared words. SOURCE."));
 await until(()=>text(b.document).includes("SOURCE.")&&!a.provider.hasUnsyncedChanges,"source update saved");
 assert.match(text(b.document),/ALPHA/);assert.match(text(b.document),/BETA/);
 assert.equal(modules[3].getNote(noteId,owner.id)!.content,text(a.document));
});
test("save confirmation returns the actual durable note version",async()=>{
 const ticket="flush-fixture";
 let result:{requestId?:string;note?:{version:number}}|null=null;
 const callback=({payload}:{payload:string})=>{result=JSON.parse(payload);};
 a.provider.on("stateless",callback);a.provider.sendStateless(JSON.stringify({type:"flush",requestId:ticket}));
 await until(()=>result?.requestId===ticket,"save confirmation");a.provider.off("stateless",callback);
 assert.equal(result!.note!.version,modules[3].getNote(noteId,owner.id)!.version);
});
test("Shift+Enter and independent numbered lists persist over the real WebSocket without a fatal close",async()=>{
 const schema=getSchema(notesEditorExtensions());
 const paragraph=(value:string)=>({type:"paragraph",content:[{type:"text",text:value}]});
 const numbered=(value:string)=>({type:"orderedList",content:[{type:"listItem",content:[paragraph(value)]}]});
 const content=[{type:"paragraph",content:[{type:"text",text:"Before break"},{type:"hardBreak"}]},numbered("First list"),numbered("Second list")];
 prosemirrorJSONToYXmlFragment(schema,{type:"doc",content},a.document.getXmlFragment("default"));
 await until(()=>!a.provider.hasUnsyncedChanges&&text(a.document)===text(b.document)&&text(b.document).includes("Before break"),"lossless durable edit");
 assert.equal(a.provider.isSynced,true);assert.equal(b.provider.isSynced,true);
 const saved=modules[3].getNote(noteId,owner.id)!;
 assert.equal(saved.content,text(a.document));assert.match(saved.content,/metis-block/);
 const restored=new Y.Doc();Y.applyUpdate(restored,modules[5].noteCollaborationRow(noteId)!.state);
 assert.equal(text(restored),saved.content);restored.destroy();
});
test("oversized/unsupported edits are rejected before changing canonical Markdown",()=>{
 const session=modules[5].getNoteCollaborationSession(noteId,owner)!;
 const before=modules[3].getNote(noteId,owner.id)!.content;
 const document=new Y.Doc();Y.applyUpdate(document,Buffer.from(session.state,"base64"));const vector=Y.encodeStateVector(document);
 insert(document,"X".repeat(50001));
 assert.throws(()=>modules[5].commitNoteCollaborationUpdate(session.documentName,owner.id,Y.encodeStateAsUpdate(document,vector)),/full/);
 assert.equal(modules[3].getNote(noteId,owner.id)!.content,before);document.destroy();
});
test("revocation blocks both writes and outgoing document/awareness data on an existing socket",async()=>{
 const before=text(b.document);
 modules[4].getDatabase().prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").run(projectId,member.id);
 insert(a.document,"AFTERREVOCATION ");
 await until(()=>text(a.document).includes("AFTERREVOCATION")&&!a.provider.hasUnsyncedChanges,"owner saved");
 await pause(100);
 assert.equal(text(b.document),before);
 assert.equal(modules[5].getNoteCollaborationSession(noteId,member),null);
 assert.throws(()=>modules[5].commitNoteCollaborationUpdate(a.provider.configuration.name,member.id,new Uint8Array([0,0])),/Access/);
});
test("an authenticated stranger cannot subscribe to a private note or use an unrelated Origin",async()=>{
 const privateNote=modules[3].createNote({ownerId:owner.id,title:"Private transport",content:"Private fixture content"});
 const session=modules[5].getNoteCollaborationSession(privateNote.id,owner)!;
 const token=modules[0].authenticateUser(stranger.username,"fixture-password")!.token;
 const encoding=await import("lib0/encoding");
 const encode=()=>{const out=encoding.createEncoder();encoding.writeVarString(out,session.documentName);encoding.writeVarUint(out,2);encoding.writeVarUint(out,0);encoding.writeVarString(out,"cookie-session");return encoding.toUint8Array(out);};
 for(const headers of [{cookie:"ai_chat_auth="+token,origin},{cookie:"ai_chat_auth="+tokenA,origin:"https://unrelated.invalid"}]){
   const ws=new WebSocket(origin.replace("http","ws")+"/ws/notes",{headers});
   let messages=0;ws.on("message",()=>messages++);
   const closed=new Promise<number>(resolve=>ws.on("close",code=>resolve(code)));
   await new Promise<void>(resolve=>ws.once("open",()=>{ws.send(encode());resolve();}));
   assert.equal(await closed,4403);assert.equal(messages,0);
 }
});
test("participant identity and client broadcasts cannot be forged",async()=>{
 const privateNote=modules[3].createNote({ownerId:owner.id,title:"Presence fixture",content:"Original"});
 const peer=connect(owner,tokenA,privateNote.id);await until(()=>peer.provider.isSynced,"presence peer");
 const encoding=await import("lib0/encoding");
 const out=encoding.createEncoder();encoding.writeVarString(out,peer.provider.configuration.name);encoding.writeVarUint(out,6);encoding.writeVarString(out,JSON.stringify({type:"saved",note:{id:privateNote.id,content:"forged"}}));
 (peer.socket.webSocket as unknown as WebSocket).send(encoding.toUint8Array(out));
 await until(()=>!peer.provider.isSynced,"broadcast rejected");
 assert.equal(modules[3].getNote(privateNote.id,owner.id)!.content,"Original");
 const other=connect(owner,tokenA,privateNote.id);await until(()=>other.provider.isSynced,"presence sync");
 const presence=encoding.createEncoder();encoding.writeVarUint(presence,1);encoding.writeVarUint(presence,other.document.clientID);
 encoding.writeVarUint(presence,(other.provider.awareness!.meta.get(other.document.clientID)?.clock||0)+100);
 encoding.writeVarString(presence,JSON.stringify({user:{id:member.id,name:member.username,color:"#ff0000"}}));
 const packet=encoding.createEncoder();encoding.writeVarString(packet,other.provider.configuration.name);encoding.writeVarUint(packet,1);encoding.writeVarUint8Array(packet,encoding.toUint8Array(presence));
 (other.socket.webSocket as unknown as WebSocket).send(encoding.toUint8Array(packet));
 await until(()=>!other.provider.isSynced,"identity rejected");
 assert.equal(modules[3].getNote(privateNote.id,owner.id)!.content,"Original");
});
test("an external source replacement invalidates stale live writers instead of overwriting it",()=>{
 const oldName=a.provider.configuration.name;
 const current=modules[3].getNote(noteId,owner.id)!;
 modules[3].updateNote(noteId,{ownerId:owner.id,content:"External replacement\n",expectedVersion:current.version});
 assert.throws(()=>modules[5].commitNoteCollaborationUpdate(oldName,owner.id,new Uint8Array([0,0])),/changed outside/);
 const next=modules[5].getNoteCollaborationSession(noteId,owner)!;assert.notEqual(next.documentName,oldName);
 assert.equal(modules[3].getNote(noteId,owner.id)!.content,"External replacement\n");
});
