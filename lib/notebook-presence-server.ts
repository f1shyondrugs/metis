import {randomUUID} from "node:crypto";
import type {IncomingMessage} from "node:http";
import type WebSocket from "ws";
import {getRequestAuthenticatedUser} from "./auth";
import {browserStreamOriginAllowed} from "./request-network";
import {getDatabase} from "./sqlite";
import {canAccessProjectResource} from "./project-access";
import {noteParticipant,noteParticipantIdentity} from "./note-participant";
import {notebookView,type NotebookPerson,type NotebookPeer,type NotebookView} from "./notebook-presence";

type User={id:string;username:string};
type Meta={ownerId:string;projectId?:string;title:string;kind?:string;archived:number};
type Peer={id:string;socket:WebSocket;request:IncomingMessage;user:User;person:NotebookPerson;noteId:string|null;view:NotebookView;following:string|null;updated:number;pong:number;lastMessage:number;rateStart:number;rateCount:number};
function requestUser(request:IncomingMessage){
 const headers=new Headers();for(const [key,value]of Object.entries(request.headers))if(typeof value==="string")headers.set(key,value);
 return getRequestAuthenticatedUser(new Request("http://notes.local"+(request.url||"/"),{headers}));
}
function metadata(id:string):Meta|undefined{
 return getDatabase().prepare("SELECT owner_id AS ownerId,archived,json_extract(data,'$.projectId') AS projectId,json_extract(data,'$.title') AS title,json_extract(data,'$.kind') AS kind FROM notes WHERE id=?").get(id) as Meta|undefined;
}
function allowed(meta:Meta|undefined,viewer:string):meta is Meta{
 return !!meta&&!meta.archived&&meta.kind!=="learned_fact"&&canAccessProjectResource(meta.projectId,viewer,meta.ownerId);
}
/** Ephemeral, authenticated presence. Document text and edit authority stay in the CRDT channel. */
export function createNotebookPresenceServer(){
 const peers=new Map<string,Peer>();
 let profileCheck=Date.now(),closed=false;
 let pendingBroadcast:ReturnType<typeof setTimeout>|null=null;
 const authenticated=(peer:Peer)=>{
  const user=requestUser(peer.request);
  if(!user||user.id!==peer.user.id){peer.socket.close(4403,"Notebook presence unavailable.");return false;}
  peer.user=user;
  return true;
 };
 function send(peer:Peer,payload:unknown){
  if(peer.socket.readyState!==1||!authenticated(peer))return;
  if(peer.socket.bufferedAmount>256*1024){peer.socket.close(1013,"Presence connection is slow. Reconnect to continue.");return;}
  peer.socket.send(JSON.stringify(payload));
 }
 function visible(target:Peer,viewer:Peer,meta=target.noteId?metadata(target.noteId):undefined):NotebookPeer|null{
  if(!target.noteId||!allowed(meta,target.user.id)||!allowed(meta,viewer.user.id))return null;
  return {sessionId:target.id,user:target.person,note:{id:target.noteId,title:String(meta.title||"Untitled"), ...(meta.projectId?{projectId:meta.projectId}:{})},...(viewer.following===target.id?{view:target.view}:{})};
 }
 function snapshot(viewer:Peer,metas=new Map<string,Meta|undefined>()){
  const list:NotebookPeer[]=[];
  for(const target of [...peers.values()].sort((a,b)=>b.updated-a.updated)){
   if(!authenticated(target))continue;
   if(target.noteId&&!metas.has(target.noteId))metas.set(target.noteId,metadata(target.noteId));
   const item=visible(target,viewer,target.noteId?metas.get(target.noteId):undefined);
   if(item)list.push(item);
  }
  send(viewer,{type:"presence",sessionId:viewer.id,self:viewer.person,peers:list});
 }
 function broadcast(){
  if(closed||pendingBroadcast)return;
  pendingBroadcast=setTimeout(()=>{pendingBroadcast=null;const metas=new Map<string,Meta|undefined>();for(const peer of peers.values())snapshot(peer,metas);},30);
  pendingBroadcast.unref?.();
 }
 function stop(peer:Peer,message:string){peer.following=null;send(peer,{type:"follow-stopped",message});}
 function sendView(target:Peer){
  for(const viewer of peers.values())if(viewer.following===target.id){
   const item=visible(target,viewer);
   if(!item)stop(viewer,"This participant left or their note is unavailable.");
   else send(viewer,{type:"view",peer:{...item,view:target.view}});
  }
 }
 function handle(socket:WebSocket,request:IncomingMessage){
  const user=requestUser(request);
  if(!browserStreamOriginAllowed(request)||!user){socket.close(4403,"Notebook presence unavailable.");return;}
  if(peers.size>=128||[...peers.values()].filter(p=>p.user.id===user.id).length>=8){socket.close(4429,"Too many notebook sessions.");return;}
  const peer:Peer={id:randomUUID(),socket,request,user,person:noteParticipantIdentity(user),noteId:null,view:{scroll:0},following:null,updated:Date.now(),pong:Date.now(),lastMessage:0,rateStart:Date.now(),rateCount:0};
  peers.set(peer.id,peer);
  socket.on("pong",()=>{peer.pong=Date.now();});
  socket.on("message",data=>{
   try{
    if(!authenticated(peer))return;
    if(Date.now()-peer.rateStart>1000){peer.rateStart=Date.now();peer.rateCount=0;}
    if(++peer.rateCount>60){socket.close(4429,"Presence updates are too frequent.");return;}
    const bytes=Array.isArray(data)?Buffer.concat(data):Buffer.isBuffer(data)?data:Buffer.from(data);
    if(bytes.byteLength>4096)throw Error("Presence message is too large.");
    const body=JSON.parse(bytes.toString("utf8")) as Record<string,unknown>;
    if(!body||typeof body!=="object"||Array.isArray(body))throw Error("Invalid presence.");
    if(body.type==="update"){
     if(Object.keys(body).some(k=>!["type","noteId","view"].includes(k)))throw Error("Invalid identity fields.");
     if(body.noteId!==null&&(typeof body.noteId!=="string"||body.noteId.length>200))throw Error("Invalid note.");
     const view=notebookView(body.view);if(!view)throw Error("Invalid view.");
     if(Date.now()-peer.lastMessage<60&&peer.noteId===body.noteId)return; // At most ~16 position updates/s per connection.
     peer.lastMessage=Date.now();
     const id=body.noteId as string|null;
     if(id&&!allowed(metadata(id),user.id)){peer.noteId=null;broadcast();stop(peer,"This note is unavailable.");return;}
     const changed=peer.noteId!==id;
     peer.noteId=id;peer.view=view;peer.updated=Date.now();
     if(changed)broadcast();
     sendView(peer);
    }else if(body.type==="follow"){
     if(Object.keys(body).some(k=>!["type","sessionId"].includes(k))||body.sessionId!==null&&typeof body.sessionId!=="string")throw Error("Invalid follow request.");
     if(body.sessionId===null){peer.following=null;snapshot(peer);return;}
     const target=peers.get(body.sessionId as string);
     if(!target||!authenticated(target)||target.id===peer.id||target.user.id===user.id||!visible(target,peer)){stop(peer,"That participant is unavailable.");return;}
     const seen=new Set([peer.id]);let chain:Peer|undefined=target;
     while(chain){if(seen.has(chain.id)){stop(peer,"These participants are already following each other.");return;}seen.add(chain.id);chain=chain.following?peers.get(chain.following):undefined;}
     peer.following=target.id;snapshot(peer);sendView(target);
    }else throw Error("Invalid presence message.");
   }catch{socket.close(4400,"Invalid notebook presence message.");}
  });
  socket.on("close",()=>{peers.delete(peer.id);for(const viewer of peers.values())if(viewer.following===peer.id)stop(viewer,"This participant left the notebook.");broadcast();});
  socket.on("error",()=>{}); // The close lifecycle removes presence.
  snapshot(peer);
  void noteParticipant(user).then(person=>{if(peers.has(peer.id)){peer.person=person;broadcast();}});
 }
 const timer=setInterval(()=>{
  for(const peer of peers.values()){
   if(Date.now()-peer.pong>20000){peer.socket.terminate();continue;}
   if(authenticated(peer))peer.socket.ping();
   if(peer.noteId&&!allowed(metadata(peer.noteId),peer.user.id)){peer.noteId=null;stop(peer,"This note is unavailable.");}
   if(peer.following){const target=peers.get(peer.following);if(!target||!visible(target,peer))stop(peer,"This participant left or their note is unavailable.");}
  }
  broadcast();
  if(Date.now()-profileCheck>15000){
   profileCheck=Date.now();
   const users=[...new Map([...peers.values()].map(p=>[p.user.id,p.user])).values()];
   void Promise.all(users.map(user=>noteParticipant(user))).then(people=>{if(closed)return;for(const person of people)for(const peer of peers.values())if(peer.user.id===person.id)peer.person=person;broadcast();});
  }
 },5000);timer.unref?.();
 return {handle,refresh:broadcast,close(){closed=true;clearInterval(timer);if(pendingBroadcast)clearTimeout(pendingBroadcast);for(const peer of peers.values())peer.socket.close(1000,"Notebook presence stopped.");peers.clear();}};
}
