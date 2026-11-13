"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, ListPlus, LoaderCircle, Square, X } from "lucide-react";
import { VoiceInput, type VoiceState } from "@/components/voice-input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { DesktopAssistantMessage, type AssistantMessage } from "@/components/desktop-assistant-message";
import { ModelOptionsMenu } from "@/components/model-options-menu";
import { ModelPicker } from "@/components/model-picker";
import type { ModelInfo } from "@/components/settings-panel";
import { desktopShortcutLabel } from "@/lib/desktop-shortcuts";
import { createClientId } from "@/lib/client-id";
import { assistantBridge, desktopCaptureContext, type DesktopShortcuts } from "@/lib/desktop-assistant";
import { latestClientModelSelection, rememberClientModelSelection, MODEL_STORAGE_KEY, type ClientModelPreferences } from "@/lib/client-model-selection";
import { modelForSelection } from "@/lib/model-selection";
import { defaultParamsForModel, sanitizeModelParams, type ModelParamSelection } from "@/lib/model-params";
import type { VoiceInputSettings } from "@/lib/store";
import { cancelUpload } from "@/lib/background-uploads";
import {uploadAssistantScreens} from "@/lib/assistant-screen-uploads";
import {RichComposerInput} from "@/components/rich-composer-input";
import {AssistantConversationPanel} from "@/components/assistant-conversation-panel";
import {AssistantMessageQueue} from "@/components/assistant-message-queue";
import {useAssistantSession} from "@/components/use-assistant-session";
import {DEFAULT_ASSISTANT_PANEL,type AssistantDraft,type AssistantQueuedMessage,type AssistantPanelSize} from "@/lib/desktop-assistant-session";
import {saveQueuedFollowUps,removeQueuedFollowUp} from "@/lib/queue-client";
import "./desktop-assistant.css";

