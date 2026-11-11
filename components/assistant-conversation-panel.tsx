"use client";
import {useRef,useState,type ReactNode} from "react";
import {SlidersHorizontal,MoveDiagonal2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Popover,PopoverContent,PopoverTrigger} from "@/components/ui/popover";
import {assistantPanelSize,DEFAULT_ASSISTANT_PANEL,type AssistantPanelSize} from "@/lib/desktop-assistant-session";
export function AssistantConversationPanel({size,onChange,onMenuOpen,actions,children}:{size:AssistantPanelSize;onChange:(size:AssistantPanelSize,commit:boolean)=>void;onMenuOpen:(open:boolean)=>void;actions:ReactNode;children:ReactNode}){
 const drag=useRef<{x:number;y:number;width:number;height:number;id:number}|null>(null),current=useRef(size);current.current=size;
 const [resizing,setResizing]=useState(false);
 const change=(next:AssistantPanelSize,commit=true)=>onChange(assistantPanelSize(next),commit);
 return <aside className="assistant-conversation assistant-surface" aria-label="Desktop conversation" data-resizing={resizing}
  style={{width:`min(${size.width}px,calc(100% - 32px))`,height:`${size.height}px`}}>
  <header className="assistant-conversation-header"><span className="text-xs font-medium">Metis</span>
   <div className="flex items-center gap-1">
    <Popover onOpenChange={onMenuOpen}><PopoverTrigger asChild><Button type="button" size="icon-action" variant="ghost" aria-label="Conversation size"><SlidersHorizontal className="size-4"/></Button></PopoverTrigger>
     <PopoverContent className="assistant-input assistant-size-options w-64" align="end" collisionPadding={8}>
      <label>Width <input aria-label="Conversation width" type="range" min="280" max="1200" step="20" value={size.width} onChange={event=>change({...size,width:Number(event.target.value)})}/></label>
      <label>Height <input aria-label="Conversation height" type="range" min="160" max="1200" step="20" value={size.height} onChange={event=>change({...size,height:Number(event.target.value)})}/></label>
      <Button variant="ghost" size="sm" onClick={()=>change(DEFAULT_ASSISTANT_PANEL)}>Reset size</Button>
     </PopoverContent></Popover>
    {actions}
   </div>
  </header>
  {children}
  <button type="button" className="assistant-resize-handle" aria-label="Resize conversation" title="Drag to resize. Arrow keys change size."
   onPointerDown={event=>{
    if(event.button!==0)return;event.preventDefault();
    const rect=event.currentTarget.parentElement!.getBoundingClientRect();
    drag.current={x:event.clientX,y:event.clientY,width:rect.width,height:rect.height,id:event.pointerId};
    event.currentTarget.setPointerCapture(event.pointerId);setResizing(true);
   }}
   onPointerMove={event=>{const start=drag.current;if(!start||start.id!==event.pointerId)return;change({width:Math.min(window.innerWidth-32,start.width+start.x-event.clientX),height:Math.min(window.innerHeight-120,start.height+event.clientY-start.y)},false);}}
   onPointerUp={event=>{if(!drag.current)return;drag.current=null;setResizing(false);event.currentTarget.releasePointerCapture(event.pointerId);change(current.current);}}
   onPointerCancel={()=>{if(!drag.current)return;drag.current=null;setResizing(false);change(current.current);}}
   onKeyDown={event=>{
    const step=event.shiftKey?80:20;
    if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))return;
    event.preventDefault();change({width:size.width+(event.key==="ArrowLeft"?step:event.key==="ArrowRight"?-step:0),height:size.height+(event.key==="ArrowDown"?step:event.key==="ArrowUp"?-step:0)});
   }}><MoveDiagonal2 className="size-3.5" aria-hidden="true"/></button>
 </aside>;
}
