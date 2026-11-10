import React from "react";
import {createRoot} from "react-dom/client";
import {DesktopAssistant} from "../components/desktop-assistant";
const mode=new URLSearchParams(location.search).get("mode")||"text";
const pause=(ms=30)=>new Promise(resolve=>setTimeout(resolve,ms));
const checks:string[]=[];
function check(value:unknown,label:string){checks.push((value?"PASS ":"FAIL ")+label);if(!value)throw Error(label);}
let gesture:(value:string)=>void=()=>{},captured=0,submitted=0,post:Record<string,unknown>|null=null;
let recordingStopped=0,releasePermission:(()=>void)|null=null;
Object.defineProperty(window,"metisAssistant",{value:{
 ready:async()=>({gestures:[],device:{hostname:"Fixture PC",clientId:"fixture-client"}}),
 onGesture:(callback:(value:string)=>void)=>{gesture=callback;return ()=>{};},
 voice:()=>{},resize:async()=>{},close:async()=>gesture("cancel"),openChat:async()=>{},
 capture:async()=>{captured++;return {device:{clientId:"fixture-client",hostname:"Fixture PC",platform:"win32",version:"fixture"},capturedAt:new Date().toISOString(),monitors:[{id:"left",name:"Left",primary:false,bounds:{x:-1920,y:0,width:1920,height:1080},scaleFactor:1,image:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="},{id:"main",name:"Main",primary:true,bounds:{x:0,y:0,width:1920,height:1080},scaleFactor:1,image:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="}]};}
}});
Object.defineProperty(window,"AudioContext",{value:undefined,configurable:true});
Object.defineProperty(navigator,"mediaDevices",{value:{getUserMedia:async()=>{
 if(mode==="permission")await new Promise<void>(resolve=>{releasePermission=resolve;});
 return {getTracks:()=>[{stop(){recordingStopped++;}}],getAudioTracks:()=>[{}]};
}},configurable:true});
class Recorder {
 static isTypeSupported(){return true;} state="inactive";ondataavailable:((event:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;
 start(){this.state="recording";}
 stop(){this.state="inactive";this.ondataavailable?.({data:new Blob(["fixture audio"],{type:"audio/webm"})});this.onstop?.();}
}
window.MediaRecorder=Recorder as unknown as typeof MediaRecorder;
class Channel {
 readyState="connecting";onopen:(()=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;onmessage:((event:{data:string})=>void)|null=null;
 close(){this.readyState="closed";this.onclose?.();}
 receive(value:unknown){this.onmessage?.({data:JSON.stringify(value)});}
 send(){this.receive({type:"input_audio_buffer.committed",item_id:"one"});this.receive({type:"conversation.item.input_audio_transcription.completed",item_id:"one",transcript:"Final realtime words"});}
}
class Peer {
 static last:Peer;channel=new Channel();connectionState="connected";onconnectionstatechange:(()=>void)|null=null;
 constructor(){Peer.last=this;}createDataChannel(){return this.channel;}addTrack(){}async createOffer(){return {type:"offer",sdp:"fixture-offer"};}
 async setLocalDescription(){}async setRemoteDescription(){this.channel.readyState="open";this.channel.onopen?.();}close(){}
}
window.RTCPeerConnection=Peer as unknown as typeof RTCPeerConnection;
let jobPolls=0;
const nativeFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
 const url=String(input);
 if(url.startsWith("data:"))return nativeFetch(input,init);
 if(url==="/api/voice/realtime")return Response.json({value:"fixture-ephemeral"});
 if(url==="https://api.openai.com/v1/realtime/calls")return new Response("fixture-sdp");
 if(url==="/api/preferences")return Response.json({settings:{voiceInput:mode==="text"?{enabled:false}:{enabled:true,provider:"openai",connectionId:"fixture",modelId:"fixture",realtime:mode==="realtime",maxDurationSeconds:60}}});
 if(url==="/api/chats")return Response.json({chat:{id:"fixture-chat"}});
 if(url==="/api/file-uploads")return Response.json({id:"fixture-upload-"+captured});
 if(url.startsWith("/api/file-uploads/"))return Response.json({id:"fixture-upload",name:"Monitor.png",mimeType:"image/png",size:32,kind:"image",offset:999999});
 if(url==="/api/chat"){submitted++;post=JSON.parse(String(init?.body));return Response.json({jobId:"fixture-job"});}
 if(url.startsWith("/api/chats/"))return Response.json({chat:{runStatus:"completed",messages:[{role:"assistant",content:"Both monitors are attached."}]}});
 if(url==="/api/voice/transcribe"){jobPolls++;return Response.json({transcript:"Transcribed fixture words",job:{id:"fixture-voice",status:"completed",transcript:"Transcribed fixture words"}});}
 throw Error("Unexpected "+url);
};
// Upload transport; file bytes stay inside this fixture.
class XHR {
 upload={};status=200;responseText="{}";onload:(()=>void)|null=null;onerror:(()=>void)|null=null;onabort:(()=>void)|null=null;
 open(){}setRequestHeader(){}send(){setTimeout(()=>this.onload?.(),1);}abort(){this.onabort?.();}
}
window.XMLHttpRequest=XHR as unknown as typeof XMLHttpRequest;
createRoot(document.getElementById("root")!).render(<DesktopAssistant/>);
async function until(predicate:()=>unknown){for(let i=0;i<200;i++){if(predicate())return;await pause();}throw Error("Timed out");}
async function run(){
 await until(()=>document.querySelector("textarea"));
 await pause(100);
 if(mode==="text"){
  check(document.body.textContent?.includes("Voice is not configured"),"Unconfigured voice retains text input");
  const input=document.querySelector("textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Compare my monitors");
  input.dispatchEvent(new Event("input",{bubbles:true}));await pause();
  document.querySelector<HTMLButtonElement>('[aria-label="Send message with all monitors"]')!.click();
  await until(()=>submitted>0);
  check(captured===1,"Captures only on explicit send");
  check((post?.uploadIds as string[]).length===2,"Both monitor images use registered uploads");
  check(String(post?.referenceText).includes('"x":-1920'),"Monitor positions reach the agent");
  check(String(post?.referenceText).includes("fixture-client"),"Origin device reaches the agent");
  await until(()=>document.body.textContent?.includes("Both monitors are attached."));
  check(true,"Answer appears inside floating assistant");
 } else {
  gesture("start");
  if(mode==="permission"){
    await until(()=>releasePermission);
    gesture("stop");await pause();releasePermission?.();
    await pause(150);check(recordingStopped>0,"Release during permission request closes late microphone");
    check(!document.querySelector('[aria-label="Stop assistant recording"]'),"Permission race cannot leave capture running");
  }else{
    await until(()=>document.querySelector('[aria-label="Stop assistant recording"]'));
    if(mode==="realtime"){
      Peer.last.channel.receive({type:"conversation.item.input_audio_transcription.delta",item_id:"one",delta:"Live realtime words"});
      await until(()=>document.querySelector('[aria-label="Live transcription"]')?.textContent?.includes("Live realtime words"));
      check(true,"Realtime transcript appears while recording");
    }else check(!document.querySelector('[aria-label="Live transcription"]'),"Batch Whisper does not show live transcription");
    gesture("lock");await pause();check(document.body.textContent?.includes("Locked"),"Long hold locks recording");
    gesture("stop");await until(()=>document.querySelector("textarea")!.value.includes(mode==="realtime"?"Final realtime":"Transcribed"));
    check(mode==="realtime"||jobPolls>0,"Release uses configured transcription API");
    check(submitted===0,"Transcription preserves a reviewable draft");
  }
 }
 check(document.documentElement.scrollWidth<=innerWidth,"No horizontal overflow");
 await nativeFetch("/result",{method:"POST",body:JSON.stringify({mode,checks,passed:true})});
}
run().catch(async error=>{await nativeFetch("/result",{method:"POST",body:JSON.stringify({mode,checks,passed:false,error:String(error)})});});
