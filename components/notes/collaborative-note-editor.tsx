"use client";
import { createClientId } from "@/lib/client-id";
import {useNotebookPresenceContext} from "./notebook-presence-context";
import {ProfileAvatar} from "@/components/account/account-menu";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { NoteCollaborationProvider, NoteCollaborationWebsocket } from "@/lib/note-collaboration-provider";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Download, RefreshCw, Users } from "lucide-react";
import { NotesBlockEditor, type NotesBlockEditorProps } from "./block-editor";
import { NOTE_COLLABORATION_PATH, type NoteCollaborationSession, type NoteCollaborationUser } from "@/lib/note-collaboration";
import { applyNoteCollaborationSource, NOTE_SOURCE_ORIGIN } from "@/lib/note-collaboration-document";
import type { TreeNote } from "@/lib/notes-tree";

type Props=NotesBlockEditorProps & {noteId:string;ownerId:string;onSaved:(note:TreeNote)=>void;registerFlush:(flush:(()=>Promise<boolean>)|null)=>void;onPending:(pending:boolean)=>void;registerApplySource:(apply:((source:string)=>void)|null)=>void};
type Client={document:Y.Doc;provider:HocuspocusProvider;session:NoteCollaborationSession};
export function CollaborativeNoteEditor(props:Props) {
  const notebook=useNotebookPresenceContext();
  const [client,setClient]=useState<Client|null>(null),[error,setError]=useState(""),[connected,setConnected]=useState(false),[fatal,setFatal]=useState(false);
  const [people,setPeople]=useState<NoteCollaborationUser[]>([]),[attempt,setAttempt]=useState(0),[previousDraft,setPreviousDraft]=useState("");
  const current=useRef(props);current.current=props;
  const latestDraft=useRef(props.value);
  const requestAcks=useRef(new Map<string,(ok:boolean)=>void>());
  useEffect(()=>{
    let active=true,provider:HocuspocusProvider|undefined,socket:NoteCollaborationWebsocket|undefined,document:Y.Doc|undefined,cache:IndexeddbPersistence|undefined;
    const controller=new AbortController();
    const acks=requestAcks.current;
    setClient(null);setError("");setFatal(false);setConnected(false);
    const receiveSaved=(value:unknown)=>{
      if(!value||typeof value!=="object")return;
      const data=value as {type?:string;note?:TreeNote;requestId?:string};
      if(data.type==="saved"&&data.note?.id===props.noteId&&typeof data.note.content==="string"&&Number.isInteger(data.note.version)) {
        current.current.onSaved(data.note);
        if(data.requestId){acks.get(data.requestId)?.(true);acks.delete(data.requestId);}
      }
    };
    void (async()=>{
      try{
        const response=await fetch("/api/notes/"+encodeURIComponent(props.noteId)+"/collaboration",{cache:"no-store",signal:controller.signal});
        if(!response.ok)throw Error("Could not open live editing. Check access and try again.");
        const session=await response.json() as NoteCollaborationSession;
        if(!active)return;
        document=new Y.Doc();Y.applyUpdate(document,Uint8Array.from(atob(session.state),char=>char.charCodeAt(0)));
        cache=new IndexeddbPersistence("metis:notes:"+props.ownerId+":"+session.documentName,document);
        await Promise.race([cache.whenSynced,new Promise(resolve=>setTimeout(resolve,1500))]);
        if(!active)return;
        const localDocument=document;
        socket=new NoteCollaborationWebsocket({url:(location.protocol==="https:"?"wss://":"ws://")+location.host+NOTE_COLLABORATION_PATH,autoConnect:false});
        provider=new NoteCollaborationProvider({
          websocketProvider:socket,
          name:session.documentName,document,token:"cookie-session",
          onStatus:({status})=>{if(active)setConnected(status==="connected");},
          onSynced:({state})=>{if(active&&state)setError("");},
          onUnsyncedChanges:({number})=>{if(active)current.current.onPending(number>0);},
          onAuthenticationFailed:()=>{if(active){setFatal(true);setError("Access is unavailable. Your local draft is kept on this device.");socket?.disconnect();}},
          onClose:({event})=>{if(active&&(event.code>=4400||event.code===1000&&Boolean(event.reason))){setFatal(true);setError(event.reason||"Live editing stopped. Your local draft is preserved.");socket?.disconnect();}},
          onAwarenessUpdate:({states})=>{
            if(!active)return;
            const users=new Map<string,NoteCollaborationUser>();
            for(const state of states){const user=state.user as NoteCollaborationUser|undefined;if(user?.id&&typeof user.name==="string"&&/^#[0-9a-f]{6}$/i.test(user.color))users.set(user.id,user);}
            setPeople([...users.values()]);
          },
          onStateless:({payload})=>{if(active){try{receiveSaved(JSON.parse(payload));}catch{/* Ignore malformed non-document messages. */}}},
        });
        provider.attach();void socket.connect().catch(()=>{if(active)setConnected(false);});
        setClient({document:localDocument,provider,session});

      }catch(cause){if(active&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Could not connect.");}
    })();
    return()=>{
      active=false;controller.abort();current.current.registerFlush(null);current.current.onPending(false);
      provider?.destroy();socket?.destroy();void cache?.destroy();document?.destroy();
      for(const resolve of acks.values())resolve(false);acks.clear();
    };
  },[props.noteId,props.ownerId,attempt]);

  const flush=useCallback(async()=>{
    if(!client)return true;
    if((fatal||!client.provider.isSynced)&&!client.provider.hasUnsyncedChanges)return true;
    if(fatal)return false;
    const deadline=Date.now()+8000;
    while(Date.now()<deadline){
      if(!client.provider.isSynced){setError("Reconnect before leaving. Your local changes stay on this device.");return false;}
      if(client.provider.hasUnsyncedChanges){await new Promise(resolve=>setTimeout(resolve,50));continue;}
      const requestId=createClientId();
      const saved=await new Promise<boolean>(resolve=>{
        const timer=setTimeout(()=>{requestAcks.current.delete(requestId);resolve(false);},3000);
        requestAcks.current.set(requestId,ok=>{clearTimeout(timer);resolve(ok);});
        client.provider.sendStateless(JSON.stringify({type:"flush",requestId}));
      });
      if(saved&&!client.provider.hasUnsyncedChanges)return true;
    }
    setError("The save has not been confirmed. Your local draft is preserved.");return false;
  },[client,fatal]);
  const registerFlush=props.registerFlush;
  useEffect(()=>{registerFlush(flush);return()=>registerFlush(null);},[flush,registerFlush]);
  useEffect(()=>{
    const unload=(event:BeforeUnloadEvent)=>{if(client?.provider.hasUnsyncedChanges){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",unload);return()=>window.removeEventListener("beforeunload",unload);
  },[client]);
  const collaboration=useMemo(()=>client?{
    extensions:[Collaboration.configure({document:client.document,field:"default",yUndoOptions:{trackedOrigins:[NOTE_SOURCE_ORIGIN]}}),CollaborationCaret.configure({provider:client.provider,user:client.session.user})],
    metadata:()=>client.document.getMap("metadata").toJSON(),
    applySource:(source:string)=>applyNoteCollaborationSource(client.document,source),
  }:undefined,[client]);
  const registerApplySource=props.registerApplySource;
  useEffect(()=>{registerApplySource(client&&!fatal?(source)=>applyNoteCollaborationSource(client.document,source):null);return()=>registerApplySource(null);},[client,fatal,registerApplySource]);
  const download=(text:string)=>{
    const url=URL.createObjectURL(new Blob([text],{type:"text/markdown;charset=utf-8"}));
    const anchor=window.document.createElement("a");anchor.href=url;anchor.download="note-draft.md";anchor.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  };
  const liveLabel=client?(connected&&!fatal?"Live editing":"Offline · draft kept on this device"):"Opening live editor…";
  useEffect(()=>{notebook?.reportEditor({noteId:props.noteId,label:liveLabel},props.noteId);return()=>notebook?.reportEditor(null,props.noteId);},[notebook,props.noteId,liveLabel]);
  return <div className="min-w-0" data-note-live-editor>
    {!notebook&&<div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 border-b border-border bg-background py-2 text-xs text-muted-foreground" role="status">
      <Users className="size-4" aria-hidden="true"/><span>{client?(connected&&!fatal?"Live editing":"Offline · draft kept on this device"):"Opening live editor…"}</span>
      <span className="ml-auto flex items-center -space-x-1">{people.map(person=><span key={person.id} title={person.name} aria-label={person.name} className="flex size-7 items-center justify-center rounded-full border-2 border-background text-[10px] text-white" style={{backgroundColor:person.color}}><ProfileAvatar profile={{displayName:person.name,avatar:person.avatar||null}} name={person.username||person.name} className="size-full"/></span>)}</span>
    </div>}
    {error&&<div role="alert" className="mb-3 rounded border border-border p-3 text-sm"><p>{error}</p><div className="mt-2 flex flex-wrap gap-2">
      <button type="button" className="inline-flex min-h-10 items-center gap-1 rounded border px-3" onClick={()=>download(latestDraft.current)}><Download className="size-3.5"/>Download local draft</button>
      <button type="button" className="inline-flex min-h-10 items-center gap-1 rounded border px-3" onClick={()=>{setPreviousDraft(latestDraft.current);setAttempt(value=>value+1);}}><RefreshCw className="size-3.5"/>Reconnect</button>
    </div></div>}
    {previousDraft&&<details className="mb-3 rounded border border-border p-3 text-xs"><summary>Previous local draft</summary><button type="button" className="my-2 min-h-10 underline" onClick={()=>download(previousDraft)}>Download previous draft</button><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{previousDraft}</pre></details>}
    {client&&collaboration?<NotesBlockEditor {...props} onChange={value=>{latestDraft.current=value;try{localStorage.setItem("metis:notes:live-draft:"+props.ownerId+":"+props.noteId,value);}catch{/* IndexedDB remains the primary draft store. */}props.onChange(value);}} key={client.session.documentName} collaboration={collaboration} disabled={props.disabled||fatal}/>:!error?<div role="status" className="min-h-40 p-3 text-sm text-muted-foreground">Connecting to the document…</div>:null}
  </div>;
}
