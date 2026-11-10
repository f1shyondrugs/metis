"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, LockKeyhole, LoaderCircle, Square, X } from "lucide-react";
import { VoiceInput, type VoiceState } from "@/components/voice-input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { desktopShortcutLabel } from "@/lib/desktop-shortcuts";
import { createClientId } from "@/lib/client-id";
import { assistantBridge, desktopCaptureContext, type DesktopShortcuts } from "@/lib/desktop-assistant";
import type { VoiceInputSettings } from "@/lib/store";
import { startUpload, waitForUpload, cancelUpload, getUploadStatus } from "@/lib/background-uploads";
import "./desktop-assistant.css";

async function json(url:string,init?:RequestInit) {
  const response=await fetch(url,{cache:"no-store",...init});
  const body=await response.json();
  if(!response.ok)throw new Error(response.status===401?"Sign in to Metis in the main app first.":body.error||"Request failed. Try again.");
  return body;
}
export function DesktopAssistant() {
  const [available,setAvailable]=useState(false),[voice,setVoice]=useState<VoiceInputSettings|null>(null);
  const [input,setInput]=useState(""),[preview,setPreview]=useState(""),[requested,setRequested]=useState(false);
  const [locked,setLocked]=useState(false),[voiceState,setVoiceState]=useState<VoiceState>("idle");
  const [voiceStop,setVoiceStop]=useState(0);
  const [cancelSignal,setCancelSignal]=useState(0),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [chatId,setChatId]=useState<string|null>(null),[running,setRunning]=useState(false);
  const [messages,setMessages]=useState<Array<{id:string;role:"user"|"assistant";content:string}>>([]);
  const [editing,setEditing]=useState(false),[focusEpoch,setFocusEpoch]=useState(0),[settingsLoaded,setSettingsLoaded]=useState(false);
  const [shortcuts,setShortcuts]=useState<DesktopShortcuts|null>(null),[devicePlatform,setDevicePlatform]=useState("");
  const pendingMessageId=useRef<string|null>(null),editingRef=useRef(false),focusRevision=useRef(0);
  const [device,setDevice]=useState(""),[cycle,setCycle]=useState(0),[settingsRevision,reloadSettings]=useState(0);
  const inputRef=useRef<HTMLTextAreaElement>(null),draft=useRef(""),revision=useRef(0),sending=useRef(false),live=useRef(true);
  const actionEpoch=useRef(0);
  const pendingSubmission=useRef<{chatId:string;messageId:string;message:string;referenceText:string;uploadIds:string[]}|null>(null);
  const recording=useRef(false),lastWave=useRef(0),panel=useRef<HTMLElement>(null);
  const gesture=useCallback((value:string)=>{
    if(value==="start"){setRequested(true);setLocked(false);}
    if(value==="stop"){setRequested(false);setVoiceStop(value=>value+1);}
    if(value==="lock")setLocked(true);
    if(value==="cancel"){actionEpoch.current++;setRequested(false);setLocked(false);setCancelSignal(value=>value+1);}
    if(value==="open"){setCycle(value=>value+1);reloadSettings(value=>value+1);}
    if(value==="shortcuts-changed")reloadSettings(value=>value+1);
    if(value==="focus-input"){focusRevision.current++;editingRef.current=true;setEditing(true);setFocusEpoch(value=>value+1);}
    if(value==="passive"){focusRevision.current++;editingRef.current=false;setEditing(false);inputRef.current?.blur();}
  },[]);
  useEffect(()=>{
    live.current=true;
    const bridge=assistantBridge();setAvailable(Boolean(bridge));
    if(!bridge)return;
    const unsubscribe=bridge.onGesture(gesture);
    void bridge.ready().then(state=>{setDevice(state.device.hostname);setDevicePlatform(state.device.platform);if(state.shortcuts)setShortcuts(state.shortcuts);setEditing(Boolean(state.editing));editingRef.current=Boolean(state.editing);state.gestures.forEach(gesture);}).catch(()=>setError("Could not connect to the desktop app. Reopen the assistant."));
    return ()=>{live.current=false;unsubscribe();bridge.voice({recording:false,level:0});};
  },[gesture]);
  useEffect(()=>{
    if(!available)return;
    let active=true;
    void json("/api/preferences").then(body=>{if(active){setVoice(body.settings.voiceInput||null);setError("");}}).catch(cause=>{if(active)setError(cause.message);}).finally(()=>{if(active)setSettingsLoaded(true);});
    return ()=>{active=false;};
  },[available,settingsRevision]);
  useEffect(()=>{
    if(!available||!editing)return;
    const frame=requestAnimationFrame(()=>inputRef.current?.focus());
    return ()=>cancelAnimationFrame(frame);
  },[available,editing,focusEpoch]);
  useEffect(()=>{
    if(!available||!panel.current||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const animation=panel.current.animate([{opacity:0,transform:"translateY(16px)"},{opacity:1,transform:"translateY(0)"}],{duration:320,easing:"cubic-bezier(.2,.7,.2,1)"});
    return ()=>animation.cancel();
  },[available,cycle]);
  const configured=Boolean(voice?.enabled&&(voice.provider==="browser"||voice.connectionId));
  useEffect(()=>{
    if(!available||!settingsLoaded)return;
    let active=true;
    const bridge=assistantBridge();
    if(!bridge?.configure){setEditing(true);editingRef.current=true;setFocusEpoch(value=>value+1);return;}
    const revision=focusRevision.current;
    void bridge.configure({voiceConfigured:configured,chatId}).then(value=>{
      if(active){if(focusRevision.current===revision){setEditing(value.editing);editingRef.current=value.editing;}setShortcuts(value.shortcuts);}
    }).catch(()=>{if(active)setError("Could not update the assistant input mode.");});
    return ()=>{active=false;};
  },[available,settingsLoaded,configured,chatId,cycle,settingsRevision]);
  useEffect(()=>{if(available)assistantBridge()?.voice({recording:recording.current,level:0,status:running?"Metis is working":configured?"Metis Assistant":"Voice is not configured"});},[available,configured,running,cycle]);
  const onVoiceState=useCallback((state:VoiceState)=>{
    const wasRecording=recording.current;
    setVoiceState(state);recording.current=state==="recording";
    if((wasRecording&&state!=="recording")||state==="error"){setRequested(false);setLocked(false);}
    assistantBridge()?.voice({recording:state==="recording",level:0});
  },[]);
  const onLevel=useCallback((level:number)=>{
    const now=performance.now();if(now-lastWave.current<40&&level!==0)return;
    lastWave.current=now;assistantBridge()?.voice({recording:recording.current,level});
  },[]);
  const onTranscript=useCallback((text:string)=>{
    const initial=draft.current,atRevision=revision.current;
    const next=[initial,text].filter(Boolean).join(" ");
    draft.current=next;setInput(next);if(editingRef.current)inputRef.current?.focus();
    return (final:string)=>{
      if(!live.current||revision.current!==atRevision||draft.current!==next)return;
      const updated=[initial,final].filter(Boolean).join(" ");draft.current=updated;setInput(updated);
    };
  },[]);
  useEffect(()=>{
    if(!chatId||!running)return;
    let cancelled=false,timer:ReturnType<typeof setTimeout>;
    const controller=new AbortController();
    const poll=async()=>{
      try{
        const body=await json("/api/chats/"+encodeURIComponent(chatId)+"?messageLimit=6",{signal:controller.signal});
        if(cancelled)return;
        const messages=body.chat.messages||[];
        const items=messages.filter((message:{role:string})=>message.role==="user"||message.role==="assistant").map((message:{id:string;role:"user"|"assistant";content:string})=>({id:message.id,role:message.role,content:message.content||""}));
        if(!pendingMessageId.current||items.some((message:{id:string})=>message.id===pendingMessageId.current)){pendingMessageId.current=null;setMessages(items);}
        const status=body.chat.runStatus;
        if(status&&!["running","queued"].includes(status)){setRunning(false);return;}
      }catch(cause){if(!cancelled)setError(cause instanceof Error?cause.message:"Could not load the answer.");}
      if(!cancelled)timer=setTimeout(()=>void poll(),1500);
    };
    void poll();return ()=>{cancelled=true;controller.abort();clearTimeout(timer);};
  },[chatId,running]);
  async function send(){
    const text=draft.current.trim(),bridge=assistantBridge();
    if((!text&&!pendingSubmission.current)||!bridge||sending.current||running)return;
    const epoch=actionEpoch.current;
    sending.current=true;setBusy(true);setError("");
    const uploads:string[]=[];
    try{
      if(!pendingSubmission.current){
      await bridge.focusInput?.(false);
      const capture=await bridge.capture();
      if(actionEpoch.current!==epoch)throw new Error("Message cancelled before submission. Your draft is preserved.");
      let id=chatId;
      if(!id){id=(await json("/api/chats",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"Desktop Assistant · "+device})})).chat.id;setChatId(id);}
      const ids:string[]=[];
      for(const [index,monitor] of capture.monitors.entries()){
        const blob=await (await fetch(monitor.image)).blob();
        const task=startUpload(new File([blob],"Monitor-"+(index+1)+"-"+monitor.id+".png",{type:"image/png"}),{label:"Desktop Assistant"});
        uploads.push(task);
        // waitForUpload intentionally remains pending on recoverable errors;
        // the assistant exposes that failure and lets the user retry the message.
        const result=await new Promise<{id:string}>((resolve,reject)=>{
          const timer=setInterval(()=>{if(getUploadStatus(task)==="error"){clearInterval(timer);cancelUpload(task);reject(new Error("Screen upload failed. Retry the message."));}},200);
          void waitForUpload(task).then(value=>{clearInterval(timer);resolve(value);},cause=>{clearInterval(timer);reject(cause);});
        });
        ids.push(result.id);
      }
      pendingSubmission.current={chatId:id!,messageId:createClientId(),message:text,referenceText:desktopCaptureContext(capture),uploadIds:ids};
      }
      if(actionEpoch.current!==epoch)throw new Error("Message cancelled before submission. Your draft is preserved.");
      const submission=pendingSubmission.current;
      await json("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(submission)});
      pendingSubmission.current=null;
      if(draft.current.trim()===submission.message){revision.current++;draft.current="";setInput("");}
      pendingMessageId.current=submission.messageId;
      setMessages(current=>[...current,{id:submission.messageId,role:"user" as const,content:submission.message}].slice(-6));
      setRunning(true);
    }catch(cause){uploads.forEach(cancelUpload);setError(cause instanceof Error?cause.message:"Could not send. Your draft is preserved.");}
    finally{sending.current=false;setBusy(false);}
  }
  if(!available)return <main className="desktop-assistant assistant-fallback">Open Desktop Assistant from the Metis desktop app.</main>;
  const keyLabel=(value:string|undefined)=>value?desktopShortcutLabel(value,devicePlatform):"";
  return <TooltipProvider><main className="desktop-assistant" data-editing={editing}
    onPointerDown={event=>{if(event.target===event.currentTarget)void assistantBridge()?.focusInput?.(false);}}>
    {messages.length||running?<aside className="assistant-conversation assistant-surface" aria-label="Desktop conversation">
      <header className="assistant-conversation-header">
        <span className="text-xs font-medium">Metis</span>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon-action" variant="ghost" aria-label="Open in Metis"
            title={shortcuts?"Open chat · "+keyLabel(shortcuts.openChat):"Open chat"}
            onClick={()=>void assistantBridge()?.openChat(chatId)}><ArrowUpRight className="size-4"/></Button>
          <Button type="button" size="icon-action" variant="ghost" aria-label="Close assistant"
            onClick={()=>void assistantBridge()?.close()}><X className="size-4"/></Button>
        </div>
      </header>
      <div className="assistant-messages" role="log" aria-label="Conversation">
        {messages.map(message=><div key={message.id} className={"assistant-message assistant-message-"+message.role}
          aria-label={message.role==="user"?"Your message":"Metis reply"}>
          {message.role==="user"?<p>{message.content}</p>:<Markdown content={message.content} streaming={running&&message.id===messages.at(-1)?.id}/>}
        </div>)}
        {running&&!messages.at(-1)?.content||running&&messages.at(-1)?.role==="user"?<div role="status" className="assistant-working"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true"/>Metis is working…</div>:null}
      </div>
    </aside>:null}
    <div className="assistant-compose">
      <section ref={panel} className="assistant-input assistant-surface" aria-label="Metis Desktop Assistant">
        {error?<div role="alert" className="assistant-error">{error}<button type="button" onClick={()=>reloadSettings(value=>value+1)}>Retry</button></div>:null}
        {voice?.realtime&&preview?<p role="status" aria-label="Live transcription" className="assistant-transcript">{preview}</p>:null}
        <form className="assistant-form" onSubmit={event=>{event.preventDefault();void send();}}>
          <textarea ref={inputRef} aria-label="Message Metis" placeholder="Ask Metis" rows={1} value={input}
            onFocus={()=>{if(!editing)void assistantBridge()?.focusInput?.(true);}}
            onChange={event=>{revision.current++;draft.current=event.target.value;setInput(event.target.value);}}
            onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/>
          {configured&&voice?<VoiceInput {...voice} chatId={chatId} captureRequested={requested} stopSignal={voiceStop} cancelSignal={cancelSignal}
            onTranscript={onTranscript} onStateChange={onVoiceState} onPreviewChange={setPreview} onWaveformLevelChange={onLevel}/>:null}
          {voiceState==="recording"?<Button type="button" size="icon-action" variant="ghost" aria-label="Stop assistant recording"
            onClick={()=>{setRequested(false);setVoiceStop(value=>value+1);}}><Square className="size-3.5"/></Button>:null}
          <Button type="submit" size="icon-action" variant="ghost" aria-label="Send message with all monitors"
            disabled={(!input.trim()&&!pendingSubmission.current)||busy||running||["permission","recording","uploading","transcribing"].includes(voiceState)}>
            {busy?<LoaderCircle className="size-4 animate-spin"/>:<ArrowUp className="size-4"/>}
          </Button>
        </form>
      </section>
      {configured?<div className="assistant-hint">
        {locked?<span className="inline-flex items-center gap-1"><LockKeyhole className="size-3" aria-hidden="true"/>Locked</span>:null}
        {shortcuts?<span><kbd>{keyLabel(shortcuts.focusInput)}</kbd> {editing?"to return to your app":"to type"}</span>:null}
      </div>:null}
    </div>
  </main></TooltipProvider>;
}
