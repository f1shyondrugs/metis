import React from "react";
import {createRoot} from "react-dom/client";
import {DesktopAssistant} from "../components/desktop-assistant";
import type {AssistantSession,AssistantQueuedMessage} from "../lib/desktop-assistant-session";
const pause=(ms=30)=>new Promise(resolve=>setTimeout(resolve,ms));
const checks:string[]=[];
function check(value:unknown,label:string){checks.push((value?"PASS ":"FAIL ")+label);if(!value)throw Error(label);}
async function until(predicate:()=>unknown){for(let i=0;i<250;i++){if(predicate())return;await pause();}throw Error("Timed out: "+predicate.toString());}
const models=[{id:"fixture/recent",providerId:"fixture",displayName:"Recent model",parameters:[],defaultParams:[]}];
localStorage.setItem("metis-ai_model","fixture/recent");
let session:AssistantSession={version:0,chatId:"fixture-chat",draft:{text:""},panelSize:{width:360,height:320}};
const screen={id:"original-screen",name:"Screen.png",mimeType:"image/png",size:12,kind:"image" as const,storedName:"Screen.png"};
let queue:AssistantQueuedMessage[]=[{id:"q-first",text:"First queued prompt",referenceText:"Original monitor positions",assistantDeviceId:"original-client",attachments:[screen]},{id:"q-second",text:"Second queued prompt",assistantDeviceId:"second-client"}];
let captures=0,sent:Record<string,unknown>|null=null,failRemove=false;
const nativeFetch=fetch.bind(window);
const initialMessages=[{id:"user",role:"user",content:"Initial question"},{id:"reply",role:"assistant",content:"I am working on your request."}];
Object.defineProperty(window,"metisAssistant",{value:{
 ready:async()=>({gestures:[],device:{clientId:"fixture-client",hostname:"Fixture PC",platform:"win32"},editing:true}),
 onGesture:()=>()=>{},configure:async()=>({editing:true,shortcuts:{}}),voice:()=>{},focusInput:async()=>{},close:async()=>{},openChat:async()=>{},
 capture:async()=>{captures++;return {device:{clientId:"fixture-client",hostname:"Fixture PC",platform:"win32"},capturedAt:new Date().toISOString(),monitors:[]};}
}});
window.fetch=async(input,init)=>{
 const url=String(input);
 if(url==="/api/preferences")return Response.json({settings:{voiceInput:{enabled:false}}});
 if(url==="/api/models")return Response.json({models});
 if(url.startsWith("/api/desktop-assistant/session")){
  if(init?.method==="PUT"){
   const body=JSON.parse(String(init.body));if(body.version!==session.version)return Response.json({error:"Session conflict"},{status:409});
   await pause(60);
   if(body.editQueueId){
    const item=queue.find(item=>item.id===body.editQueueId)!;
    queue=queue.filter(item=>item.id!==body.editQueueId);
    session={...session,draft:{text:item.text,attachments:item.attachments,referenceText:item.referenceText,assistantDeviceId:item.assistantDeviceId}};
   }
   const patch=body.patch;
   session={...session,version:session.version+1,chatId:patch.chatId??session.chatId,panelSize:patch.panelSize??session.panelSize,draft:{...(patch.clearContext?{}:session.draft),text:patch.draftText??session.draft.text}};
  }
  return Response.json({session});
 }
 if(url.startsWith("/api/runs?"))return Response.json({job:{id:"fixture-job",status:"running"}});
 if(url.startsWith("/api/chats/fixture-chat/queue/")&&init?.method==="DELETE"){
  if(failRemove)return Response.json({error:"Fixture removal failed"},{status:500});
  queue=queue.filter(item=>item.id!==decodeURIComponent(url.split("/").at(-1)!));return Response.json({ok:true});
 }
 if(url.startsWith("/api/chats/fixture-chat")){
  if(init?.method==="PATCH"){
   const patch=JSON.parse(String(init.body));
   if(patch.queuedMessages){const merged=new Map(patch.queuedMessages.map((item:AssistantQueuedMessage)=>[item.id,item]));for(const item of queue)if(!merged.has(item.id))merged.set(item.id,item);queue=[...merged.values()] as AssistantQueuedMessage[];}
   return Response.json({chat:{...patch,queuedMessages:queue}});
  }
  return Response.json({chat:{id:"fixture-chat",modelId:"fixture/recent",modelParams:[],runStatus:"running",queuedMessages:queue,messages:initialMessages}});
 }
 if(url==="/api/chat"){sent=JSON.parse(String(init?.body));queue=queue.filter(item=>item.id!==sent?.messageId);return Response.json({jobId:"fixture-now",status:"queued"});}
 return nativeFetch(input,init);
};
let root=createRoot(document.getElementById("root")!);root.render(<DesktopAssistant/>);
function type(text:string){
 const input=document.querySelector<HTMLTextAreaElement>('textarea')!;
 Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,text);
 input.dispatchEvent(new Event("input",{bubbles:true}));
}
async function run(){
 await until(()=>document.querySelector('textarea:not(:disabled)')&&document.querySelector('[aria-label="Queued message 2"]'));
 const input=document.querySelector<HTMLTextAreaElement>('textarea')!;
 const single=input.getBoundingClientRect().height;
 type("First line\nSecond line\nThird line\nFourth line");await pause(80);
 check(input.getBoundingClientRect().height>single+40,"Shared Composer grows for explicit line breaks");
 type(Array(30).fill("Long multiline text").join("\n"));await pause(80);
 check(input.getBoundingClientRect().height<=181&&input.scrollHeight>input.clientHeight,"Long Composer is capped at 180px and scrolls internally");
 type("Short");await pause(80);
 check(input.getBoundingClientRect().height<60,"Composer shrinks again after deleting lines");
 type("A follow-up while Metis is running");await pause(60);
 document.querySelector<HTMLButtonElement>('[aria-label="Queue message with all monitors"]')!.click();
 await until(()=>queue.some(item=>item.text.includes("follow-up"))&&input.value==="");
 check(captures===1,"Queued message captures screens once at queue time, not on restore");
 check(queue.find(item=>item.text.includes("follow-up"))?.assistantDeviceId==="fixture-client","Fresh queue capture retains the current native device ID");
 check(sent===null,"A running agent receives the canonical server queue, not a competing chat run");
 await until(()=>document.querySelector('[aria-label="Queued message 3"]'));
 await until(()=>!document.querySelector<HTMLButtonElement>('[aria-label="Move queued message 2 up"]')!.disabled);
 document.querySelector<HTMLButtonElement>('[aria-label="Move queued message 2 up"]')!.click();
 await until(()=>queue[0].id==="q-second");
 check(queue[1].attachments?.[0].id==="original-screen","Reordering preserves registered monitor attachments");
 await until(()=>!document.querySelector<HTMLButtonElement>('[aria-label="Edit queued message 2"]')!.disabled);
 document.querySelector<HTMLButtonElement>('[aria-label="Edit queued message 2"]')!.click();await pause(15);
 check(input.value==="First queued prompt","Queue editing transfers text immediately, before its server acknowledgement");
 check(document.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled,"Send stays locked until original queue removal is confirmed");
 await until(()=>session.draft.attachments?.[0].id==="original-screen");
 type("Edited queued prompt\nWith another line");await until(()=>session.draft.text.includes("another line"));
 check(session.draft.referenceText==="Original monitor positions","Edited draft keeps original device context on the server");
 check(session.draft.assistantDeviceId==="original-client","Editing preserves original capture device instead of replacing it with the current client");
 const resize=document.querySelector<HTMLButtonElement>('[aria-label="Resize conversation"]')!;
 const widthAfterResize=Math.round(document.querySelector<HTMLElement>(".assistant-conversation")!.getBoundingClientRect().width+20);
 resize.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}));await until(()=>session.panelSize.width===widthAfterResize);
 const heightBeforeResize=Math.round(document.querySelector<HTMLElement>(".assistant-conversation")!.getBoundingClientRect().height);
 resize.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}));await until(()=>session.panelSize.height===heightBeforeResize+20);
 check(true,"Keyboard resize persists both dimensions on the server");
 root.unmount();await pause();root=createRoot(document.getElementById("root")!);root.render(<DesktopAssistant/>);
 await until(()=>document.querySelector<HTMLTextAreaElement>("textarea")?.value===session.draft.text&&document.querySelector('[aria-label="Queued message 2"]'));
 check(document.querySelector<HTMLTextAreaElement>("textarea")!.value.includes("another line"),"A fresh renderer restores the server draft and chat identity");
 check(parseFloat(document.querySelector<HTMLElement>(".assistant-conversation")!.style.width)===Math.min(session.panelSize.width,innerWidth-32),"A fresh renderer restores saved panel size without localStorage, clamped to this viewport");
 check(document.body.textContent?.includes("attached file(s) retained"),"Queued attachment context survives renderer restart");
 await pause(400);
 const rect=document.querySelector<HTMLElement>(".assistant-conversation")!.getBoundingClientRect(),compose=document.querySelector<HTMLElement>(".assistant-compose")!.getBoundingClientRect();
 check(rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=compose.top+1,"Conversation stays inside viewport and above growing Composer");
 failRemove=true;
 await until(()=>!document.querySelector<HTMLButtonElement>('[aria-label="Remove queued message 1"]')!.disabled);
 document.querySelector<HTMLButtonElement>('[aria-label="Remove queued message 1"]')!.click();
 await until(()=>document.body.textContent?.includes("Could not remove queued message"));
 check(queue.some(item=>item.id==="q-second")&&Boolean(document.querySelector('[aria-label="Queued message 1"]')),"Failed deletion restores the visible queue instead of silently losing a prompt");
 failRemove=false;
 await until(()=>[...document.querySelectorAll<HTMLButtonElement>(".assistant-queue button")].some(button=>button.textContent?.includes("Send now")&&!button.disabled));
 const sendNow=[...document.querySelectorAll<HTMLButtonElement>(".assistant-queue button")].find(button=>button.textContent?.includes("Send now"))!;
 sendNow.click();await until(()=>sent?.sendQueuedNow===true);
 check(sent?.chatId==="fixture-chat"&&sent?.messageId==="q-second","Send now uses the normal Metis endpoint and same saved queued identity");
 check(sent?.assistantDeviceId==="second-client","Send now keeps the queued item origin, not the currently open desktop");
 await nativeFetch("/result",{method:"POST",body:JSON.stringify({mode:"queue",width:innerWidth,height:innerHeight,checks,passed:true})});
}
run().catch(async error=>{document.body.dataset.failed=String(error);await nativeFetch("/result",{method:"POST",body:JSON.stringify({mode:"queue",width:innerWidth,height:innerHeight,checks,passed:false,error:String(error)})});});
