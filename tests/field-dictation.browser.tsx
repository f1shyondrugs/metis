/** Real field/Ask-User/opaque-embed components with a simulated microphone and speech provider. */
import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {FieldDictationContext, DictationInput, DictationTextarea} from "../components/field-dictation";
import {QuestionForm} from "../components/question-form";
import {HtmlEmbed} from "../components/html-embed";
import {TooltipProvider} from "../components/ui/tooltip";
import {VoiceInput} from "../components/voice-input";
import type {PendingChatQuestion} from "../lib/question-contract";

const host=document.createElement("main"),report=document.createElement("pre");
document.body.append(host,report);
host.style.cssText="max-width:760px;margin:24px auto;padding:16px";
report.style.cssText="white-space:pre-wrap;padding:16px;font-size:12px";
const results:string[]=[];
const pause=(ms=30)=>new Promise(resolve=>setTimeout(resolve,ms));
function check(value:unknown,label:string){results.push((value?"PASS ":"FAIL ")+label);report.textContent=results.join("\n");if(!value)throw Error(label);}
async function until(predicate:()=>unknown,label:string){for(let i=0;i<100;i++){if(predicate())return;await pause();}throw Error("Timed out: "+label);}
let stoppedTracks=0,permissionHold=false,rejectPermission=false,releasePermission:(()=>void)|undefined,requests=0;
Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async()=>{
 if(rejectPermission)throw Error("Synthetic microphone permission denied");
 if(permissionHold)await new Promise<void>(resolve=>{releasePermission=resolve;});
 const track={enabled:true,stop(){stoppedTracks++;}};
 return {getTracks:()=>[track],getAudioTracks:()=>[track]};
}}});
let amplitude=128,normalRequests=0,finishNormal:(()=>void)|undefined;
class AudioContextStub {
 state="running";
 createAnalyser(){return {fftSize:256,getByteTimeDomainData(data:Uint8Array){data.fill(amplitude);}};}
 createMediaStreamSource(){return {connect(){}};} async close(){this.state="closed";}
}
Object.defineProperty(window,"AudioContext",{configurable:true,value:AudioContextStub});
class Recorder {
 state="inactive";mimeType="audio/webm";ondataavailable:((event:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;
 start(){this.state="recording";}
 stop(){this.state="inactive";this.ondataavailable?.({data:new Blob(["synthetic audio"])});queueMicrotask(()=>this.onstop?.());}
}
window.MediaRecorder=Recorder as unknown as typeof MediaRecorder;
window.fetch=async input=>{
 if(String(input)==="/api/voice/transcribe"){normalRequests++;await new Promise<void>(resolve=>{finishNormal=resolve;});return Response.json({transcript:"Recorded answer"});}
 if(String(input)==="/api/voice/realtime"){requests++;return Response.json({value:"ek-synthetic-field"});}
 if(String(input)==="https://api.openai.com/v1/realtime/calls")return new Response("synthetic-answer");
 throw Error("Unexpected fixture request");
};
class Channel{
 readyState="connecting";onopen:(()=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;onmessage:((event:{data:string})=>void)|null=null;
 close(){this.readyState="closed";this.onclose?.();}send(){}
 receive(data:unknown){this.onmessage?.({data:JSON.stringify(data)});}
}
class Peer{
 static last:Peer;channel=new Channel();connectionState="connected";closed=false;onconnectionstatechange:(()=>void)|null=null;
 constructor(){Peer.last=this;}createDataChannel(){return this.channel;}addTrack(){}async createOffer(){return {type:"offer",sdp:"synthetic-offer"};}
 async setLocalDescription(){}async setRemoteDescription(){this.channel.readyState="open";this.channel.onopen?.();}
 close(){this.closed=true;}
}
window.RTCPeerConnection=Peer as unknown as typeof RTCPeerConnection;
const form:PendingChatQuestion={questionId:"fixture",title:"Tell Metis what you need",columns:2,questions:[
 {id:"text",question:"What should change?",type:"text"},
 {id:"details",question:"Describe the result",type:"textarea"},
 {id:"number",question:"How many?",type:"number"},
 {id:"choice",question:"Choose a direction",type:"radio",options:[{value:"one",label:"One"}]},
 {id:"tasks",question:"Steps",type:"task_list"}
]};
const widget='<section style="padding:16px"><h3>Interactive draft</h3><label>Feedback<textarea id="feedback" style="width:100%"></textarea></label><label>Username<input id="username" autocomplete="username"></label><span id="identity-label">Username</span><input aria-labelledby="identity-label"><label>Password<input type="password"></label><label>Count<input type="number"></label></section><script>addEventListener("input",e=>parent.postMessage({type:"fixture-value",value:e.target.value},"*"));addEventListener("message",e=>{if(e.data?.type==="fixture-edit"){const f=document.querySelector("#feedback");f.value=e.data.value;f.dispatchEvent(new Event("input",{bubbles:true}));}});</script>';
let state:{first:string;second:string;answers:string[];custom:string[];customActive:boolean[];chat:string}|undefined;
let htmlValue="",htmlMessages=0;
const frameMessages:unknown[]=[];
window.addEventListener("message",event=>{if(event.data?.type?.startsWith("metis-html"))frameMessages.push(event.data);});
window.addEventListener("message",event=>{if(event.data?.type==="fixture-value")htmlValue=event.data.value;if(event.data?.type==="metis-html-dictation-fields")htmlMessages++;});
function Harness(){
 const[first,setFirst]=useState("Hello world"),[second,setSecond]=useState(""),[answers,setAnswers]=useState(["","","","",'["First step"]']),[custom,setCustom]=useState(["","","",""]),[customActive,setCustomActive]=useState([false,false,false,true]),[chat,setChat]=useState("first"),[show,setShow]=useState(true);
 state={first,second,answers,custom,customActive,chat};
 return <TooltipProvider><FieldDictationContext.Provider value={{enabled:true,provider:"openai",modelId:"synthetic-model",realtime:true,connectionId:"synthetic-connection",maxDurationSeconds:300,chatId:chat}}>
 <h1>Voice input in forms</h1>
 <section id="first"><label>Draft<DictationInput value={first} onValueChange={setFirst}/></label></section>
 <section id="second"><label>Details<DictationTextarea value={second} onValueChange={setSecond}/></label></section>
 <button id="manual" onClick={()=>setFirst("Manually edited")}>Edit draft</button>
 <button id="chat" onClick={()=>setChat(current=>current==="first"?"second":"first")}>Change chat</button>
 <button id="remove" onClick={()=>setShow(false)}>Remove target</button>
 {show?<section id="temporary"><DictationInput aria-label="Temporary answer" value="" onValueChange={()=>{throw Error("Removed target received late text");}}/></section>:null}
 <section id="credentials"><DictationInput type="password" value="" onValueChange={()=>{}}/><DictationInput autoComplete="username" value="" onValueChange={()=>{}}/><DictationInput type="number" value="" onValueChange={()=>{}}/></section>
 <section id="question"><QuestionForm form={form} answers={answers} custom={custom} customActive={customActive} onAnswersChange={setAnswers} onCustomChange={setCustom} onCustomActiveChange={setCustomActive} onSubmit={()=>{}} onCancel={()=>{}}/></section>
 <section id="embed"><HtmlEmbed source={widget}/></section>
 <FieldDictationContext.Provider value={{enabled:true,provider:"openai",realtime:false,connectionId:"synthetic-connection",maxDurationSeconds:300}}><section id="normal"><label>Recorded details<DictationTextarea value={second} onValueChange={setSecond}/></label></section></FieldDictationContext.Provider>
 <section id="composer"><VoiceInput provider="openai" realtime connectionId="synthetic-connection" modelId="synthetic-model" maxDurationSeconds={300} onTranscript={()=>{}}/></section>
 </FieldDictationContext.Provider></TooltipProvider>;
}
const root=createRoot(host);root.render(<Harness/>);
function click(selector:string){const button=document.querySelector<HTMLButtonElement>(selector);if(!button)throw Error("Missing "+selector);button.click();}
async function start(selector:string){click(selector+' [aria-label="Record voice input"]');await until(()=>document.querySelector(selector+' [aria-label="Stop recording"]'),"recording "+selector);return Peer.last.channel;}
function partial(channel:Channel,text:string){channel.receive({type:"conversation.item.input_audio_transcription.delta",item_id:"item",delta:text});}
function final(channel:Channel,text:string){channel.receive({type:"conversation.item.input_audio_transcription.completed",item_id:"item",transcript:text});channel.receive({type:"input_audio_buffer.committed",item_id:"item"});}
async function run(){
 const expectedWidth=Number(new URLSearchParams(location.search).get("width"));
 for(let i=0;expectedWidth&&innerWidth!==expectedWidth&&i<1200;i++)await pause(50);
 check(!expectedWidth||innerWidth===expectedWidth,"Requested viewport is active");
 // Let responsive button transitions settle after the browser viewport changes.
 await pause(300);
 if(new URLSearchParams(location.search).has("dark"))document.documentElement.classList.add("dark");
 await until(()=>document.querySelector("#first [data-field-dictation]"),"initial fields");
 check(!document.querySelector("#credentials [data-field-dictation]"),"No microphone on username, password or numeric controls");
 for(const field of document.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>("#first input,#second textarea,#question input:not([type=number]),#question textarea")){
   const icon=field.parentElement?.querySelector("button svg");if(!icon)continue;
   const rect=field.getBoundingClientRect(),glyph=icon.getBoundingClientRect(),style=getComputedStyle(field);
   const target=icon.closest("button")!.getBoundingClientRect();
   check(target.height>=(innerWidth<640||matchMedia("(pointer:coarse)").matches?44:36),"Microphone keeps its touch target at "+innerWidth+"px");
   const center=field instanceof HTMLTextAreaElement ? rect.top+parseFloat(style.borderTopWidth)+parseFloat(style.paddingTop)+parseFloat(style.lineHeight)/2 : rect.top+rect.height/2;
   check(Math.abs(glyph.top+glyph.height/2-center)<=1.5,"Microphone aligns with "+(field instanceof HTMLTextAreaElement?"first textarea line":"input text")+" at "+innerWidth+"px");
 }
 const input=document.querySelector<HTMLInputElement>("#first input")!;input.focus();input.setSelectionRange(6,6);
 let channel=await start("#first");
 check(Boolean(document.querySelector('[aria-label="Live transcript"]'))&&!document.querySelector('[aria-label="Audio waveform"]'),"Realtime starts with a transcript preview, without a waveform");
 partial(channel,"dear");await pause();
 check(document.querySelector('[aria-label="Live transcript"]')?.textContent==="dear","Popover displays the actual streamed words");
 click('#first [aria-label="Stop recording"]');await until(()=>state?.first==="Hello dear world","caret insertion");
 check(state?.first==="Hello dear world","Stop inserts streamed text at the caret without replacing existing content");
 click("#manual");await pause();final(channel,"dear friend");await pause();
 check(state?.first==="Manually edited","Late final transcript preserves a manual edit");
 channel=await start("#second");partial(channel,"Draft");await pause();click('#second [aria-label="Stop recording"]');await until(()=>state?.second==="Draft","preview commit");final(channel,"Draft finalized");await until(()=>state?.second==="Draft finalized","final update");
 check(state?.second==="Draft finalized","Unchanged textarea receives final realtime transcript");
 channel=await start("#second");partial(channel,"discard this");await pause();click('[aria-label="Cancel voice input"]');final(channel,"discard this");await pause();
 check(state?.second==="Draft finalized","Cancel discards spoken text and leaves the answer intact");
 channel=await start("#first");partial(channel,"old target");await pause();const old=Peer.last;await start("#second");await pause();
 check(old.closed&&!document.querySelector('#first [aria-label="Stop recording"]'),"Starting another field closes the previous microphone session");
 click('[aria-label="Cancel voice input"]');await pause();
 channel=await start("#second");const longText="Spoken words on several lines. ".repeat(60);partial(channel,longText);await pause(100);
 const preview=document.querySelector<HTMLElement>('[aria-label="Live transcript"]')!;
 check(preview.textContent===longText.trim()&&preview.scrollHeight>preview.clientHeight&&preview.clientHeight<=160,"Long live text stays complete inside a bounded scrolling preview");
 const popover=preview.closest('[role="dialog"]')!.getBoundingClientRect();
 check(popover.left>=0&&popover.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth,"Voice popover fits the viewport without horizontal overflow");
 click('[aria-label="Cancel voice input"]');await pause();
 click('#normal [aria-label="Record voice input"]');await until(()=>document.querySelector('#normal [aria-label="Stop recording"]'),"normal recording");await pause();
 const waveform=document.querySelector<HTMLElement>('[aria-label="Audio waveform"]')!;
 check(Boolean(waveform)&&!document.querySelector('[aria-label="Live transcript"]'),"Non-realtime recording shows a waveform instead of transcript text");
 const quiet=waveform.children[0].getBoundingClientRect().height;amplitude=144;await pause(100);
 check(waveform.children[0].getBoundingClientRect().height>quiet,"Waveform reacts to actual analyser levels");
 click('#normal [aria-label="Stop recording"]');await until(()=>finishNormal,"normal transcription");
 check(document.querySelector('[aria-label="Voice input"][role="dialog"]')?.textContent?.includes("Transcribing…"),"Stopped recording displays transcription progress");
 finishNormal!();await until(()=>state?.second?.includes("Recorded answer"),"normal transcript inserted");
 const requestsBeforeCancel=normalRequests;click('#normal [aria-label="Record voice input"]');await until(()=>document.querySelector('#normal [aria-label="Stop recording"]'),"normal cancel recording");click('[aria-label="Cancel voice input"]');await pause(100);
 check(normalRequests===requestsBeforeCancel,"Cancel discards a normal recording without uploading it");amplitude=128;
 const before=state!.first;channel=await start("#first");click("#chat");await pause();final(channel,"other chat");await pause();
 check(state?.first===before&&!document.querySelector('#first [aria-label="Stop recording"]'),"Chat switch cancels field capture and ignores stale results");
 permissionHold=true;const stoppedBefore=stoppedTracks;click('#temporary [aria-label="Record voice input"]');await until(()=>releasePermission,"pending permission");click("#remove");await pause();permissionHold=false;releasePermission!();await pause(100);
 check(stoppedTracks>stoppedBefore,"Unmount during pending permission stops the late microphone stream");
 const custom=document.querySelector<HTMLElement>('#question input[aria-label^="Custom answer"]')!.closest(".relative")!;
 const customButton=custom.querySelector<HTMLButtonElement>('[aria-label="Record voice input"]')!;customButton.click();await until(()=>custom.querySelector('[aria-label="Stop recording"]'),"custom recording");channel=Peer.last.channel;partial(channel,"My own direction");await pause();custom.querySelector<HTMLButtonElement>('[aria-label="Stop recording"]')!.click();final(channel,"My own direction");await until(()=>state?.custom[3]==="My own direction","custom text");
 check(state?.customActive[3]&&state?.custom[3]==="My own direction","Ask-User Custom answer keeps selection and receives dictation");
 click("#question button[aria-controls$='-steps']");await pause();
 check(Boolean(document.querySelector('#question textarea[aria-label="Step 1"]')?.parentElement?.querySelector("[data-field-dictation]")),"Editable task-list steps share the same microphone");
 rejectPermission=true;click('#first [aria-label="Record voice input"]');await until(()=>document.querySelector('[role="alert"]')?.textContent?.includes("permission denied"),"microphone error");check(Boolean(document.querySelector('[role="alert"]')),"Microphone failures expose a dismissible error");rejectPermission=false;click('[role="alert"] button');await pause();
 await until(()=>document.querySelector("#embed [data-field-dictation]"),"HTML microphones");
 check(document.querySelectorAll("#embed [data-field-dictation]").length===1,"Opaque HTML embed adds a host microphone only to its prose textarea");
 const count=requests;window.postMessage({type:"metis-html-dictation-start"},"*");await pause();check(requests===count,"Widget messages cannot start audio capture");
 channel=await start("#embed");partial(channel,"Local widget feedback");await pause();click('#embed [aria-label="Stop recording"]');final(channel,"Local widget feedback");await until(()=>htmlValue==="Local widget feedback","HTML transcript");
 check(htmlValue==="Local widget feedback","Explicit host microphone inserts into the local HTML field");
 channel=await start("#embed");partial(channel,"do not overwrite");await pause();document.querySelector<HTMLIFrameElement>("#embed iframe")!.contentWindow!.postMessage({type:"fixture-edit",value:"Edited inside widget"},"*");await pause();click('#embed [aria-label="Stop recording"]');final(channel,"do not overwrite");await pause();
 check(htmlValue==="Edited inside widget","HTML manual edits invalidate late dictation");
 check(htmlMessages>0,"Embed bridge is exercised through its actual opaque iframe");
 await start("#first");const fieldPeer=Peer.last;click('#composer [aria-label="Record voice input"]');await until(()=>Peer.last!==fieldPeer,"composer capture");
 check(fieldPeer.closed&&!document.querySelector('#first [aria-label="Stop recording"]'),"Composer and fields share one active microphone");
 // Stop all capture before leaving the review UI.
 root.render(<></>);await pause();root.render(<Harness/>);await pause(100);
 document.documentElement.dataset.fixtureResult="PASS";report.textContent=results.join("\n")+"\nFIELD_DICTATION_BROWSER_PASS "+results.length;
 const review=new URLSearchParams(location.search).get("review");
 if(review==="live"){channel=await start("#question");partial(channel,"This is the live transcript. The words appear here as I speak.");}
 if(review==="waveform"){for(const selector of ["#question","#embed"])host.querySelector<HTMLElement>(selector)!.style.display="none";amplitude=144;click('#normal [aria-label="Record voice input"]');await until(()=>document.querySelector('#normal [aria-label="Stop recording"]'),"review waveform");}
 for(const selector of ["#first","#second","#manual","#chat","#remove","#temporary","#credentials","#composer",...(review==="waveform"?[]:["#normal"])]){const element=host.querySelector<HTMLElement>(selector);if(element)element.style.display="none";}
}
run().catch(error=>{document.documentElement.dataset.fixtureResult="FAIL";report.textContent=results.join("\n")+"\nFAIL "+String(error)+"\n"+JSON.stringify(frameMessages.slice(-5));});
