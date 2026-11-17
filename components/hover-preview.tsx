"use client";

import {cloneElement,isValidElement,useCallback,useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode,type MouseEvent as ReactMouseEvent} from "react";
import {createPortal} from "react-dom";
import {positionLinkPreview} from "@/lib/link-preview-position";

let activePreview:{id:string;dismiss:()=>void}|null=null;

/** Shared hover/focus lifecycle; the card activates its original link, retaining its routing policy. */
export function HoverPreview({children,content,anchorElement,onDismiss}:{children?:ReactNode;content:ReactNode;anchorElement?:HTMLElement|null;onDismiss?:()=>void}){
 const [open,setOpen]=useState(false),id=useId();
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),opened=useRef(false);
 const anchor=useRef<HTMLSpanElement>(null),tooltip=useRef<HTMLDivElement>(null),dismissCallback=useRef(onDismiss);
 dismissCallback.current=onDismiss;
 const clearTimer=useCallback(()=>{if(timer.current!==null){clearTimeout(timer.current);timer.current=null;}},[]);
 const target=useCallback(()=>anchorElement||anchor.current?.querySelector<HTMLAnchorElement>("a[href]")||null,[anchorElement]);
 const hide=useCallback(()=>{
  clearTimer();if(activePreview?.id===id)activePreview=null;
  opened.current=false;setOpen(false);dismissCallback.current?.();
 },[clearTimer,id]);
 const show=useCallback(()=>{
  clearTimer();if(opened.current)return;
  timer.current=setTimeout(()=>{timer.current=null;activePreview?.dismiss();activePreview={id,dismiss:hide};opened.current=true;setOpen(true);},180);
 },[clearTimer,hide,id]);
 const scheduleHide=useCallback(()=>{clearTimer();timer.current=setTimeout(hide,180);},[clearTimer,hide]);
 useEffect(()=>()=>{clearTimer();if(activePreview?.id===id)activePreview=null;},[clearTimer,id]);
 useLayoutEffect(()=>{
  if(!open||!tooltip.current)return;
  const node=tooltip.current;
  const update=()=>{const element=anchorElement||anchor.current;if(!element?.isConnected){hide();return;}
   const position=positionLinkPreview(element.getBoundingClientRect(),{width:node.offsetWidth,height:node.offsetHeight,left:0,top:0,bottom:0},innerWidth,innerHeight);
   node.style.left=position.left+"px";node.style.top=position.top+"px";node.dataset.side=position.side;node.style.visibility="visible";
  };
  update();const observer=new ResizeObserver(update);observer.observe(node);
  window.addEventListener("scroll",update,true);window.addEventListener("resize",update);window.visualViewport?.addEventListener("resize",update);
  return()=>{observer.disconnect();window.removeEventListener("scroll",update,true);window.removeEventListener("resize",update);window.visualViewport?.removeEventListener("resize",update);};
 },[open,anchorElement,hide]);
 useEffect(()=>{
  if(!anchorElement)return;
  show();
  const leave=(event:MouseEvent)=>{if(!tooltip.current?.contains(event.relatedTarget as Node|null))scheduleHide();};
  const blur=(event:FocusEvent)=>{if(!tooltip.current?.contains(event.relatedTarget as Node|null))scheduleHide();};
  const key=(event:KeyboardEvent)=>{if(event.key==="ArrowDown"&&opened.current){event.preventDefault();tooltip.current?.querySelector<HTMLButtonElement>("[data-preview-open-link]")?.focus();}};
  anchorElement.addEventListener("mouseenter",show);anchorElement.addEventListener("mouseleave",leave);
  anchorElement.addEventListener("focus",show);anchorElement.addEventListener("blur",blur);anchorElement.addEventListener("click",hide);anchorElement.addEventListener("keydown",key);
  return()=>{clearTimer();anchorElement.removeEventListener("mouseenter",show);anchorElement.removeEventListener("mouseleave",leave);anchorElement.removeEventListener("focus",show);anchorElement.removeEventListener("blur",blur);anchorElement.removeEventListener("click",hide);anchorElement.removeEventListener("keydown",key);};
 },[anchorElement,show,scheduleHide,hide,clearTimer]);
 useEffect(()=>{
  if(!open)return;
  const key=(event:KeyboardEvent)=>{if(event.key!=="Escape")return;const restore=tooltip.current?.contains(document.activeElement);hide();if(restore)target()?.focus();};
  window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);
 },[open,hide,target]);
 const activate=(event:ReactMouseEvent)=>{
  event.preventDefault();event.stopPropagation();
  const link=target();if(link?.isConnected)link.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey,altKey:event.altKey,button:0}));
  hide();
 };
 const trigger=open&&isValidElement<{"aria-describedby"?:string}>(children)?cloneElement(children,{"aria-describedby":[children.props["aria-describedby"],id].filter(Boolean).join(" ")}):children;
 return <span ref={anchor} className="inline" onMouseEnter={show} onMouseLeave={event=>{if(!tooltip.current?.contains(event.relatedTarget as Node|null)&&!target()?.contains(event.relatedTarget as Node|null))scheduleHide();}} onFocusCapture={show}
  onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)&&!tooltip.current?.contains(event.relatedTarget as Node|null))scheduleHide();}}
  onClickCapture={event=>{if(!tooltip.current?.contains(event.target as Node))hide();}}
  onKeyDown={event=>{if(event.key==="ArrowDown"&&open&&!tooltip.current?.contains(event.target as Node)){event.preventDefault();tooltip.current?.querySelector<HTMLButtonElement>("[data-preview-open-link]")?.focus();}}}>
  {anchorElement?null:trigger}
  {open?createPortal(<div ref={tooltip} id={id} role="dialog" aria-label="Link preview" data-hover-preview
   style={{visibility:"hidden",zIndex:2147483647}}
   className="hover-preview pointer-events-auto fixed w-72 max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-auto rounded-xl border border-border/70 bg-popover p-3 text-left text-popover-foreground shadow-xl"
   onMouseEnter={clearTimer} onMouseOver={clearTimer} onMouseLeave={event=>{if(!target()?.contains(event.relatedTarget as Node|null))scheduleHide();}} onFocusCapture={clearTimer} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)&&!target()?.contains(event.relatedTarget as Node|null))scheduleHide();}}
   onClick={event=>{if(!(event.target as Element).closest("a,button,input,textarea,select,[contenteditable=true]"))activate(event);}}>
    {content}
    <button type="button" data-preview-open-link className="mt-3 flex min-h-11 w-full sm:min-h-9 items-center justify-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={activate}>Open link</button>
   </div>,document.body):null}
 </span>;
}
