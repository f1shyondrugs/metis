import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import WebSocket,{WebSocketServer} from "ws";
import sharp from "sharp";
import {NotebookFollowNavigation,notebookView,uniqueNotebookPeers,type NotebookSnapshot,type NotebookPeer} from "../lib/notebook-presence";
test("pending follow navigation rejects rapid A-B-A responses, Stop and participant changes",async()=>{
 const navigation=new NotebookFollowNavigation();
 navigation.move("amy","alpha");
 const firstAlpha=navigation.capture();
 navigation.move("amy","beta");
 const beta=navigation.capture();
 navigation.move("amy","alpha");
 const latestAlpha=navigation.capture();
 // Resolve older requests after the latest request, as a slow network can do.
 const applied:string[]=[];
 for(const [label,allowed] of [["latest alpha",latestAlpha],["stale beta",beta],["stale alpha",firstAlpha]] as const)
  await Promise.resolve().then(()=>{if(allowed())applied.push(label);});
 assert.deepEqual(applied,["latest alpha"]);
 assert.equal(navigation.move("amy","alpha"),false,"same-note scroll does not invalidate a pending load");
 assert.equal(latestAlpha(),true);
 navigation.stop();assert.equal(latestAlpha(),false);
 navigation.move("amy","alpha");const amy=navigation.capture();
 navigation.move("ben","alpha");assert.equal(amy(),false);
 const ben=navigation.capture();navigation.stop();assert.equal(ben(),false);
});
const root=mkdtempSync(path.join(os.tmpdir(),"metis-notebook-presence-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root,CHAT_PASSWORD:"",METIS_AI_BOOTSTRAP_PASSWORD:"",CHAT_LEGACY_HEADER_AUTH:"false"});
const imports=Promise.all([import("../lib/auth"),import("../lib/projects"),import("../lib/project-sharing"),import("../lib/shared-context"),import("../lib/sqlite"),import("../lib/notebook-presence-server"),import("../lib/account-profile"),import("../lib/note-participant"),import("../app/api/notes/presence/avatar/[userId]/route")]);
let modules:Awaited<typeof imports>,app:http.Server,wss:WebSocketServer,service:ReturnType<Awaited<typeof imports>[5]["createNotebookPresenceServer"]>,origin:string;
type User={id:string;username:string};
let owner:User,member:User,stranger:User,projectId:string,noteA:string,noteB:string,privateNote:string,tokenA:string,tokenB:string,tokenC:string;
const sockets:WebSocket[]=[],pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>boolean,label:string){for(let i=0;i<250;i++){if(check())return;await pause(10);}throw Error("Timed out: "+label);}
type Client={socket:WebSocket;packets:Record<string,unknown>[];snapshot:()=>NotebookSnapshot|undefined;send:(body:unknown)=>void};
async function connect(token:string,customOrigin?:string):Promise<Client>{
 const socket=new WebSocket(origin.replace("http","ws")+"/ws/notes?presence=1",{headers:{cookie:"ai_chat_auth="+token,origin:customOrigin||origin}});
 sockets.push(socket);const packets:Record<string,unknown>[]=[];
 socket.on("message",data=>packets.push(JSON.parse(data.toString())));
 await new Promise<void>(resolve=>socket.once("open",resolve));
 return {socket,packets,snapshot:()=>packets.filter(p=>p.type==="presence").at(-1) as NotebookSnapshot|undefined,send:body=>socket.send(JSON.stringify(body))};
}
before(async()=>{
 modules=await imports;
 const [auth,projects,sharing,notes]=modules;
 owner=auth.createUser("presence-owner","fixture-password");member=auth.createUser("presence-member","fixture-password");stranger=auth.createUser("presence-stranger","fixture-password");
 tokenA=auth.authenticateUser(owner.username,"fixture-password")!.token;tokenB=auth.authenticateUser(member.username,"fixture-password")!.token;tokenC=auth.authenticateUser(stranger.username,"fixture-password")!.token;
 projectId=projects.createProject({ownerId:owner.id,name:"Presence fixture"}).id;
 const invite=sharing.inviteProjectMember(projectId,owner.id,member.username);sharing.respondProjectInvitation(invite.id,member.id,"accept");
 noteA=notes.createNote({ownerId:owner.id,projectId,title:"Shared Alpha",content:"VISIBLE_ALPHA_CONTENT"}).id;
 noteB=notes.createNote({ownerId:owner.id,projectId,title:"Shared Beta",content:"VISIBLE_BETA_CONTENT"}).id;
 privateNote=notes.createNote({ownerId:owner.id,title:"VERY_PRIVATE_NOTE",content:"PRIVATE_BODY_NEVER_BROADCAST"}).id;
 const png=await sharp({create:{width:64,height:64,channels:4,background:"#ef2222"}}).png().toBuffer();
 modules[6].saveAccountProfile(owner.id,{displayName:"Amy profile",bio:"Private biography",avatar:"data:image/png;base64,"+png.toString("base64"),links:[],sharing:false,shareActivity:false});
 service=modules[5].createNotebookPresenceServer();
 app=http.createServer((_,res)=>res.writeHead(404).end());wss=new WebSocketServer({noServer:true,maxPayload:8192});
 app.on("upgrade",(req,socket,head)=>wss.handleUpgrade(req,socket,head,ws=>service.handle(ws,req)));
 await new Promise<void>(resolve=>app.listen(0,"127.0.0.1",resolve));origin="http://127.0.0.1:"+(app.address() as {port:number}).port;
});
after(async()=>{
 service.close();for(const socket of sockets)socket.terminate();
 for(const socket of wss.clients)socket.terminate();
 await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>app.close(()=>resolve()));
 modules[4].getDatabase().close();rmSync(root,{recursive:true,force:true});
});
let a:Client,b:Client,c:Client;
test("cross-note presence uses canonical account profiles, exposes no document text and no strangers",async()=>{
 a=await connect(tokenA);b=await connect(tokenB);c=await connect(tokenC);
 await until(()=>!!a.snapshot()&&!!b.snapshot()&&!!c.snapshot(),"initial identities");
 a.send({type:"update",noteId:noteA,view:{scroll:.1}});b.send({type:"update",noteId:noteB,view:{scroll:.7}});
 await until(()=>!!b.snapshot()?.peers.find(p=>p.user.id===owner.id),"cross-note peer");
 const peer=b.snapshot()!.peers.find(p=>p.user.id===owner.id)!;
 assert.equal(peer.note.id,noteA);assert.equal(peer.user.username,owner.username);assert.equal(peer.user.name,"Amy profile");
 assert.ok(peer.user.avatar?.startsWith("/api/notes/presence/avatar/"+owner.id));assert.ok(!peer.user.avatar?.startsWith("data:"));
 await until(()=>{const color=b.snapshot()?.peers.find(p=>p.user.id===owner.id)?.user.color;return !!color&&parseInt(color.slice(1,3),16)>180&&parseInt(color.slice(3,5),16)<80;},"dominant profile color");
 assert.deepEqual(c.snapshot()!.peers,[]);
 assert.ok(!JSON.stringify(b.packets).includes("VISIBLE_ALPHA_CONTENT"));assert.ok(!JSON.stringify(b.packets).includes("Private biography"));
 assert.equal(peer.view,undefined,"Viewport is sent only to a follower");
 const offset=c.packets.length;c.send({type:"follow",sessionId:peer.sessionId});
 await until(()=>c.packets.slice(offset).some(p=>p.type==="follow-stopped"),"unauthorized follow rejected");
 assert.ok(!JSON.stringify(c.packets.slice(offset)).includes(noteA));
});
test("following receives scroll/click positions and continues across authorized note changes",async()=>{
 const target=b.snapshot()!.peers.find(p=>p.user.id===owner.id)!;
 b.send({type:"follow",sessionId:target.sessionId});
 await until(()=>b.packets.some(p=>p.type==="view"),"follow snapshot");
 await pause(80);a.send({type:"update",noteId:noteB,view:{scroll:.8,point:{x:.2,y:.4,seq:1}}});
 await until(()=>b.packets.some(p=>p.type==="view"&&(p.peer as NotebookPeer).note.id===noteB&&(p.peer as NotebookPeer).view?.scroll===.8),"follow other note");
 const view=b.packets.filter(p=>p.type==="view").at(-1)!.peer as NotebookPeer;
 assert.equal(view.user.id,owner.id);assert.deepEqual(view.view!.point,{x:.2,y:.4,seq:1});
 b.send({type:"follow",sessionId:null});await pause(80);
 const before=b.packets.filter(p=>p.type==="view").length;
 a.send({type:"update",noteId:noteB,view:{scroll:.3}});await pause(100);
 assert.equal(b.packets.filter(p=>p.type==="view").length,before);
});
test("mutual follow cycles are rejected without affecting document state",async()=>{
 const memberSession=a.snapshot()!.peers.find(p=>p.user.id===member.id)!;
 const ownerSession=b.snapshot()!.peers.find(p=>p.user.id===owner.id)!;
 a.send({type:"follow",sessionId:memberSession.sessionId});await pause(80);
 const offset=b.packets.length;b.send({type:"follow",sessionId:ownerSession.sessionId});
 await until(()=>b.packets.slice(offset).some(p=>p.type==="follow-stopped"),"follow cycle blocked");
 a.send({type:"follow",sessionId:null});await pause(80);
});
test("a private note transition stops follow without revealing its id, title, content or profile extras",async()=>{
 const target=b.snapshot()!.peers.find(p=>p.user.id===owner.id)!;b.send({type:"follow",sessionId:target.sessionId});await pause(90);
 const index=b.packets.length;
 a.send({type:"update",noteId:privateNote,view:{scroll:.5}});await until(()=>b.packets.slice(index).some(p=>p.type==="follow-stopped")&&!b.snapshot()?.peers.some(p=>p.user.id===owner.id),"private transition");
 const packets=JSON.stringify(b.packets.slice(index));
 assert.ok(!packets.includes(privateNote));assert.ok(!packets.includes("VERY_PRIVATE_NOTE"));assert.ok(!packets.includes("PRIVATE_BODY_NEVER_BROADCAST"));
 assert.ok(!b.snapshot()!.peers.some(p=>p.user.id===owner.id));
});
test("avatar image access is account/project scoped and revocation blocks both images and existing presence",async()=>{
 const route=modules[8],get=(token?:string,etag?:string)=>route.GET(new Request(origin+"/api/notes/presence/avatar/"+owner.id,{headers:{...(token?{cookie:"ai_chat_auth="+token}:{}),...(etag?{"if-none-match":etag}:{})}}),{params:Promise.resolve({userId:owner.id})});
 assert.equal((await get()).status,401);assert.equal((await get(tokenC)).status,404);
 const image=await get(tokenB);assert.equal(image.status,200);assert.equal(image.headers.get("content-type"),"image/png");
 assert.ok((await image.arrayBuffer()).byteLength>32);
 const etag=image.headers.get("etag")!;assert.equal((await get(tokenB,"W/"+etag)).status,304);
 a.send({type:"update",noteId:noteA,view:{scroll:.2}});await pause(90);
 modules[4].getDatabase().prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").run(projectId,member.id);
 service.refresh();await until(()=>!b.snapshot()?.peers.some(p=>p.user.id===owner.id),"revoked peer hidden");
 assert.equal((await get(tokenB,etag)).status,404);
});
test("client identity fields, unrelated origins and missing authentication are rejected",async()=>{
 const forge=await connect(tokenA);await until(()=>!!forge.snapshot(),"forgery ready");
 const close=new Promise<number>(resolve=>forge.socket.once("close",resolve));
 forge.send({type:"update",noteId:noteA,view:{scroll:0},user:{id:member.id,avatar:"https://tracker.invalid/"}});
 assert.equal(await close,4400);
 for(const [token,customOrigin]of [["",""],[tokenA,"https://unrelated.invalid"]]){
  const client=await connect(token,customOrigin||undefined);const code=await new Promise<number>(resolve=>client.socket.once("close",resolve));assert.equal(code,4403);assert.equal(client.packets.length,0);
 }
});
test("view inputs are bounded and account avatars are deduplicated deterministically",()=>{
 assert.equal(notebookView({scroll:Infinity}),null);assert.equal(notebookView({scroll:-1}),null);
 assert.equal(notebookView({scroll:.2,text:"secret"}),null);assert.equal(notebookView({scroll:.2,point:{x:2,y:0,seq:0}}),null);
 const one={sessionId:"one",user:{id:"other",name:"Name",username:"account",avatar:null,color:"#123456"},note:{id:"n",title:"N"}} satisfies NotebookPeer;
 assert.deepEqual(uniqueNotebookPeers([one,{...one,sessionId:"two"}, {...one,user:{...one.user,id:"self"}}],"self"),[one]);
});

