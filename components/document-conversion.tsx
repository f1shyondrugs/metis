"use client";
import {useEffect,useRef,useState} from "react";
import {ArrowRightLeft,FileText,Layout,LoaderCircle,ListChecks} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {DropdownMenuItem,DropdownMenuSub,DropdownMenuSubContent,DropdownMenuSubTrigger} from "@/components/ui/dropdown-menu";
import {createClientId} from "@/lib/client-id";
import {DOCUMENT_LABELS,type ConversionSource,type ConvertedDocument,type DocumentKind} from "@/lib/document-conversion-types";

const icons={canvas:Layout,plan:ListChecks,note:FileText};
export function DocumentConvertItems({kind,onChoose}:{kind:DocumentKind;onChoose:(target:DocumentKind)=>void}){
 return <DropdownMenuSub><DropdownMenuSubTrigger className="min-h-11 sm:min-h-8"><ArrowRightLeft className="size-4"/>Convert to</DropdownMenuSubTrigger>
  <DropdownMenuSubContent>{(["canvas","plan","note"] as const).filter(target=>target!==kind).map(target=>{const Icon=icons[target];return <DropdownMenuItem className="min-h-11 sm:min-h-8" key={target} onSelect={()=>onChoose(target)}><Icon className="size-4"/>{DOCUMENT_LABELS[target]}</DropdownMenuItem>;})}</DropdownMenuSubContent>
 </DropdownMenuSub>;
}
export function openConvertedDocument(result:ConvertedDocument){
 if(result.note){window.dispatchEvent(new Event("ai-chat:notes-updated"));window.dispatchEvent(new CustomEvent("ai-chat:open-note",{detail:{id:result.note.id}}));}
 else if(result.workspace)window.dispatchEvent(new CustomEvent("ai-chat:open-workspace",{detail:{id:result.workspace.id,type:result.workspace.type,chatId:result.chatId}}));
}
export function DocumentConversionDialog({source,target,onClose,prepare,onConverted=openConvertedDocument}:{source:ConversionSource;target:DocumentKind;onClose:()=>void;prepare?:()=>Promise<ConversionSource>;onConverted?:(result:ConvertedDocument)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const pending=useRef(false),payload=useRef<{source:ConversionSource;target:DocumentKind;requestId:string}|null>(null),id=useRef(createClientId());
 async function convert(){
  if(pending.current)return;pending.current=true;setBusy(true);setError("");
  try{
   if(!payload.current)payload.current={source:prepare?await prepare():source,target,requestId:id.current};
   if(!mounted.current)return;
   const response=await fetch("/api/documents/convert",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload.current)});
   const body=await response.json();
   if(!response.ok){if(response.status<500)payload.current=null;throw new Error(body.error||"Could not convert document.");}
   if(body.kind!==target||target==="note"&&!body.note||target!=="note"&&!body.workspace)throw new Error("Conversion could not be confirmed. Retry safely.");
   if(mounted.current){onConverted(body);onClose();}
  }catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:"Could not convert document.");}
  finally{pending.current=false;if(mounted.current)setBusy(false);}
 }
 return <Dialog open onOpenChange={open=>{if(!open&&!pending.current)onClose();}}><DialogContent showCloseButton={!busy}>
  <DialogHeader><DialogTitle>Convert to {DOCUMENT_LABELS[target]}</DialogTitle><DialogDescription>
   A {DOCUMENT_LABELS[target].toLowerCase()} copy keeps the title and Markdown. The original, its links and any subfiles stay unchanged.
   {target==="note"?" The note goes into the same project’s notebook, or No Project.":source.kind==="note"?" A new chat in the same project will contain the document.":" The converted document stays in this chat."}
  </DialogDescription></DialogHeader>
  <p className="min-w-0 truncate text-sm font-medium">{source.title}</p>
  {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
  <DialogFooter><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={()=>void convert()}>{busy?<LoaderCircle className="size-4 animate-spin"/>:null}{busy?"Converting…":error?"Retry conversion":"Convert to "+DOCUMENT_LABELS[target]}</Button></DialogFooter>
 </DialogContent></Dialog>;
}
