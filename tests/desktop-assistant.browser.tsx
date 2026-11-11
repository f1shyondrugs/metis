import React from "react";
import {createRoot} from "react-dom/client";
import {DesktopAssistant} from "../components/desktop-assistant";
const mode=new URLSearchParams(location.search).get("mode")||"text";
const realtime=mode.startsWith("realtime"),manual=mode.endsWith("edit");
const models=[{id:"fixture/first",providerId:"fixture",displayName:"First model",parameters:[],defaultParams:[]},{id:"fixture/recent",providerId:"fixture",displayName:"Recent model",parameters:[{id:"effort",values:[{value:"high"},{value:"low"}]}],defaultParams:[{id:"effort",value:"low"}]}];
localStorage.setItem("metis-ai_model","fixture/recent");
localStorage.setItem("metis-ai_model_params",JSON.stringify([{id:"effort",value:"high"}]));
const pause=(ms=30)=>new Promise(resolve=>setTimeout(resolve,ms));
const checks:string[]=[];
function check(value:unknown,label:string){checks.push((value?"PASS ":"FAIL ")+label);if(!value)throw Error(label);}
let gesture:(value:string)=>void=()=>{},captured=0,submitted=0,post:Record<string,unknown>|null=null;
let recordingStopped=0,releasePermission:(()=>void)|null=null,releaseTranscript:(()=>void)|null=null,editing=false,autoFocus=true,openedChat:string|null=null;
let created:Record<string,unknown>|null=null,releaseModels:(()=>void)|null=null;
let preferenceParams:Record<string,Array<{id:string;value:string}>>={"unrelated/model":[{id:"effort",value:"medium"}]};
const shortcuts={assistant:"Control+Shift+Space",focusInput:"Control+Shift+Enter",openChat:"Control+Shift+M",deviceSettings:"Control+Shift+D",cancel:"Escape"};
const game=document.createElement("button");game.textContent="Game keeps keyboard focus";game.id="fixture-game";document.body.append(game);game.focus();
Object.defineProperty(window,"metisAssistant",{value:{
 ready:async()=>({gestures:[],device:{hostname:"Fixture PC",clientId:"fixture-client",platform:"win32"},shortcuts,editing:false}),
 onGesture:(callback:(value:string)=>void)=>{gesture=callback;return ()=>{};},
 voice:()=>{},resize:async()=>{},close:async()=>gesture("cancel"),openChat:async(id:string|null)=>{openedChat=id;},
 configure:async(value:{voiceConfigured:boolean})=>{if(autoFocus){editing=!value.voiceConfigured;autoFocus=false;if(editing)gesture("focus-input");}return {editing,shortcuts};},
 focusInput:async(value:boolean)=>{editing=value;gesture(value?"focus-input":"passive");},
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
 if(url==="/api/models"){if(mode==="models-pending")await new Promise<void>(resolve=>{releaseModels=resolve;});return Response.json({models});}
 if(url==="/api/preferences"){if(init?.method==="PATCH")preferenceParams=JSON.parse(String(init.body)).modelParamsByModel;return Response.json({settings:{modelId:"fixture/first",modelParamsByModel:preferenceParams,voiceInput:["text","error","options","tools"].includes(mode)?{enabled:false}:{enabled:true,provider:"openai",connectionId:"fixture",modelId:"fixture",realtime,maxDurationSeconds:60}}});}
 if(url==="/api/chats"){created=JSON.parse(String(init?.body));return Response.json({chat:{id:"fixture-chat"}});}
 if(url.startsWith("/api/runs?"))return Response.json({job:{id:"fixture-job",status:mode==="error"?"error":"completed",error:mode==="error"?"Fixture provider rejected the request.":undefined}});
 if(url==="/api/file-uploads")return Response.json({id:"fixture-upload-"+captured});
 if(url.startsWith("/api/file-uploads/"))return Response.json({id:"fixture-upload",name:"Monitor.png",mimeType:"image/png",size:32,kind:"image",offset:999999});
 if(url==="/api/chat"){submitted++;post=JSON.parse(String(init?.body));return Response.json({jobId:"fixture-job"});}
 if(url.startsWith("/api/chats/")&&init?.method==="PATCH")return Response.json({chat:JSON.parse(String(init.body))});
 if(url.startsWith("/api/chats/"))return Response.json({chat:{runStatus:mode==="error"?"running":"completed",messages:[{id:post?.messageId,role:"user",content:post?.message},{id:"fixture-answer",role:"assistant",content:"Both monitors are attached.",...(mode==="tools"?{parts:[
   {type:"thinking",content:"Inspecting the owned fixture directory",done:true,durationMs:2100},
   {type:"tool",id:"fixture-command",name:"execute_command",kind:"shell",source:"mcp",status:"completed",input:JSON.stringify({command:"pwd",target:"client:fixture-client"}),result:JSON.stringify({stdout:"C:\\Fixture",exitCode:0})},
   {type:"text",content:"Both monitors are attached."}
 ]}:{})}]}});
 if(url==="/api/voice/transcribe"){jobPolls++;if(mode==="delayed-edit")await new Promise<void>(resolve=>{releaseTranscript=resolve;});return Response.json({transcript:"Transcribed fixture words",job:{id:"fixture-voice",status:"completed",transcript:"Transcribed fixture words"}});}
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
 if(mode!=="models-pending")check(document.querySelector('[aria-label="Assistant model"]')?.textContent?.includes("Recent model"),"Uses the same latest local model as New chat, not the legacy server default");
 if(["text","error","options","tools"].includes(mode)){
  check(document.activeElement===document.querySelector("textarea"),"Without voice the text field is focused after rendering");
  check(document.querySelector("textarea")!.placeholder==="Ask Metis","Compact field uses the requested placeholder");
  if(mode==="options"){
    const options=document.querySelector<HTMLButtonElement>('[aria-label="Model options"]')!;
    options.click();await until(()=>document.querySelector(".assistant-options-menu"));
    const low=[...document.querySelectorAll<HTMLButtonElement>(".assistant-options-menu button")].find(node=>node.textContent?.trim()==="low")!;
    check(Boolean(low),"Thinking options come from the selected model contract");
    low.click();await until(()=>preferenceParams["fixture/recent"]?.some(p=>p.value==="low"));
    check(preferenceParams["unrelated/model"][0].value==="medium","Saving Thinking keeps other models' remembered settings");
    await until(()=>!options.disabled);options.click();await pause();
  }
  const input=document.querySelector("textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Compare my monitors");
  input.dispatchEvent(new Event("input",{bubbles:true}));await pause();
  document.querySelector<HTMLButtonElement>('[aria-label="Send message with all monitors"]')!.click();
  await until(()=>submitted>0);
  check(captured===1,"Captures only on explicit send");
  check((post?.uploadIds as string[]).length===2,"Both monitor images use registered uploads");
  check(String(post?.referenceText).includes('"x":-1920'),"Monitor positions reach the agent");
  check(String(post?.referenceText).includes("fixture-client"),"Origin device reaches the agent");
  check(post?.modelId==="fixture/recent"&&created?.modelId==="fixture/recent","The chat and actual submitted job receive the selected account model");
  check(JSON.stringify(post?.modelParams)===JSON.stringify([{id:"effort",value:mode==="options"?"low":"high"}]),"The actual job receives the selected Thinking setting");
  if(mode==="error"){
    await until(()=>document.body.textContent?.includes("Fixture provider rejected the request."));
    check(!document.querySelector(".assistant-working"),"A failed job ends the working indicator even when chat.runStatus is stale");
    await nativeFetch("/result",{method:"POST",body:JSON.stringify({mode,width:innerWidth,height:innerHeight,checks,passed:true})});return;
  }
  await until(()=>document.body.textContent?.includes("Both monitors are attached."));
  check(true,"Answer appears inside floating assistant");
  if(mode==="tools"){
    const group=document.querySelector<HTMLElement>("[data-tool-call-group]")!;
    check(Boolean(group),"Canonical tool and Thinking parts use the normal Metis activity group");
    const toggle=group.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    check(toggle.getAttribute("aria-expanded")==="false","Completed tool details start collapsed");
    toggle.click();await until(()=>document.querySelector("[data-tool-call-row]"));
    const thought=group.querySelector<HTMLButtonElement>('button[aria-label^="Thought"]');
    thought?.click();await pause();
    check(group.textContent?.includes("Inspecting the owned fixture directory"),"Saved Thinking is available in the activity group");
    const tool=document.querySelector<HTMLButtonElement>("[data-tool-call-row] button")!;
    tool.click();await until(()=>document.querySelector('[aria-label="Command details"]'));
    check(document.querySelector('[aria-label="Command details"]')?.textContent?.includes("C:\\Fixture"),"The shared tool preview shows its saved result");
    openedChat=null;
    document.querySelector<HTMLButtonElement>('[aria-label="Show raw tool information"]')!.click();
    await until(()=>openedChat==="fixture-chat");
    check(true,"Full tool details open the same normal Metis chat");
    tool.click();await pause();
  }
  const card=document.querySelector(".assistant-conversation")!, user=card.querySelector('[aria-label="Your message"]')!, reply=card.querySelector('[aria-label="Metis reply"]')!;
  check(Boolean(user.compareDocumentPosition(reply)&Node.DOCUMENT_POSITION_FOLLOWING),"Your canonical message appears above the canonical reply");
  check(card.getBoundingClientRect().right>innerWidth-40,"Conversation is anchored at the top right");
  document.querySelector<HTMLButtonElement>('[aria-label="Open in Metis"]')!.click();await pause();
  check(openedChat==="fixture-chat","Open chat targets the same persisted chat");
  const trigger=document.querySelector<HTMLButtonElement>('[aria-label="Assistant model"]')!;
  trigger.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,pointerType:"mouse"}));
  await until(()=>document.querySelector(".assistant-model-menu"));
  check(document.querySelector(".assistant-model-menu")?.classList.contains("assistant-input"),"Portaled model menu participates in existing native hit regions");
  const first=[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node=>node.textContent?.includes("First model"))!;
  first.click();await until(()=>trigger.textContent?.includes("First model"));
  check(localStorage.getItem("metis-ai_model")==="fixture/first","Changing assistant model updates the same latest model used by New chat");
 } else {
  check(document.activeElement===game,"Voice mode leaves the existing game control focused");
  gesture("start");
  if(mode==="permission"){
    await until(()=>releasePermission);
    gesture("stop");await pause();releasePermission?.();
    await pause(150);check(recordingStopped>0,"Release during permission request closes late microphone");
    check(!document.querySelector('[aria-label="Stop assistant recording"]'),"Permission race cannot leave capture running");
  }else{
    await until(()=>document.querySelector('[aria-label="Stop assistant recording"]'));
    autoFocus=true;gesture("open");await pause(100);
    check(Boolean(document.querySelector('[aria-label="Stop assistant recording"]')),"Reopening does not remount or cancel voice capture");
    check(document.activeElement===game,"Recording still leaves the game focused");
    if(realtime){
      Peer.last.channel.receive({type:"conversation.item.input_audio_transcription.delta",item_id:"one",delta:"Live realtime words"});
      await until(()=>document.querySelector('[aria-label="Live transcription"]')?.textContent?.includes("Live realtime words"));
      check(true,"Realtime transcript appears while recording");
    }else check(!document.querySelector('[aria-label="Live transcription"]'),"Batch Whisper does not show live transcription");
    check(!document.body.textContent?.includes("Locked"),"Recording does not require a held or locked hotkey");
    if(manual&&mode!=="delayed-edit")gesture("focus-input");
    gesture("stop");
    if(realtime){await pause(60);check(submitted===0,"Streamed preview is not sent before the final transcript");}
    if(mode==="delayed-edit"){await until(()=>releaseTranscript);gesture("focus-input");releaseTranscript?.();}
    if(mode==="models-pending"){await until(()=>document.querySelector("textarea")!.value.includes("Transcribed"));check(submitted===0&&captured===0,"Voice records and transcribes immediately while model discovery is pending");releaseModels?.();}
    if(manual){
      await until(()=>document.querySelector("textarea")!.value.includes(realtime?"Final realtime":"Transcribed"));
      await pause(150);
      check(submitted===0&&captured===0,"Entering the input during recording or transcription keeps a reviewable draft and captures no screens");
    }else{
      await until(()=>submitted===1);
      check(post?.message===(realtime?"Final realtime words":"Transcribed fixture words"),"Automatically sends the final transcript without requiring Enter");
      check(post?.modelId==="fixture/recent","Automatic send uses the latest selected model");
      check((post?.uploadIds as string[]).length===2,"Automatic send keeps both registered screen attachments");
      await until(()=>document.body.textContent?.includes("Both monitors are attached."));
      check(!document.querySelector(".assistant-working"),"The canonical reply is displayed and working ends");
    }
    check(realtime||jobPolls>0,"Stop uses configured transcription API");
  }
 }
 check(document.documentElement.scrollWidth<=innerWidth,"No horizontal overflow");
 await nativeFetch("/result",{method:"POST",body:JSON.stringify({mode,width:innerWidth,height:innerHeight,checks,passed:true})});
}
run().catch(async error=>{await nativeFetch("/result",{method:"POST",body:JSON.stringify({mode,checks,passed:false,error:String(error)})});});
