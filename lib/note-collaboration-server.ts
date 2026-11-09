import type { IncomingMessage as HttpRequest } from "node:http";
import { Hocuspocus, IncomingMessage, MessageType } from "@hocuspocus/server";
import { createDecoder, readVarUint, readVarString } from "lib0/decoding";
import { browserStreamOriginAllowed } from "./request-network";
import { getAccountProfile } from "./account-profile";
import * as Y from "yjs";
import type WebSocket from "ws";
import { getRequestAuthenticatedUser } from "./auth";
import { authorizeNoteCollaboration, commitNoteCollaborationUpdate } from "./note-collaboration-store";
import { MAX_NOTE_COLLAB_BYTES } from "./note-collaboration-document";

function webRequest(request:HttpRequest) {
  const headers=new Headers();for(const[key,value]of Object.entries(request.headers))if(typeof value==="string")headers.set(key,value);
  return new Request("http://notes.local"+(request.url||"/"),{headers});
}
export function createNoteCollaborationServer() {
  const server=new Hocuspocus({
    name:"Metis notes",quiet:true,maxDebounce:1000,debounce:250,
    async onAuthenticate({documentName,request}) {
      const user=getRequestAuthenticatedUser(webRequest(request));
      if(!user||!authorizeNoteCollaboration(documentName,user.id))throw Error("Note unavailable.");
      return {userId:user.id,userName:(getAccountProfile(user.id,user.username).displayName||user.username).slice(0,80)};
    },
    async onLoadDocument({documentName,context}) {
      const resolved=authorizeNoteCollaboration(documentName,String(context.userId||""));if(!resolved)throw Error("Note unavailable.");
      const document=new Y.Doc();Y.applyUpdate(document,resolved.row.state);return document;
    },
    async beforeHandleMessage({documentName,connection,update}) {
      const user=getRequestAuthenticatedUser(webRequest(connection.request));
      if(!user||!authorizeNoteCollaboration(documentName,user.id))throw {code:4403,reason:"Access revoked or document changed. Local changes are preserved."};
      if(update.byteLength>MAX_NOTE_COLLAB_BYTES)throw {code:4400,reason:"Document update is too large."};
      const message=new IncomingMessage(update);
      if(message.readVarString()!==documentName)throw Error("Invalid document.");
      const type=message.readVarUint();
      if(type===MessageType.BroadcastStateless)throw Error("Client broadcasts are not allowed.");
      if(type===MessageType.Stateless){
        const payload=JSON.parse(message.readVarString()) as {type?:string;requestId?:string};
        if(payload.type!=="flush"||typeof payload.requestId!=="string"||!/^[\w-]{1,80}$/.test(payload.requestId))throw Error("Invalid control message.");
      }
      if(type===MessageType.Awareness){
        const decoder=createDecoder(message.readVarUint8Array()),count=readVarUint(decoder);
        if(count>256)throw Error("Invalid presence message.");
        for(let index=0;index<count;index++){
          const clientId=readVarUint(decoder),clock=readVarUint(decoder);
          const encoded=readVarString(decoder);if(encoded.length>8192)throw Error("Presence is too large.");
          const state=JSON.parse(encoded) as {user?:{id?:string;name?:string;color?:string}}|null;
          const known=connection.document.awareness.getStates().get(clientId) ?? null;
          const meta=connection.document.awareness.meta.get(clientId);
          if(meta && clock<=meta.clock && JSON.stringify(state)===JSON.stringify(known))continue;
          const context=connection.context as {userId:string;userName:string;clientId?:number};
          if(context.clientId!==undefined&&context.clientId!==clientId)throw Error("Invalid presence identity.");
          if(connection.document.getConnections().some(other=>other!==connection&&(other.context as {clientId?:number}).clientId===clientId))throw Error("Presence identity is already in use.");
          if(state?.user&&(state.user.id!==user.id||state.user.name!==context.userName||!/^#[0-9a-f]{6}$/i.test(state.user.color||"")))throw Error("Invalid participant.");
          context.clientId=clientId;
        }
      }
      if(type===MessageType.Sync||type===MessageType.SyncReply){
        const syncType=message.readVarUint();
        if(syncType===1||syncType===2){
          try{commitNoteCollaborationUpdate(documentName,user.id,message.readVarUint8Array());}
          catch(error){throw {code:4409,reason:(error instanceof Error?error.message:"Could not save the document.").slice(0,120)};}
        }
      }
    },
    async onStateless({document,documentName,connection,payload}) {
      const user=getRequestAuthenticatedUser(webRequest(connection.request));
      const resolved=user&&authorizeNoteCollaboration(documentName,user.id);
      if(!resolved)return;
      const data=JSON.parse(payload) as {requestId:string};
      document.broadcastStateless(JSON.stringify({type:"saved",note:resolved.note,requestId:data.requestId}));
    },
    async onChange({document,documentName,context}) {
      const resolved=authorizeNoteCollaboration(documentName,String(context.userId||""));
      if(resolved)document.broadcastStateless(JSON.stringify({type:"saved",note:resolved.note}));
    },
  });
  return server;
}
/** Enforce current account/session/member access before every outgoing document frame. */
export function handleNoteCollaborationConnection(server:Hocuspocus,socket:WebSocket,request:HttpRequest) {
  if(!browserStreamOriginAllowed(request)||!getRequestAuthenticatedUser(webRequest(request))){socket.close(4403,"Note unavailable.");return;}
  const send=socket.send.bind(socket);
  socket.send=((data:Parameters<WebSocket["send"]>[0],...args:unknown[])=>{
    try{
      const name=new IncomingMessage(data).readVarString();
      const user=getRequestAuthenticatedUser(webRequest(request));
      if(!user||!authorizeNoteCollaboration(name,user.id)){socket.close(4403,"Note unavailable.");return;}
      Reflect.apply(send,socket,[data,...args]);
    }catch{socket.close(4403,"Note unavailable.");}
  }) as WebSocket["send"];
  server.handleConnection(socket,request);
}
