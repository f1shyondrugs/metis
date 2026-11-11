"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, LoaderCircle, Square, X } from "lucide-react";
import { VoiceInput, type VoiceState } from "@/components/voice-input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { ModelPicker } from "@/components/model-picker";
import type { ModelInfo } from "@/components/settings-panel";
import { desktopShortcutLabel } from "@/lib/desktop-shortcuts";
import { createClientId } from "@/lib/client-id";
import { assistantBridge, desktopCaptureContext, type DesktopShortcuts } from "@/lib/desktop-assistant";
import { latestClientModelSelection, rememberClientModelSelection, MODEL_STORAGE_KEY, type ClientModelPreferences } from "@/lib/client-model-selection";
import { modelForSelection } from "@/lib/model-selection";
import { defaultParamsForModel, sanitizeModelParams, type ModelParamSelection } from "@/lib/model-params";
import type { VoiceInputSettings } from "@/lib/store";
import { startUpload, waitForUpload, cancelUpload, getUploadStatus } from "@/lib/background-uploads";
import "./desktop-assistant.css";

async function json(url:string,init?:RequestInit) {
  const response=await fetch(url,{cache:"no-store",...init});
  const body=await response.json();
  if(!response.ok)throw new Error(response.status===401?"Sign in to Metis in the main app first.":body.error||"Request failed. Try again.");
  return body;
}
type Selection={modelId:string;modelParams:ModelParamSelection[]};
type Message={id:string;role:"user"|"assistant";content:string;errorMessage?:string};
type AutomaticSend={epoch:number;revision:number;focusRevision:number};
export function DesktopAssistant() {
  const [available,setAvailable]=useState(false),[voice,setVoice]=useState<VoiceInputSettings|null>(null);
  const [input,setInput]=useState(""),[preview,setPreview]=useState(""),[requested,setRequested]=useState(false);
  const [voiceState,setVoiceState]=useState<VoiceState>("idle"),[voiceStop,setVoiceStop]=useState(0);
  const [cancelSignal,setCancelSignal]=useState(0),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [chatId,setChatId]=useState<string|null>(null),[running,setRunning]=useState(false),[jobId,setJobId]=useState<string|null>(null);
  const [messages,setMessages]=useState<Message[]>([]);
  const [editing,setEditing]=useState(false),[focusEpoch,setFocusEpoch]=useState(0),[settingsLoaded,setSettingsLoaded]=useState(false);
  const [shortcuts,setShortcuts]=useState<DesktopShortcuts|null>(null),[devicePlatform,setDevicePlatform]=useState("");
  const [device,setDevice]=useState(""),[cycle,setCycle]=useState(0),[settingsRevision,reloadSettings]=useState(0);
  const [models,setModels]=useState<ModelInfo[]>([]),[selection,setSelection]=useState<Selection|null>(null),[favorites,setFavorites]=useState<string[]>([]);
  const [modelSaving,setModelSaving]=useState(false),[modelMenuOpen,setModelMenuOpen]=useState(false),[modelsLoaded,setModelsLoaded]=useState(false),[finalizedRevision,setFinalizedRevision]=useState(0);
  const [pollError,setPollError]=useState(""),[runProblem,setRunProblem]=useState(""),[runRevision,retryRun]=useState(0),[runLabel,setRunLabel]=useState("Metis is working…");
  const preferences=useRef<ClientModelPreferences>({}),modelRevision=useRef(0),modelSavingRef=useRef(false),modelMenuOpenRef=useRef(false);
  const editingRef=useRef(false),focusRevision=useRef(0),runActive=useRef(false),transcriptionPending=useRef(false);
  const inputRef=useRef<HTMLTextAreaElement>(null),draft=useRef(""),revision=useRef(0),sending=useRef(false),live=useRef(true);
  const actionEpoch=useRef(0),sendRef=useRef<(automatic?:AutomaticSend)=>Promise<void>>(async()=>{});
  const autoCapture=useRef<{epoch:number;revision:number;manual:boolean;expected:string|null}|null>(null);
  const pendingSubmission=useRef<(Selection&{chatId:string;messageId:string;message:string;referenceText:string;uploadIds:string[]})|null>(null);
  const recording=useRef(false),lastWave=useRef(0),panel=useRef<HTMLElement>(null);
  const gesture=useCallback((value:string)=>{
    if(value==="start"&&!runActive.current&&!sending.current)setRequested(true);
    if(value==="stop"){setRequested(false);setVoiceStop(value=>value+1);}
    if(value==="cancel"){actionEpoch.current++;autoCapture.current=null;transcriptionPending.current=false;setRequested(false);setCancelSignal(value=>value+1);}
    if(value==="open"){setCycle(value=>value+1);reloadSettings(value=>value+1);}
    if(value==="shortcuts-changed")reloadSettings(value=>value+1);
    if(value==="focus-input"){
      focusRevision.current++;editingRef.current=true;if(autoCapture.current)autoCapture.current.manual=true;
      setEditing(true);if(!modelMenuOpenRef.current)setFocusEpoch(value=>value+1);
    }
    if(value==="passive"){focusRevision.current++;editingRef.current=false;setEditing(false);inputRef.current?.blur();}
  },[]);
  useEffect(()=>{
    live.current=true;
    const bridge=assistantBridge();setAvailable(Boolean(bridge));
    if(!bridge)return;
    const unsubscribe=bridge.onGesture(gesture);
    void bridge.ready().then(state=>{
      if(!live.current)return;
      setDevice(state.device.hostname);setDevicePlatform(state.device.platform);
      if(state.shortcuts)setShortcuts(state.shortcuts);
      setEditing(Boolean(state.editing));editingRef.current=Boolean(state.editing);state.gestures.forEach(gesture);
    }).catch(()=>setError("Could not connect to the desktop app. Reopen the assistant."));
    return ()=>{live.current=false;unsubscribe();bridge.voice({recording:false,level:0});};
  },[gesture]);
  useEffect(()=>{
    if(!available)return;
    let active=true;const atRevision=modelRevision.current;
    const loadPreferences=json("/api/preferences").then(body=>{
      if(active){setVoice(body.settings.voiceInput||null);preferences.current=body.settings;setFavorites(body.settings.favoriteModelKeys||[]);setSettingsLoaded(true);}
      return body;
    });
    void Promise.all([loadPreferences,json("/api/models")]).then(([body,data])=>{
      if(!active)return;
      if(!Array.isArray(data.models))throw new Error("Could not load models.");
      setModels(data.models);
      if(modelRevision.current===atRevision&&!runActive.current)setSelection(latestClientModelSelection(data.models,body.settings,localStorage));
      setError("");
    }).catch(cause=>{if(active)setError(cause.message);}).finally(()=>{if(active){setSettingsLoaded(true);setModelsLoaded(true);}});
    const sync=(event:StorageEvent)=>{if(event.key===MODEL_STORAGE_KEY)reloadSettings(value=>value+1);};
    window.addEventListener("storage",sync);
    return ()=>{active=false;window.removeEventListener("storage",sync);};
  },[available,settingsRevision]);
  useEffect(()=>{
    if(!available||!editing||modelMenuOpen)return;
    const frame=requestAnimationFrame(()=>inputRef.current?.focus());
    return ()=>cancelAnimationFrame(frame);
  },[available,editing,focusEpoch,modelMenuOpen]);
  useEffect(()=>{
    if(!available||!panel.current||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const animation=panel.current.animate([{opacity:0,transform:"translateY(16px)"},{opacity:1,transform:"translateY(0)"}],{duration:320,easing:"cubic-bezier(.2,.7,.2,1)"});
    return ()=>animation.cancel();
  },[available,cycle]);
  const configured=Boolean(voice?.enabled&&(voice.provider==="browser"||voice.connectionId));
  useEffect(()=>{
    if(!available||!settingsLoaded)return;
    let active=true;const bridge=assistantBridge();
    if(!bridge?.configure){setEditing(true);editingRef.current=true;setFocusEpoch(value=>value+1);return;}
    const atRevision=focusRevision.current;
    void bridge.configure({voiceConfigured:configured,chatId}).then(value=>{
      if(active){if(focusRevision.current===atRevision){setEditing(value.editing);editingRef.current=value.editing;}setShortcuts(value.shortcuts);}
    }).catch(()=>{if(active)setError("Could not update the assistant input mode.");});
    return ()=>{active=false;};
  },[available,settingsLoaded,configured,chatId,cycle,settingsRevision]);
  useEffect(()=>{
    if(available)assistantBridge()?.voice({recording:recording.current,level:0,status:pollError?"Could not load the answer":running?runLabel:configured?"Metis Assistant":"Voice is not configured"});
  },[available,configured,running,cycle,pollError,runLabel]);
  const onVoiceState=useCallback((state:VoiceState)=>{
    setVoiceState(state);
    if(state==="error"){setRequested(false);recording.current=false;transcriptionPending.current=false;autoCapture.current=null;}
    assistantBridge()?.voice({recording:recording.current,level:0});
  },[]);
  const onRecordingChange=useCallback((value:boolean)=>{recording.current=value;if(!value)setRequested(false);},[]);
  const onLevel=useCallback((level:number)=>{
    const now=performance.now();if(now-lastWave.current<40&&level!==0)return;
    lastWave.current=now;assistantBridge()?.voice({recording:recording.current,level});
  },[]);
  const beginVoice=useCallback(()=>{
    transcriptionPending.current=true;
    autoCapture.current={epoch:++actionEpoch.current,revision:revision.current,manual:editingRef.current,expected:null};
  },[]);
  const onTranscript=useCallback((text:string)=>{
    const initial=draft.current,atRevision=revision.current;
    const next=[initial,text].filter(Boolean).join(" ");
    draft.current=next;setInput(next);if(autoCapture.current)autoCapture.current.expected=next;
    if(editingRef.current)inputRef.current?.focus();
    return (final:string)=>{
      if(!live.current||!final.trim()||revision.current!==atRevision||draft.current!==next)return;
      const updated=[initial,final].filter(Boolean).join(" ");
      draft.current=updated;setInput(updated);if(autoCapture.current)autoCapture.current.expected=updated;
    };
  },[]);
  const onTranscriptFinalized=useCallback((text:string)=>{
    transcriptionPending.current=false;
    if(text.trim())setFinalizedRevision(value=>value+1);
  },[]);
  useEffect(()=>{
    const capture=autoCapture.current;
    if(!live.current||!capture||transcriptionPending.current||recording.current||capture.manual||editingRef.current||revision.current!==capture.revision||capture.epoch!==actionEpoch.current||draft.current!==capture.expected||!selection||!modelForSelection(models,selection.modelId)||busy||running||modelSaving)return;
    autoCapture.current=null;
    void sendRef.current({epoch:capture.epoch,revision:capture.revision,focusRevision:focusRevision.current});
  },[finalizedRevision,selection,models,busy,running,modelSaving]);
  useEffect(()=>{
    if(!chatId||!running)return;
    let cancelled=false,timer:ReturnType<typeof setTimeout>;
    const controller=new AbortController();
    const poll=async()=>{
      try{
        const [body,state]=await Promise.all([
          json("/api/chats/"+encodeURIComponent(chatId)+"?messageLimit=6",{signal:controller.signal}),
          jobId?json("/api/runs?chatId="+encodeURIComponent(chatId)+"&jobId="+encodeURIComponent(jobId)+"&status=1",{signal:controller.signal}):Promise.resolve(null),
        ]);
        if(cancelled)return;
        const items=(body.chat.messages||[]).filter((message:Message)=>message.role==="user"||message.role==="assistant")
          .map((message:Message)=>({id:message.id,role:message.role,content:message.content||"",errorMessage:message.errorMessage}));
        setMessages(items);setPollError("");
        const job=state?.job,status=job?.status||body.chat.runStatus;
        if(["error","interrupted"].includes(status))setRunProblem(job?.error||"The agent run failed. Open this chat in Metis for details.");
        if(["waiting_input","waiting_for_user","waiting_approval"].includes(status))setRunProblem("Metis needs your input. Open this chat in Metis to continue.");
        if(status&&!["running","queued","switching"].includes(status)){runActive.current=false;setRunning(false);return;}
        setRunLabel(status==="queued"?(job?.queueMessage||"Waiting to start…"):"Metis is working…");
      }catch(cause){if(!cancelled)setPollError(cause instanceof Error?cause.message:"Could not load the answer.");}
      if(!cancelled)timer=setTimeout(()=>void poll(),1500);
    };
    void poll();return ()=>{cancelled=true;controller.abort();clearTimeout(timer);};
  },[chatId,jobId,running,runRevision]);
  function enterText() {
    if(autoCapture.current)autoCapture.current.manual=true;
    if(!editingRef.current){editingRef.current=true;setEditing(true);void assistantBridge()?.focusInput?.(true);}
  }
  async function changeModel(id:string) {
    if(sending.current||runActive.current||modelSavingRef.current)return;
    const model=modelForSelection(models,id);if(!model)return;
    const map=preferences.current.modelParamsByModel||{};
    const next={modelId:model.id,modelParams:Object.hasOwn(map,model.id)?sanitizeModelParams(model,map[model.id]):defaultParamsForModel(model)};
    modelSavingRef.current=true;setModelSaving(true);modelRevision.current++;setError("");
    try{
      let confirmed=next;
      if(chatId){
        const result=await json("/api/chats/"+encodeURIComponent(chatId),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(next)});
        if(typeof result.chat?.modelId!=="string"||!Array.isArray(result.chat.modelParams))throw new Error("Could not confirm the saved model selection.");
        confirmed={modelId:result.chat.modelId,modelParams:result.chat.modelParams};
      }
      rememberClientModelSelection(confirmed,localStorage);setSelection(confirmed);
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not save the model selection.");}
    finally{modelSavingRef.current=false;setModelSaving(false);}
  }
  async function send(automatic?:AutomaticSend){
    const text=draft.current.trim(),bridge=assistantBridge();
    if((!text&&!pendingSubmission.current)||!bridge||sending.current||runActive.current||modelSavingRef.current||recording.current||transcriptionPending.current)return;
    if(!pendingSubmission.current&&(!selection||!modelForSelection(models,selection.modelId))){setError("Select an available model before sending.");return;}
    const epoch=actionEpoch.current;
    const invalid=()=>actionEpoch.current!==epoch||Boolean(automatic&&(editingRef.current||automatic.epoch!==actionEpoch.current||automatic.revision!==revision.current||automatic.focusRevision!==focusRevision.current));
    if(invalid())return;
    sending.current=true;setBusy(true);setError("");setPollError("");setRunProblem("");
    const uploads:string[]=[];let attempted=false;
    try{
      if(!pendingSubmission.current){
        if(!automatic)await bridge.focusInput?.(false);
        const capture=await bridge.capture();
        if(invalid())throw new Error("Message cancelled before submission. Your draft is preserved.");
        let id=chatId;
        if(!id){
          const result=await json("/api/chats",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"Desktop Assistant · "+device,...selection})});
          id=result.chat.id;setChatId(id);
        }
        const ids:string[]=[];
        for(const [index,monitor] of capture.monitors.entries()){
          const blob=await (await fetch(monitor.image)).blob();
          const task=startUpload(new File([blob],"Monitor-"+(index+1)+"-"+monitor.id+".png",{type:"image/png"}),{label:"Desktop Assistant"});
          uploads.push(task);
          const result=await new Promise<{id:string}>((resolve,reject)=>{
            const timer=setInterval(()=>{if(getUploadStatus(task)==="error"){clearInterval(timer);cancelUpload(task);reject(new Error("Screen upload failed. Retry the message."));}},200);
            void waitForUpload(task).then(value=>{clearInterval(timer);resolve(value);},cause=>{clearInterval(timer);reject(cause);});
          });
          if(invalid())throw new Error("Message cancelled before submission. Your draft is preserved.");
          ids.push(result.id);
        }
        pendingSubmission.current={chatId:id!,messageId:createClientId(),message:text,referenceText:desktopCaptureContext(capture),uploadIds:ids,...selection!};
      }
      if(invalid())throw new Error("Message cancelled before submission. Your draft is preserved.");
      const submission=pendingSubmission.current;
      attempted=true;
      const accepted=await json("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(submission)});
      if(typeof accepted.jobId!=="string"||!accepted.jobId)throw new Error("The send result could not be confirmed. Retry the same message.");
      pendingSubmission.current=null;
      if(draft.current.trim()===submission.message){revision.current++;draft.current="";setInput("");}
      setMessages(current=>[...current,{id:submission.messageId,role:"user" as const,content:submission.message}].slice(-6));
      setJobId(accepted.jobId||null);runActive.current=true;setRunning(true);setRunLabel(accepted.status==="queued"?"Waiting to start…":"Metis is working…");
    }catch(cause){
      if(!attempted)pendingSubmission.current=null;
      uploads.forEach(cancelUpload);setError(cause instanceof Error?cause.message:"Could not send. Your draft is preserved.");
    }finally{sending.current=false;setBusy(false);}
  }
  sendRef.current=send;
  if(!available)return <main className="desktop-assistant assistant-fallback">Open Desktop Assistant from the Metis desktop app.</main>;
  const keyLabel=(value:string|undefined)=>value?desktopShortcutLabel(value,devicePlatform):"";
  const voiceBusy=["permission","recording","uploading","transcribing"].includes(voiceState);
  return <TooltipProvider><main className="desktop-assistant" data-editing={editing}
    onPointerDown={event=>{if(event.target===event.currentTarget)void assistantBridge()?.focusInput?.(false);}}>
    {messages.length||running?<aside className="assistant-conversation assistant-surface" aria-label="Desktop conversation">
      <header className="assistant-conversation-header">
        <span className="text-xs font-medium">Metis</span>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon-action" variant="ghost" aria-label="Open in Metis" title={shortcuts?"Open chat · "+keyLabel(shortcuts.openChat):"Open chat"}
            onClick={()=>void assistantBridge()?.openChat(chatId)}><ArrowUpRight className="size-4"/></Button>
          <Button type="button" size="icon-action" variant="ghost" aria-label="Close assistant" onClick={()=>void assistantBridge()?.close()}><X className="size-4"/></Button>
        </div>
      </header>
      <div className="assistant-messages" role="log" aria-label="Conversation">
        {messages.map(message=><div key={message.id} className={"assistant-message assistant-message-"+message.role} aria-label={message.role==="user"?"Your message":"Metis reply"}>
          {message.errorMessage?<p role="alert">{message.errorMessage}</p>:message.role==="user"?<p>{message.content}</p>:<Markdown content={message.content} streaming={running&&message.id===messages.at(-1)?.id}/>}
        </div>)}
        {running&&!pollError&&(!messages.at(-1)?.content||messages.at(-1)?.role==="user")?<div role="status" className="assistant-working"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true"/>{runLabel}</div>:null}
      </div>
    </aside>:null}
    <div className="assistant-compose">
      <section ref={panel} className="assistant-input assistant-surface" aria-label="Metis Desktop Assistant">
        {error||runProblem||pollError?<div role="alert" className="assistant-error">{error||runProblem||pollError}<button type="button" onClick={()=>{if(runProblem&&!error&&!pollError){void assistantBridge()?.openChat(chatId);return;}if(pendingSubmission.current){void send();return;}setError("");reloadSettings(value=>value+1);retryRun(value=>value+1);}}>{runProblem&&!error&&!pollError?"Open chat":"Retry"}</button></div>:null}
        {voice?.realtime&&preview?<p role="status" aria-label="Live transcription" className="assistant-transcript">{preview}</p>:null}
        <form className="assistant-form" onSubmit={event=>{event.preventDefault();void send();}}>
          <textarea ref={inputRef} aria-label="Message Metis" placeholder="Ask Metis" rows={1} value={input}
            onPointerDown={enterText} onFocus={enterText}
            onChange={event=>{revision.current++;if(autoCapture.current)autoCapture.current.manual=true;draft.current=event.target.value;setInput(event.target.value);}}
            onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/>
          {configured&&voice?<VoiceInput {...voice} enabled={voice.enabled&&!busy&&!running} chatId={chatId} captureRequested={requested} stopSignal={voiceStop} cancelSignal={cancelSignal}
            onStart={beginVoice} onTranscript={onTranscript} onTranscriptFinalized={onTranscriptFinalized} onRecordingChange={onRecordingChange} onStateChange={onVoiceState} onPreviewChange={setPreview} onWaveformLevelChange={onLevel}/>:null}
          {voiceState==="recording"?<Button type="button" size="icon-action" variant="ghost" aria-label="Stop assistant recording" onClick={()=>{setRequested(false);setVoiceStop(value=>value+1);}}><Square className="size-3.5"/></Button>:null}
          <Button type="submit" size="icon-action" variant="ghost" aria-label="Send message with all monitors" disabled={(!input.trim()&&!pendingSubmission.current)||busy||running||modelSaving||voiceBusy||!selection}>
            {busy?<LoaderCircle className="size-4 animate-spin"/>:<ArrowUp className="size-4"/>}
          </Button>
        </form>
        <div className="assistant-model-row" onPointerDown={enterText}>
          <ModelPicker models={models} value={selection?.modelId||""} onValueChange={id=>void changeModel(id)} favoriteModelKeys={favorites} onToggleFavorite={()=>{}}
            allowPinning={false} modal={false} disabled={busy||running||modelSaving||voiceBusy||Boolean(pendingSubmission.current)}
            className="assistant-model-picker" contentClassName="assistant-input assistant-model-menu" ariaLabel="Assistant model"
            placeholder={!modelsLoaded?"Loading models…":"Select a model"}
            onOpenChange={open=>{modelMenuOpenRef.current=open;setModelMenuOpen(open);}}/>
          {modelsLoaded&&!models.length?<span className="assistant-model-empty">Connect a provider in Settings.</span>:null}
        </div>
      </section>
      {configured?<div className="assistant-hint">
        {shortcuts?<span><kbd>{keyLabel(shortcuts.focusInput)}</kbd> {editing?"to return to your app":"to type"}</span>:null}
      </div>:null}
    </div>
  </main></TooltipProvider>;
}
