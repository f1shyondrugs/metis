"use client";
import {useCallback,useLayoutEffect,useRef,useState,type ReactNode,type PointerEvent} from "react";
import {SlidersHorizontal,MoveDiagonal2,GripHorizontal} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Popover,PopoverContent,PopoverTrigger} from "@/components/ui/popover";
import {assistantPanelSize,DEFAULT_ASSISTANT_PANEL,type AssistantPanelSize} from "@/lib/desktop-assistant-session";
type Position={right:number;top:number};
type Drag={x:number;y:number;width:number;height:number;id:number;mode:"move"|"resize";position:Position};
export function AssistantConversationPanel({size,onChange,onMenuOpen,actions,children,messageKey=""}:{size:AssistantPanelSize;onChange:(size:AssistantPanelSize,commit:boolean)=>void;onMenuOpen:(open:boolean)=>void;actions:ReactNode;children:ReactNode;messageKey?:string}){
 const panel=useRef<HTMLElement>(null),drag=useRef<Drag|null>(null),current=useRef(size);current.current=size;
 const [gesture,setGesture]=useState<Drag["mode"]|null>(null),[position,setPosition]=useState<Position>({right:20,top:20});
 const [auto,setAuto]=useState(true),[extent,setExtent]=useState(size),[viewport,setViewport]=useState({width:0,height:0});
 const positionRef=useRef(position);positionRef.current=position;
 const bounds=useCallback(()=>{const node=panel.current,root=node?.parentElement;const compose=root?parseFloat(getComputedStyle(root).getPropertyValue("--assistant-compose-height"))||120:120;return {width:Math.max(0,innerWidth-32),height:Math.max(120,innerHeight-compose-52)};},[]);
 useLayoutEffect(()=>{const update=()=>setViewport(bounds());update();addEventListener("resize",update);const root=panel.current?.parentElement,observer=new ResizeObserver(update);if(root)observer.observe(root);const mutations=new MutationObserver(update);if(root)mutations.observe(root,{attributes:true,attributeFilter:["style"]});return()=>{removeEventListener("resize",update);observer.disconnect();mutations.disconnect();};},[bounds]);
 useLayoutEffect(()=>{setExtent(current.current);setAuto(true);},[messageKey]); // A new reply starts from the preferred minimum, not the previous reply's maximum.
 useLayoutEffect(()=>{
  const element=panel.current;if(!element||!auto||gesture)return;
  let frame=0;
  const measure=()=>{frame=0;const latest=element.querySelector<HTMLElement>(".assistant-message-assistant:last-of-type");if(!latest)return;
   const room=bounds(),header=element.querySelector("header")?.getBoundingClientRect().height||44;
   const minimum={width:Math.max(DEFAULT_ASSISTANT_PANEL.width,size.width),height:Math.max(DEFAULT_ASSISTANT_PANEL.height,size.height)};
   setExtent(old=>{
    const height=Math.min(room.height,Math.max(minimum.height,old.height,latest.scrollHeight+header+64));
    const width=Math.min(room.width,Math.max(minimum.width,old.width,latest.scrollHeight>room.height*.75?Math.min(720,old.width+64):0));
    return old.width===width&&old.height===height?old:{width,height};
   });
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
  const resize=new ResizeObserver(schedule);element.querySelectorAll(".assistant-message-assistant").forEach(node=>resize.observe(node));
  const mutation=new MutationObserver(()=>{element.querySelectorAll(".assistant-message-assistant").forEach(node=>resize.observe(node));schedule();});
  mutation.observe(element,{childList:true,subtree:true,characterData:true});schedule();
  return()=>{cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();};
 },[auto,gesture,messageKey,size,bounds]);
 const rendered=auto?extent:size;
 const width=Math.min(rendered.width,viewport.width||rendered.width),height=Math.min(rendered.height,viewport.height||rendered.height);
 const right=Math.max(16,Math.min(position.right,(viewport.width||innerSafeWidth())-width+16)),top=Math.max(16,Math.min(position.top,(viewport.height||height)-height+20));
 function innerSafeWidth(){return typeof window==="undefined"?size.width:innerWidth-32;}
 const change=(next:AssistantPanelSize,commit=true)=>{setAuto(false);onChange(assistantPanelSize(next),commit);};
 function start(event:PointerEvent<HTMLElement>,mode:Drag["mode"]){
  if(event.button!==0||!panel.current)return;
  if(mode==="move"&&(event.target as HTMLElement).closest("button:not([data-assistant-move]),input,a"))return;
  event.preventDefault();const rect=panel.current.getBoundingClientRect();
  drag.current={x:event.clientX,y:event.clientY,width:rect.width,height:rect.height,id:event.pointerId,mode,position:{right,top}};
  event.currentTarget.setPointerCapture(event.pointerId);setGesture(mode);if(mode==="resize"){onChange(assistantPanelSize({width:rect.width,height:rect.height}),false);setAuto(false);}
 }
 function move(event:PointerEvent<HTMLElement>){
  const start=drag.current;if(!start||start.id!==event.pointerId)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y,room=bounds();
  if(start.mode==="move")setPosition({right:Math.max(16,Math.min(innerWidth-start.width-16,start.position.right-dx)),top:Math.max(16,Math.min(room.height-start.height+20,start.position.top+dy))});
  else change({width:Math.min(room.width,start.width-dx),height:Math.min(room.height,start.height+dy)},false);
 }
 function end(event:PointerEvent<HTMLElement>){const start=drag.current;if(!start)return;drag.current=null;setGesture(null);if(event.currentTarget?.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(start.mode==="resize")change(current.current);}
 useLayoutEffect(()=>{
  if(!gesture)return;
  const motion=(event:globalThis.PointerEvent)=>move(event as unknown as PointerEvent<HTMLElement>);
  const finish=(event:globalThis.PointerEvent)=>end(event as unknown as PointerEvent<HTMLElement>);
  const blur=()=>{drag.current=null;setGesture(null);};
  addEventListener("pointermove",motion,true);addEventListener("pointerup",finish,true);addEventListener("pointercancel",finish,true);addEventListener("blur",blur);
  return()=>{removeEventListener("pointermove",motion,true);removeEventListener("pointerup",finish,true);removeEventListener("pointercancel",finish,true);removeEventListener("blur",blur);};
 });
 return <aside ref={panel} className="assistant-conversation assistant-surface" aria-label="Desktop conversation" data-resizing={gesture==="resize"} data-gesture={gesture||""}
  style={{width,height,right,top,maxHeight:viewport.height||undefined}}>
  <header className="assistant-conversation-header" data-assistant-drag onPointerDown={event=>start(event,"move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
   <button type="button" data-assistant-move aria-label="Move conversation" title="Drag to move. Arrow keys move the conversation." onKeyDown={event=>{
    const step=event.shiftKey?80:20;if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))return;event.preventDefault();
    setPosition({right:positionRef.current.right+(event.key==="ArrowLeft"?step:event.key==="ArrowRight"?-step:0),top:positionRef.current.top+(event.key==="ArrowDown"?step:event.key==="ArrowUp"?-step:0)});
   }}><GripHorizontal aria-hidden className="size-4"/></button><span className="mr-auto text-xs font-medium">Metis</span>
   <div className="flex items-center gap-1">
    <Popover onOpenChange={onMenuOpen}><PopoverTrigger asChild><Button type="button" size="icon-action" variant="ghost" aria-label="Conversation size"><SlidersHorizontal className="size-4"/></Button></PopoverTrigger>
     <PopoverContent className="assistant-input assistant-size-options w-64" align="end" collisionPadding={8}>
      <label>Width <input aria-label="Conversation width" type="range" min="280" max="1200" step="20" value={size.width} onChange={e=>change({...size,width:Number(e.target.value)})}/></label>
      <label>Height <input aria-label="Conversation height" type="range" min="160" max="1200" step="20" value={size.height} onChange={e=>change({...size,height:Number(e.target.value)})}/></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={auto} onChange={e=>{setExtent(size);setAuto(e.target.checked);}}/>Fit latest reply automatically</label>
      <Button variant="ghost" size="sm" onClick={()=>{onChange(DEFAULT_ASSISTANT_PANEL,true);setExtent(DEFAULT_ASSISTANT_PANEL);setAuto(true);setPosition({right:20,top:20});}}>Reset size and position</Button>
     </PopoverContent></Popover>
    {actions}
   </div>
  </header>
  {children}
  <button type="button" className="assistant-resize-handle" data-assistant-resize aria-label="Resize conversation" title="Drag to resize. Arrow keys change size."
   onPointerDown={event=>start(event,"resize")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
   onKeyDown={event=>{const step=event.shiftKey?80:20;if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))return;event.preventDefault();change({width:width+(event.key==="ArrowLeft"?step:event.key==="ArrowRight"?-step:0),height:height+(event.key==="ArrowDown"?step:event.key==="ArrowUp"?-step:0)});}}><MoveDiagonal2 className="size-3.5" aria-hidden/></button>
 </aside>;
}