async function json(url:string,init?:RequestInit) {
  const response=await fetch(url,{cache:"no-store",...init});
  const body=await response.json();
  if(!response.ok)throw new Error(response.status===401?"Sign in to Metis in the main app first.":body.error||"Request failed. Try again.");
  return body;
}
type Selection={modelId:string;modelParams:ModelParamSelection[]};
type Message=AssistantMessage&{role:"user"|"assistant"};
type AutomaticSend={epoch:number;revision:number;focusRevision:number};
export function DesktopAssistant() {
  const [available,setAvailable]=useState(false),[voice,setVoice]=useState<VoiceInputSettings|null>(null);
  const [input,setInput]=useState(""),[preview,setPreview]=useState(""),[requested,setRequested]=useState(false);
  const [voiceState,setVoiceState]=useState<VoiceState>("idle"),[voiceStop,setVoiceStop]=useState(0);
  const [cancelSignal,setCancelSignal]=useState(0),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [chatId,setChatId]=useState<string|null>(null),[running,setRunning]=useState(false),[jobId,setJobId]=useState<string|null>(null);
  const [messages,setMessages]=useState<Message[]>([]);
  const [deviceId,setDeviceId]=useState(""),[sessionReady,setSessionReady]=useState(false),[inputNonce,setInputNonce]=useState(0);
  const [queue,setQueue]=useState<AssistantQueuedMessage[]>([]),[queueBusy,setQueueBusy]=useState(false);
  const [panelSize,setPanelSize]=useState<AssistantPanelSize>(DEFAULT_ASSISTANT_PANEL);
  const saved=useAssistantSession(deviceId),booted=useRef(false),queueLock=useRef(false),queueRevision=useRef(0);
  const draftContext=useRef<AssistantDraft>({text:""}),removedQueue=useRef(new Set<string>()),lastSavedDraft=useRef("");
  const compose=useRef<HTMLDivElement>(null),root=useRef<HTMLElement>(null),restoredSelection=useRef<Selection|null>(null);
  function setDraft(text:string){draft.current=text;setInput(text);setInputNonce(value=>value+1);}
  const [editing,setEditing]=useState(false),[focusEpoch,setFocusEpoch]=useState(0),[settingsLoaded,setSettingsLoaded]=useState(false);
  const [shortcuts,setShortcuts]=useState<DesktopShortcuts|null>(null),[devicePlatform,setDevicePlatform]=useState("");
  const [device,setDevice]=useState(""),[cycle,setCycle]=useState(0),[settingsRevision,reloadSettings]=useState(0);
  const [models,setModels]=useState<ModelInfo[]>([]),[selection,setSelection]=useState<Selection|null>(null),[favorites,setFavorites]=useState<string[]>([]);
  const [modelSaving,setModelSaving]=useState(false),[modelMenuOpen,setModelMenuOpen]=useState(false),[modelsLoaded,setModelsLoaded]=useState(false),[finalizedRevision,setFinalizedRevision]=useState(0);
  const [pollError,setPollError]=useState(""),[runProblem,setRunProblem]=useState(""),[runRevision,retryRun]=useState(0),[runLabel,setRunLabel]=useState("Metis is working…");
  const preferences=useRef<ClientModelPreferences>({}),modelRevision=useRef(0),modelSavingRef=useRef(false),modelMenuOpenRef=useRef(false);
  const openMenus=useRef(new Set<string>());
  const editingRef=useRef(false),focusRevision=useRef(0),runActive=useRef(false),transcriptionPending=useRef(false);
  const inputRef=useRef<HTMLTextAreaElement>(null),draft=useRef(""),revision=useRef(0),sending=useRef(false),live=useRef(true);
  const actionEpoch=useRef(0),sendRef=useRef<(automatic?:AutomaticSend)=>Promise<void>>(async()=>{});
  const autoCapture=useRef<{epoch:number;revision:number;manual:boolean;expected:string|null}|null>(null);
  const pendingSubmission=useRef<(Selection&{chatId:string;messageId:string;message:string;referenceText:string;assistantDeviceId?:string;uploadIds:string[];storedAttachments?:AssistantDraft["attachments"];references?:AssistantDraft["references"];queued:boolean})|null>(null);
  const recording=useRef(false),lastWave=useRef(0),panel=useRef<HTMLElement>(null);
  const gesture=useCallback((value:string)=>{
    if(value==="start"&&!sending.current)setRequested(true);
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
      setDevice(state.device.hostname);setDevicePlatform(state.device.platform);setDeviceId(state.device.clientId);
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
    if(!available||!editing||!sessionReady||modelMenuOpen)return;
    const frame=requestAnimationFrame(()=>inputRef.current?.focus());
    return ()=>cancelAnimationFrame(frame);
  },[available,editing,sessionReady,focusEpoch,modelMenuOpen]);
  useEffect(()=>{
    if(!available||!panel.current||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const animation=panel.current.animate([{opacity:0,transform:"translateY(16px)"},{opacity:1,transform:"translateY(0)"}],{duration:320,easing:"cubic-bezier(.2,.7,.2,1)"});
    return ()=>animation.cancel();
  },[available,cycle]);
  useEffect(()=>{
    if(!saved.session||booted.current)return;
    booted.current=true;draftContext.current=saved.session.draft;lastSavedDraft.current=saved.session.draft.text;
    setDraft(saved.session.draft.text);setPanelSize(saved.session.panelSize);setChatId(saved.session.chatId);setSessionReady(true);
    if(saved.session.chatId)void json("/api/chats/"+encodeURIComponent(saved.session.chatId)+"?messageLimit=6").then(body=>{
      if(!live.current)return;
      if(body.chat.modelId){restoredSelection.current={modelId:body.chat.modelId,modelParams:body.chat.modelParams||[]};modelRevision.current++;retryRun(value=>value+1);}
    }).catch(()=>{});
  },[saved.session]);
  useEffect(()=>{
    if(!restoredSelection.current||!modelsLoaded)return;
    const model=modelForSelection(models,restoredSelection.current.modelId);
    if(model)setSelection({modelId:model.id,modelParams:sanitizeModelParams(model,restoredSelection.current.modelParams)});
    restoredSelection.current=null;
  },[models,modelsLoaded,runRevision]);
  const saveSession=saved.save;
  useEffect(()=>{
    if(sessionReady&&!queueBusy&&saved.session?.draft.text===draft.current)draftContext.current=saved.session.draft;
  },[sessionReady,queueBusy,saved.session]);
  useEffect(()=>{
    if(!sessionReady||queueBusy||input===lastSavedDraft.current)return;
    const text=input;
    const persist=()=>{if(draft.current!==text)return;lastSavedDraft.current=text;void saveSession({draftText:text}).catch(()=>{lastSavedDraft.current="\0";});};
    const timer=setTimeout(persist,300);
    const flush=()=>{clearTimeout(timer);persist();};
    window.addEventListener("pagehide",flush);document.addEventListener("visibilitychange",flush);
    return ()=>{clearTimeout(timer);window.removeEventListener("pagehide",flush);document.removeEventListener("visibilitychange",flush);};
  },[input,sessionReady,queueBusy,saveSession]);
  useEffect(()=>{
    if(!available||!compose.current)return;
    const observer=new ResizeObserver(()=>{
      root.current?.style.setProperty("--assistant-compose-height",compose.current!.getBoundingClientRect().height+"px");
    });
    observer.observe(compose.current);return ()=>observer.disconnect();
  },[available]);
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
    setDraft(next);if(autoCapture.current)autoCapture.current.expected=next;
    if(editingRef.current)inputRef.current?.focus();
    return (final:string)=>{
      if(!live.current||!final.trim()||revision.current!==atRevision||draft.current!==next)return;
      const updated=[initial,final].filter(Boolean).join(" ");
      setDraft(updated);if(autoCapture.current)autoCapture.current.expected=updated;
    };
  },[]);
  const onTranscriptFinalized=useCallback((text:string)=>{
    transcriptionPending.current=false;
    if(text.trim())setFinalizedRevision(value=>value+1);
  },[]);
  useEffect(()=>{
    const capture=autoCapture.current;
    if(!live.current||!capture||transcriptionPending.current||recording.current||capture.manual||editingRef.current||revision.current!==capture.revision||capture.epoch!==actionEpoch.current||draft.current!==capture.expected||!selection||!modelForSelection(models,selection.modelId)||busy||modelSaving||!sessionReady||queueBusy)return;
    autoCapture.current=null;
    void sendRef.current({epoch:capture.epoch,revision:capture.revision,focusRevision:focusRevision.current});
  },[finalizedRevision,selection,models,busy,modelSaving,sessionReady,queueBusy]);
  useEffect(()=>{
    if(!chatId||!sessionReady)return;
    let cancelled=false,timer:ReturnType<typeof setTimeout>;
    const controller=new AbortController();
    const poll=async()=>{
      try{
        const atQueue=queueRevision.current;
        const [body,current]=await Promise.all([
          json("/api/chats/"+encodeURIComponent(chatId)+"?messageLimit=6",{signal:controller.signal}),
          json("/api/runs?chatId="+encodeURIComponent(chatId)+"&status=1",{signal:controller.signal}),
        ]);
        if(cancelled)return;
        const items=(body.chat.messages||[]).filter((message:Message)=>message.role==="user"||message.role==="assistant")
          .map((message:Message)=>({...message,content:message.content||""}));
        setMessages(items);setPollError("");
        const state=current?.job?current:jobId?await json("/api/runs?chatId="+encodeURIComponent(chatId)+"&jobId="+encodeURIComponent(jobId)+"&status=1",{signal:controller.signal}):null;
        if(cancelled)return;
        if(atQueue===queueRevision.current&&!queueLock.current)setQueue((body.chat.queuedMessages||[]).filter((item:AssistantQueuedMessage)=>!removedQueue.current.has(item.id)));
        const job=state?.job,status=job?.status||body.chat.runStatus;
        if(current?.job&&["running","queued","switching"].includes(current.job.status))setRunProblem("");
        if(current?.job&&current.job.id!==jobId)setJobId(current.job.id);
        if(["error","interrupted"].includes(status))setRunProblem(job?.error||"The agent run failed. Open this chat in Metis for details.");
        if(["waiting_input","waiting_for_user","waiting_approval"].includes(status))setRunProblem("Metis needs your input. Open this chat in Metis to continue.");
        if(status&&!["running","queued","switching","waiting_input","waiting_for_user","waiting_approval"].includes(status)){runActive.current=false;setRunning(false);}else{runActive.current=Boolean(status);setRunning(Boolean(status));}
        setRunLabel(status==="queued"?(job?.queueMessage||"Waiting to start…"):["waiting_input","waiting_for_user","waiting_approval"].includes(status)?"Waiting for your input…":"Metis is working…");
      }catch(cause){if(!cancelled)setPollError(cause instanceof Error?cause.message:"Could not load the answer.");}
      if(!cancelled)timer=setTimeout(()=>void poll(),runActive.current?1500:4000);
    };
    void poll();return ()=>{cancelled=true;controller.abort();clearTimeout(timer);};
  },[chatId,jobId,sessionReady,runRevision]);
  function enterText() {
    if(autoCapture.current)autoCapture.current.manual=true;
    if(!editingRef.current){editingRef.current=true;setEditing(true);void assistantBridge()?.focusInput?.(true);}
  }
  function menuOpen(kind:string,open:boolean){
    if(open)openMenus.current.add(kind);else openMenus.current.delete(kind);
    modelMenuOpenRef.current=openMenus.current.size>0;setModelMenuOpen(modelMenuOpenRef.current);
  }
  async function changeModel(id:string) {
    const model=modelForSelection(models,id);if(!model)return;
    const map=preferences.current.modelParamsByModel||{};
    await saveSelection({modelId:model.id,modelParams:Object.hasOwn(map,model.id)?sanitizeModelParams(model,map[model.id]):defaultParamsForModel(model)});
  }
  async function saveSelection(next:Selection) {
    if(sending.current||runActive.current||modelSavingRef.current)return;
    const model=modelForSelection(models,next.modelId);if(!model)return;
    next={modelId:model.id,modelParams:sanitizeModelParams(model,next.modelParams)};
    modelSavingRef.current=true;setModelSaving(true);modelRevision.current++;setError("");
    try{
      let confirmed=next;
      if(chatId){
        const result=await json("/api/chats/"+encodeURIComponent(chatId),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(next)});
        if(typeof result.chat?.modelId!=="string"||!Array.isArray(result.chat.modelParams))throw new Error("Could not confirm the saved model selection.");
        confirmed={modelId:result.chat.modelId,modelParams:result.chat.modelParams};
      }
      rememberClientModelSelection(confirmed,localStorage);setSelection(confirmed);
      const map={...preferences.current.modelParamsByModel,[confirmed.modelId]:confirmed.modelParams};
      preferences.current={...preferences.current,modelParamsByModel:map};
      try{await json("/api/preferences",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({modelParamsByModel:map})});}
      catch{setError("The model is set for this chat, but its defaults could not be saved. Choose the option again to retry.");}
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not save the model selection.");}
    finally{modelSavingRef.current=false;setModelSaving(false);}
  }
  async function send(automatic?:AutomaticSend){
    const text=draft.current.trim(),bridge=assistantBridge();
    if((!text&&!pendingSubmission.current)||!bridge||sending.current||queueLock.current||!sessionReady||Boolean(saved.error)||modelSavingRef.current||recording.current||transcriptionPending.current)return;
    if(!pendingSubmission.current&&(!selection||!modelForSelection(models,selection.modelId))){setError("Select an available model before sending.");return;}
    const epoch=actionEpoch.current;
    const invalid=()=>actionEpoch.current!==epoch||Boolean(automatic&&(editingRef.current||automatic.epoch!==actionEpoch.current||automatic.revision!==revision.current||automatic.focusRevision!==focusRevision.current));
    if(invalid())return;
    sending.current=true;setBusy(true);setError("");setPollError("");setRunProblem("");
    const uploads:string[]=[];let attempted=false;
    try{
      if(!pendingSubmission.current){
        if(!automatic)await bridge.focusInput?.(false);
        const context=draftContext.current;
        const capture=context.attachments?.length?null:await bridge.capture();
        if(invalid())throw new Error("Message cancelled before submission. Your draft is preserved.");
        let id=chatId;
        if(!id){
          const result=await json("/api/chats",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"Desktop Assistant · "+device,...selection})});
          id=result.chat.id;
          await saved.save({chatId:id});setChatId(id);
        }
        const screenUploads=await uploadAssistantScreens(capture?.monitors||[],invalid);
        const ids=screenUploads.ids;uploads.push(...screenUploads.tasks);
        pendingSubmission.current={chatId:id!,messageId:createClientId(),message:text,referenceText:capture?desktopCaptureContext(capture):context.referenceText||"",assistantDeviceId:capture?capture.device.clientId:context.assistantDeviceId,uploadIds:ids,storedAttachments:context.attachments,references:context.references,queued:runActive.current||queue.length>0,...selection!};
      }
      if(invalid())throw new Error("Message cancelled before submission. Your draft is preserved.");
      const submission=pendingSubmission.current;
      attempted=true;
      let accepted:{jobId?:string;status?:string}|null=null;
      if(submission.queued){
        queueRevision.current++;
        await saveQueuedFollowUps(submission.chatId,[...queue.filter(item=>item.id!==submission.messageId),{id:submission.messageId,text:submission.message,referenceText:submission.referenceText,assistantDeviceId:submission.assistantDeviceId,uploadIds:submission.uploadIds,attachments:submission.storedAttachments,references:submission.references}]);
        setQueue(current=>current.some(item=>item.id===submission.messageId)?current:[...current,{id:submission.messageId,text:submission.message,referenceText:submission.referenceText,assistantDeviceId:submission.assistantDeviceId}]);
      }else{
        accepted=await json("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(submission)});
        if(typeof accepted?.jobId!=="string"||!accepted.jobId)throw new Error("The send result could not be confirmed. Retry the same message.");
      }
      pendingSubmission.current=null;
      if(draft.current.trim()===submission.message){revision.current++;setDraft("");}
      draftContext.current={text:draft.current};lastSavedDraft.current=draft.current;
      await saved.save({draftText:draft.current,clearContext:true});
      if(accepted){
        setMessages(current=>[...current,{id:submission.messageId,role:"user" as const,content:submission.message}].slice(-6));
        setJobId(accepted.jobId||null);runActive.current=true;setRunning(true);setRunLabel(accepted.status==="queued"?"Waiting to start…":"Metis is working…");
      }
      retryRun(value=>value+1);
    }catch(cause){
      if(!attempted)pendingSubmission.current=null;
      uploads.forEach(cancelUpload);setError(cause instanceof Error?cause.message:"Could not send. Your draft is preserved.");
    }finally{sending.current=false;setBusy(false);}
  }
  sendRef.current=send;
  async function mutateQueue(operation:()=>Promise<void>){
    if(queueLock.current||!chatId||busy)return;
    queueLock.current=true;queueRevision.current++;setQueueBusy(true);setError("");
    try{await operation();}catch(cause){setError(cause instanceof Error?cause.message:"Could not update the queue.");}
    finally{queueLock.current=false;setQueueBusy(false);retryRun(value=>value+1);}
  }
  function removeQueued(message:AssistantQueuedMessage){
    void mutateQueue(async()=>{
      const before=queue;
      await removeQueuedFollowUp({chatId,messageId:message.id,removedIds:removedQueue.current,
        removeLocally:()=>setQueue(items=>items.filter(item=>item.id!==message.id)),
        restoreLocally:()=>setQueue(before)});
    });
  }
  function editQueued(message:AssistantQueuedMessage){
    if(draft.current.trim())return;
    void mutateQueue(async()=>{
      const at=revision.current;setDraft(message.text);enterText();setFocusEpoch(value=>value+1);
      setQueue(items=>items.filter(item=>item.id!==message.id));
      try{
        const next=await saved.save({},message.id);
        removedQueue.current.add(message.id);
        draftContext.current=next.draft;
        if(revision.current===at)lastSavedDraft.current=message.text;
        else await saved.save({draftText:draft.current});
      }catch(cause){setQueue(queue);throw cause;}
    });
  }
  function moveQueued(id:string,offset:number){
    void mutateQueue(async()=>{
      const next=[...queue],from=next.findIndex(item=>item.id===id),to=from+offset;
      if(from<0||to<0||to>=next.length)return;
      [next[from],next[to]]=[next[to],next[from]];
      setQueue(next);
      try{await saveQueuedFollowUps(chatId!,next);}
      catch(cause){setQueue(queue);throw cause;}
    });
  }
  function sendQueuedNow(message:AssistantQueuedMessage){
    if(!selection)return;
    void mutateQueue(async()=>{
      const accepted=await json("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        chatId,messageId:message.id,message:message.text,referenceText:message.referenceText,assistantDeviceId:message.assistantDeviceId,references:message.references,
        storedAttachments:message.attachments,sendQueuedNow:true,...selection,
      })});
      if(!accepted.jobId)throw new Error("Could not confirm the queued message.");
      setQueue(items=>items.filter(item=>item.id!==message.id));
      setJobId(accepted.jobId);runActive.current=true;setRunning(true);setRunProblem("");
    });
  }
  function resizePanel(size:AssistantPanelSize,commit:boolean){
    setPanelSize(size);if(commit)void saved.save({panelSize:size}).catch(()=>{});
  }
  if(!available)return <main className="desktop-assistant assistant-fallback">Open Desktop Assistant from the Metis desktop app.</main>;
  const keyLabel=(value:string|undefined)=>value?desktopShortcutLabel(value,devicePlatform):"";
  const voiceBusy=["permission","recording","uploading","transcribing"].includes(voiceState);
  const selectedModel=modelForSelection(models,selection?.modelId);
  const selectionDisabled=busy||running||modelSaving||voiceBusy||Boolean(pendingSubmission.current);
  const last=messages.at(-1);
  const hasActivity=last?.role==="assistant"&&Boolean(last.thinking||last.tools?.length||last.parts?.some(part=>part.type==="tool"||part.type==="thinking"||part.type==="compaction"));
  return <TooltipProvider><main ref={root} className="desktop-assistant" data-editing={editing}
    onPointerDown={event=>{if(event.target===event.currentTarget)void assistantBridge()?.focusInput?.(false);}}>
    {messages.length||running?<AssistantConversationPanel messageKey={[...messages].reverse().find(message=>message.role==="assistant")?.id||""} size={panelSize} onChange={resizePanel} onMenuOpen={open=>menuOpen("size",open)} actions={<>
          <Button type="button" size="icon-action" variant="ghost" aria-label="Open in Metis" title={shortcuts?"Open chat · "+keyLabel(shortcuts.openChat):"Open chat"}
            onClick={()=>void assistantBridge()?.openChat(chatId)}><ArrowUpRight className="size-4"/></Button>
          <Button type="button" size="icon-action" variant="ghost" aria-label="Close assistant" onClick={()=>void assistantBridge()?.close()}><X className="size-4"/></Button>
        </>}>
      <div className="assistant-messages" role="log" aria-label="Conversation">
        {messages.map(message=><div key={message.id} className={"assistant-message assistant-message-"+message.role} aria-label={message.role==="user"?"Your message":"Metis reply"}>
          {message.role==="user"?<p>{message.content}</p>:<DesktopAssistantMessage message={message} streaming={running&&message.id===messages.at(-1)?.id} onOpenChat={()=>void assistantBridge()?.openChat(chatId)}/>}
        </div>)}
        {running&&!pollError&&!hasActivity&&(!messages.at(-1)?.content||messages.at(-1)?.role==="user")?<div role="status" className="assistant-working"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true"/>{runLabel}</div>:null}
      </div>
    </AssistantConversationPanel>:null}
    <div ref={compose} className="assistant-compose">
      <section ref={panel} className="assistant-input assistant-surface" aria-label="Metis Desktop Assistant">
        {saved.error?<div className="assistant-error" role="alert">{saved.error}<button type="button" onClick={()=>{const problem=saved.error;void saved.retry().then(restored=>{if(restored)setError(current=>current===problem?"":current);});}}>Retry save</button></div>:null}
        {!sessionReady?<div className="assistant-save-state" role="status">Restoring assistant…</div>:null}
        <AssistantMessageQueue messages={queue} disabled={queueBusy||busy||Boolean(saved.error)} canEdit={!input.trim()} onEdit={editQueued} onRemove={removeQueued} onMove={moveQueued} onSend={sendQueuedNow}/>
        {draftContext.current.attachments?.length?<div className="assistant-queue-context px-3 pt-2">{draftContext.current.attachments.length} attached file(s) retained from the queue</div>:null}
        {(error&&error!==saved.error)||runProblem||pollError?<div role="alert" className="assistant-error">{(error&&error!==saved.error?error:"")||runProblem||pollError}<button type="button" onClick={()=>{if(runProblem&&!error&&!pollError){void assistantBridge()?.openChat(chatId);return;}if(pendingSubmission.current){void send();return;}setError("");reloadSettings(value=>value+1);retryRun(value=>value+1);}}>{runProblem&&!error&&!pollError?"Open chat":"Retry"}</button></div>:null}
        {voice?.realtime&&preview?<p role="status" aria-label="Live transcription" className="assistant-transcript">{preview}</p>:null}
        <form className="assistant-form" onSubmit={event=>{event.preventDefault();void send();}}>
          <RichComposerInput ref={inputRef} aria-label="Message Metis" placeholder="Ask Metis" value={input} syncNonce={inputNonce} focusOnClear={false} disabled={!sessionReady}
            onFocus={enterText}
            onChange={text=>{revision.current++;if(autoCapture.current)autoCapture.current.manual=true;draft.current=text;setInput(text);}}
            onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/>
          {configured&&voice?<VoiceInput {...voice} enabled={voice.enabled&&!busy&&sessionReady&&!queueBusy} chatId={chatId} captureRequested={requested} stopSignal={voiceStop} cancelSignal={cancelSignal}
            onStart={beginVoice} onTranscript={onTranscript} onTranscriptFinalized={onTranscriptFinalized} onRecordingChange={onRecordingChange} onStateChange={onVoiceState} onPreviewChange={setPreview} onWaveformLevelChange={onLevel}/>:null}
          {voiceState==="recording"?<Button type="button" size="icon-action" variant="ghost" aria-label="Stop assistant recording" onClick={()=>{setRequested(false);setVoiceStop(value=>value+1);}}><Square className="size-3.5"/></Button>:null}
          <Button type="submit" size="icon-action" variant="ghost" aria-label={running||queue.length?"Queue message with all monitors":"Send message with all monitors"} disabled={(!input.trim()&&!pendingSubmission.current)||busy||queueBusy||!sessionReady||Boolean(saved.error)||modelSaving||voiceBusy||!selection}>
            {busy?<LoaderCircle className="size-4 animate-spin"/>:running||queue.length?<ListPlus className="size-4"/>:<ArrowUp className="size-4"/>}
          </Button>
        </form>
        <div className="assistant-model-row" onPointerDown={enterText}>
          <ModelPicker models={models} value={selection?.modelId||""} onValueChange={id=>void changeModel(id)} favoriteModelKeys={favorites} onToggleFavorite={()=>{}}
            allowPinning={false} modal={false} disabled={selectionDisabled}
            className="assistant-model-picker" contentClassName="assistant-input assistant-model-menu" ariaLabel="Assistant model"
            placeholder={!modelsLoaded?"Loading models…":"Select a model"}
            onOpenChange={open=>menuOpen("models",open)}/>
          {selectedModel&&selection?<ModelOptionsMenu model={selectedModel} modelParams={selection.modelParams}
            onModelParamsChange={params=>void saveSelection({modelId:selectedModel.id,modelParams:params})} disabled={selectionDisabled}
            className="assistant-model-options" contentClassName="assistant-input assistant-options-menu" onOpenChange={open=>menuOpen("options",open)}/>:null}
          {modelsLoaded&&!models.length?<span className="assistant-model-empty">Connect a provider in Settings.</span>:null}
          <span className="assistant-save-state" role="status">{saved.error?"Not saved":saved.saving||input!==saved.session?.draft.text?"Saving…":sessionReady?"Saved":""}</span>
        </div>
      </section>
      {configured?<div className="assistant-hint">
        {shortcuts?<span><kbd>{keyLabel(shortcuts.focusInput)}</kbd> {editing?"to return to your app":"to type"}</span>:null}
      </div>:null}
    </div>
  </main></TooltipProvider>;
}