test("following rechecks the target session immediately after logout",async()=>{
 const [auth,,sharing]=modules;
 const viewer=auth.createUser("logout-viewer","fixture-password");
 const invite=sharing.inviteProjectMember(projectId,owner.id,viewer.username);
 sharing.respondProjectInvitation(invite.id,viewer.id,"accept");
 const token=auth.authenticateUser(owner.username,"fixture-password")!.token;
 const target=await connect(token);
 await until(()=>!!target.snapshot(),"logout target connected");
 target.send({type:"update",noteId:noteA,view:{scroll:.4}});
 const watcher=await connect(auth.authenticateUser(viewer.username,"fixture-password")!.token);
 await until(()=>!!watcher.snapshot()?.peers.some(p=>p.sessionId===target.snapshot()!.sessionId),"logout target visible");
 auth.revokeRequestSession(new Request(origin,{headers:{cookie:"ai_chat_auth="+token}}));
 const offset=watcher.packets.length;
 watcher.send({type:"follow",sessionId:target.snapshot()!.sessionId});
 await until(()=>watcher.packets.slice(offset).some(p=>p.type==="follow-stopped"),"logged-out follow denied");
 assert.ok(!watcher.packets.slice(offset).some(p=>p.type==="view"));
});
test("profile updates invalidate avatar/color identity and crop color uses the selected image area",async()=>{
 const {withImageFraming}=await import("../lib/image-framing");
 const image=await sharp({create:{width:100,height:100,channels:4,background:"#ed2424"}})
 .composite([{input:await sharp({create:{width:50,height:100,channels:4,background:"#235ee8"}}).png().toBuffer(),left:50,top:0}]).png().toBuffer();
 const source="data:image/png;base64,"+image.toString("base64");
 const original=modules[7].noteParticipantIdentity(member);
 modules[6].saveAccountProfile(member.id,{displayName:"Ben crop",bio:"",avatar:withImageFraming(source,{mode:"crop",area:{x:50,y:0,width:50,height:100}}),links:[],sharing:false,shareActivity:false});
 const person=await modules[7].noteParticipant(member);
 assert.notEqual(person.avatar,original.avatar);assert.equal(person.username,member.username);
 assert.ok(parseInt(person.color.slice(5,7),16)>180&&parseInt(person.color.slice(1,3),16)<80);
 assert.ok(!person.avatar?.startsWith("data:"));
});
