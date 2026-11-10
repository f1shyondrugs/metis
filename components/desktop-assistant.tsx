"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ExternalLink, LockKeyhole, Monitor, Square, X } from "lucide-react";
import { VoiceInput, type VoiceState } from "@/components/voice-input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { createClientId } from "@/lib/client-id";
import { assistantBridge, desktopCaptureContext } from "@/lib/desktop-assistant";
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
  const [chatId,setChatId]=useState<string|null>(null),[answer,setAnswer]=useState(""),[running,setRunning]=useState(false);
  const [device,setDevice]=useState(""),[cycle,setCycle]=useState(0),[settingsRevision,reloadSettings]=useState(0);
  const inputRef=useRef<HTMLTextAreaElement>(null),draft=useRef(""),revision=useRef(0),sending=useRef(false),live=useRef(true);
  const actionEpoch=useRef(0);
  const pendingSubmission=useRef<{chatId:string;messageId:string;message:string;referenceText:string;uploadIds:string[]}|null>(null);
  const recording=useRef(false),lastWave=useRef(0),panel=useRef<HTMLElement>(null);
  const gesture=useCallback((value:string)=>{
    if(value==="start"){setRequested(true);setLocked(false);}
    if(value==="stop")setRequested(false);
    if(value==="lock")setLocked(true);
    if(value==="cancel"){actionEpoch.current++;setRequested(false);setLocked(false);setCancelSignal(value=>value+1);}
    if(value==="open"){setCycle(value=>value+1);reloadSettings(value=>value+1);inputRef.current?.focus();}
  },[]);
  useEffect(()=>{
    live.current=true;
    const bridge=assistantBridge();setAvailable(Boolean(bridge));
    if(!bridge)return;
    const unsubscribe=bridge.onGesture(gesture);
    void bridge.ready().then(state=>{setDevice(state.device.hostname);state.gestures.forEach(gesture);}).catch(()=>setError("Could not connect to the desktop app. Reopen the assistant."));
    return ()=>{live.current=false;unsubscribe();bridge.voice({recording:false,level:0});};
  },[gesture]);
  useEffect(()=>{
    if(!available)return;
    let active=true;
    void json("/api/preferences").then(body=>{if(active){setVoice(body.settings.voiceInput||null);setError("");}}).catch(cause=>{if(active)setError(cause.message);});
    return ()=>{active=false;};
  },[available,settingsRevision]);
  useEffect(()=>{
    if(!available||!panel.current)return;
    const observer=new ResizeObserver(()=>{const height=panel.current?.scrollHeight;if(height)void assistantBridge()?.resize?.(height+16);});
    observer.observe(panel.current);return ()=>observer.disconnect();
  },[available,cycle]);
  const configured=Boolean(voice?.enabled&&(voice.provider==="browser"||voice.connectionId));
  useEffect(()=>{if(available)assistantBridge()?.voice({recording:recording.current,level:0,status:running?"Metis is working":configured?"Metis Assistant":"Voice is not configured"});},[available,configured,running]);
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
    draft.current=next;setInput(next);inputRef.current?.focus();
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
        const last=[...messages].reverse().find((message:{role:string})=>message.role==="assistant");
        if(last)setAnswer(last.content||"");
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
      setAnswer("");setRunning(true);
    }catch(cause){uploads.forEach(cancelUpload);setError(cause instanceof Error?cause.message:"Could not send. Your draft is preserved.");}
    finally{sending.current=false;setBusy(false);}
  }
  if(!available)return <main className="desktop-assistant assistant-fallback">Open Desktop Assistant from the Metis desktop app.</main>;
  return <TooltipProvider><main key={cycle} className="desktop-assistant" onKeyDown={event=>{if(event.key==="Escape")void assistantBridge()?.close();}}>
    <section ref={panel} className="assistant-panel" aria-label="Metis Desktop Assistant">
      <header className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span role="status" className="flex-1 text-xs font-medium">{recording.current?"Metis is listening":busy?"Capturing screen context…":running?"Metis is working":configured?"Metis Assistant":"Voice is not configured"}</span>
        {locked?<span className="flex items-center gap-1 text-xs text-muted-foreground"><LockKeyhole className="size-3"/>Locked</span>:null}
        <Button size="icon-action" variant="ghost" aria-label="Open in Metis" onClick={()=>void assistantBridge()?.openChat(chatId)}><ExternalLink className="size-4"/></Button>
        <Button size="icon-action" variant="ghost" aria-label="Close assistant" onClick={()=>void assistantBridge()?.close()}><X className="size-4"/></Button>
      </header>
      {answer?<div className="assistant-answer px-4 py-2"><Markdown content={answer} streaming={running}/></div>:null}
      {error?<div role="alert" className="px-4 pb-2 text-xs text-destructive">{error}<button className="ml-2 underline" onClick={()=>reloadSettings(value=>value+1)}>Reload settings</button></div>:null}
      {voice?.realtime&&preview?<p role="status" aria-label="Live transcription" className="max-h-32 overflow-y-auto whitespace-pre-wrap px-4 pb-2 text-sm">{preview}</p>:null}
      <form className="flex items-end gap-2 px-3 pb-3" onSubmit={event=>{event.preventDefault();void send();}}>
        <textarea ref={inputRef} aria-label="Message Metis" placeholder="Ask Metis about your screen…" rows={2} value={input}
          className="max-h-40 min-h-16 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none"
          onChange={event=>{revision.current++;draft.current=event.target.value;setInput(event.target.value);}}
          onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/>
        {configured&&voice?<VoiceInput {...voice} chatId={chatId} captureRequested={requested} stopSignal={voiceStop} cancelSignal={cancelSignal} onTranscript={onTranscript} onStateChange={onVoiceState} onPreviewChange={setPreview} onWaveformLevelChange={onLevel}/>:null}
        {voiceState==="recording"?<Button type="button" size="icon-action" variant="outline" aria-label="Stop assistant recording" onClick={()=>{setRequested(false);setVoiceStop(value=>value+1);}}><Square className="size-4"/></Button>:null}
        <Button type="submit" size="icon-action" aria-label="Send message with all monitors" disabled={(!input.trim()&&!pendingSubmission.current)||busy||running||["permission","recording","uploading","transcribing"].includes(voiceState)}><ArrowUp className="size-4"/></Button>
      </form>
      <footer className="flex items-center gap-2 border-t border-border px-4 py-2 text-[11px] text-muted-foreground"><Monitor className="size-3"/><span>{device} · All monitors included on send</span></footer>
    </section>
  </main></TooltipProvider>;
}
