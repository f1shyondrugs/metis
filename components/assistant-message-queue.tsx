"use client";
import {ArrowDown,ArrowUp,GripVertical,Pencil,X,Send} from "lucide-react";
import {Button} from "@/components/ui/button";
import {QueuedPromptPreview} from "@/components/queued-prompt-preview";
import type {AssistantQueuedMessage} from "@/lib/desktop-assistant-session";
export function AssistantMessageQueue({messages,disabled,canEdit,onEdit,onRemove,onMove,onSend}:{messages:AssistantQueuedMessage[];disabled:boolean;canEdit:boolean;onEdit:(message:AssistantQueuedMessage)=>void;onRemove:(message:AssistantQueuedMessage)=>void;onMove:(id:string,offset:number)=>void;onSend:(message:AssistantQueuedMessage)=>void}){
 if(!messages.length)return null;
 return <section className="assistant-queue" aria-label="Queued messages">
  <div className="assistant-queue-title">Queued messages ({messages.length})</div>
  {messages.map((message,index)=><div key={message.id} className="assistant-queue-item group/queue" aria-label={"Queued message "+(index+1)}>
   <GripVertical className="size-3.5 shrink-0 mt-2" aria-hidden="true"/>
   <div className="min-w-0 flex-1">
    <QueuedPromptPreview text={index+1+". "+(message.text||"Attached files")}/>
    {message.attachments?.length?<span className="assistant-queue-context">{message.attachments.length} attached file(s)</span>:null}
    <div className="assistant-queue-actions">
     <Button type="button" size="icon-action" variant="ghost" aria-label={"Move queued message "+(index+1)+" up"} disabled={disabled||index===0} onClick={()=>onMove(message.id,-1)}><ArrowUp className="size-3.5"/></Button>
     <Button type="button" size="icon-action" variant="ghost" aria-label={"Move queued message "+(index+1)+" down"} disabled={disabled||index===messages.length-1} onClick={()=>onMove(message.id,1)}><ArrowDown className="size-3.5"/></Button>
     <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={()=>onSend(message)}><Send className="size-3.5"/>Send now</Button>
     <Button type="button" size="icon-action" variant="ghost" aria-label={"Edit queued message "+(index+1)} disabled={disabled||!canEdit} title={!canEdit?"Send or clear your current draft first":"Edit queued message"} onClick={()=>onEdit(message)}><Pencil className="size-3.5"/></Button>
     <Button type="button" size="icon-action" variant="ghost" aria-label={"Remove queued message "+(index+1)} disabled={disabled} onClick={()=>onRemove(message)}><X className="size-3.5"/></Button>
    </div>
   </div>
  </div>)}
 </section>;
}
