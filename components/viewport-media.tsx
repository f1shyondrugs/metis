"use client";
import {useEffect,useRef,useState} from "react";

type Props={kind:"video"|"audio";src:string;name:string;className?:string;controls?:boolean;onError:()=>void};
/** Keep native playback, but do not retain decoders/buffers for paused off-screen previews. */
export function ViewportMedia({kind,src,name,className,controls=true,onError}:Props){
 const ref=useRef<HTMLVideoElement & HTMLAudioElement>(null);
 const [near,setNear]=useState(false),[playing,setPlaying]=useState(false),[focused,setFocused]=useState(false);
 const position=useRef(0),generation=useRef(src);
 if(generation.current!==src){generation.current=src;position.current=0;}
 const active=near||playing||focused;
 useEffect(()=>{
  const node=ref.current;if(!node)return;
  if(typeof IntersectionObserver==="undefined"){setNear(true);return;}
  const observer=new IntersectionObserver(entries=>setNear(entries.some(entry=>entry.isIntersecting)),{rootMargin:"200px"});
  observer.observe(node);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  const node=ref.current;if(!node)return;
  if(active){node.src=src;node.load();}
  return()=>{
   if(node.getAttribute("src")===src){
    if(Number.isFinite(node.currentTime) && node.readyState>0)position.current=node.currentTime;
    node.pause();node.removeAttribute("src");node.load();
   }
  };
 },[active,src]);
 const Tag=kind==="video"?"video":"audio";
 return <Tag ref={ref} controls={controls} {...(kind==="video"?{playsInline:true}:{})}
  preload="metadata" aria-label={name} className={className} style={kind==="video"?{aspectRatio:"16 / 9"}:undefined} data-viewport-media={kind} data-media-active={active?"true":"false"}
  onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}
  onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
  onLoadedMetadata={()=>{const node=ref.current;if(node&&position.current>0)node.currentTime=Math.min(position.current,Number.isFinite(node.duration)?node.duration:position.current);}}
  onError={()=>{if(ref.current?.getAttribute("src")===src)onError();}}/>;
}
