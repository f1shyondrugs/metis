"use client";
import {useEffect,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {desktopBridge} from "@/lib/desktop-bridge";
import type {DesktopShortcuts} from "@/lib/desktop-assistant";
import {desktopShortcutFromEvent,desktopShortcutLabel} from "@/lib/desktop-shortcuts";

const rows:Array<{key:keyof DesktopShortcuts;label:string;hint:string}>=[
  {key:"assistant",label:"Talk / show assistant",hint:"Press once to record; press again to stop."},
  {key:"focusInput",label:"Focus text / return to app",hint:"Switch between typing and passing input to your game."},
  {key:"openChat",label:"Open current chat",hint:"Open the same conversation in Metis."},
  {key:"deviceSettings",label:"Open local device settings",hint:"Open Remote Client Device Settings."},
  {key:"cancel",label:"Dismiss / stop computer use",hint:"Close the assistant or stop active computer use."},
];
export function DesktopShortcutSettings({value,defaults,platform,onSaved}:{value:DesktopShortcuts;defaults:DesktopShortcuts;platform?:string;onSaved:(next:DesktopShortcuts)=>void}){
  const [draft,setDraft]=useState(value),[dirty,setDirty]=useState(false),[recording,setRecording]=useState<keyof DesktopShortcuts|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const captureEpoch=useRef(0),recordButtons=useRef<Partial<Record<keyof DesktopShortcuts,HTMLButtonElement|null>>>({});
  useEffect(()=>{if(!recording)return;recordButtons.current[recording]?.focus();const timer=setTimeout(()=>{setRecording(null);void desktopBridge()?.setShortcutCapture?.(false).catch(()=>{});},28000);return ()=>clearTimeout(timer);},[recording]);
  useEffect(()=>{if(!dirty)setDraft(value);},[value,dirty]);
  useEffect(()=>{const release=()=>{captureEpoch.current++;void desktopBridge()?.setShortcutCapture?.(false).catch(()=>{});};const cancel=()=>{release();setRecording(null);};window.addEventListener("blur",cancel);return ()=>{window.removeEventListener("blur",cancel);release();};},[]);
  async function record(key:keyof DesktopShortcuts){
    const epoch=++captureEpoch.current;setBusy(true);setError("");
    try{await desktopBridge()?.setShortcutCapture?.(true);if(captureEpoch.current===epoch)setRecording(key);}
    catch{setError("Could not start shortcut recording.");}
    finally{if(captureEpoch.current===epoch)setBusy(false);}
  }
  function stopRecording(){captureEpoch.current++;setRecording(null);void desktopBridge()?.setShortcutCapture?.(false).catch(()=>setError("Could not finish shortcut recording."));}
  async function save(){
    const bridge=desktopBridge();if(!bridge?.setShortcuts){setError("Update the desktop app to change shortcuts.");return;}
    stopRecording();setBusy(true);setError("");
    try{const next=await bridge.setShortcuts(draft);setDraft(next);setDirty(false);onSaved(next);}
    catch(cause){setError(cause instanceof Error?cause.message:"Could not save shortcuts.");}
    finally{setBusy(false);}
  }
  return <section className="border-t border-border pt-4" aria-label="Desktop shortcuts">
    <h3 className="text-sm font-medium">Keyboard shortcuts</h3>
    <p className="mt-1 mb-3 text-xs text-muted-foreground">Voice mode leaves your game focused. Focus the text field only when you want to type. Without voice, it is focused automatically.</p>
    <div className="divide-y divide-border">
      {rows.map(row=><div key={row.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div><p className="text-sm">{row.label}</p><p className="mt-0.5 text-xs text-muted-foreground">{row.hint}</p></div>
        <Button ref={element=>{recordButtons.current[row.key]=element;}} type="button" variant="outline" size="action" disabled={busy}
          aria-label={"Change shortcut: "+row.label} aria-pressed={recording===row.key}
          onClick={()=>void record(row.key)}
          onKeyDown={event=>{
            if(recording!==row.key)return;
            event.preventDefault();event.stopPropagation();
            const next=desktopShortcutFromEvent(event.nativeEvent);
            if(next){setDraft(current=>({...current,[row.key]:next}));setDirty(true);stopRecording();}
          }}>
          <kbd className="font-sans text-xs">{recording===row.key?"Press shortcut…":desktopShortcutLabel(draft[row.key],platform)}</kbd>
        </Button>
      </div>)}
    </div>
    {recording?<Button type="button" variant="ghost" size="sm" onClick={stopRecording}>Cancel recording</Button>:null}
    {error?<p role="alert" className="my-2 text-xs text-destructive">{error}</p>:null}
    <div className="mt-3 flex gap-2">
      <Button type="button" disabled={!dirty||busy||Boolean(recording)} onClick={()=>void save()}>{busy?"Saving…":"Save shortcuts"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={()=>{stopRecording();setDraft(defaults);setDirty(true);}}>Restore defaults</Button>
    </div>
  </section>;
}
