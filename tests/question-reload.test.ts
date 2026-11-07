import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {reconcileChatMessageWindow} from "../lib/chat-message-window";
import {projectQuestionTranscript} from "../lib/question-transcript";
import {chatNavigationSnapshot} from "../lib/chat-navigation-snapshot";
import {mergeChatMessages} from "../lib/tool-call-display";
import type {ChatMessage,MessagePart} from "../lib/store";
const dir=mkdtempSync(path.join(os.tmpdir(),"metis-question-reload-"));
Object.assign(process.env,{CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"chat.sqlite"),AGENT_CWD:dir,AI_CHAT_ROOT:dir});
delete process.env.AI_CHAT_JOB_ID;delete process.env.AI_CHAT_WORKER_ID;delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
const loaded=Promise.all([import("../lib/sqlite"),import("../lib/db-store"),import("../lib/db-questions"),import("../app/api/chat/answer/route"),import("../app/api/chats/[id]/route"),import("../app/api/chats/[id]/message/route")]);
const stamp="2026-01-01T00:00:00Z";
const request=(url:string,body?:unknown)=>new Request("http://fixture"+url,{method:body===undefined?"GET":"POST",headers:{cookie:"ai_chat_auth=reload-token","content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
const hydrate=(messages:ChatMessage[])=>messages.map(message=>({...message,...reconcileChatMessageWindow(message)}));
test.after(async()=>{(await loaded)[0].getDatabase().close();rmSync(dir,{recursive:true,force:true});});
test.before(async()=>{const [{getDatabase}]=await loaded;const db=getDatabase();db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run("owner","owner","unused",stamp);db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(createHash("sha256").update("reload-token").digest("hex"),"owner","2099-01-01T00:00:00Z");});
for(const {toolName,legacy} of [{toolName:"ask_user",legacy:false},{toolName:"research_plan",legacy:false},{toolName:"functions.exec",legacy:false},{toolName:"ask_user",legacy:true},{toolName:"research_plan",legacy:true}]){
 test(toolName+(legacy?" legacy":"")+" answer stays before continuation through actual API reload, cache and checkpoint append",async()=>{
  const [,store,questions,answerApi,chatApi,messageApi]=await loaded;
  const chat=store.createChat("Reload fixture",undefined,"owner");
  const source:ChatMessage={id:"assistant",role:"assistant",content:"Before.",createdAt:stamp,parts:[{type:"text",content:"Before."},{type:"tool",id:"question-call",name:toolName,status:"running"}]};
  store.appendMessage(chat.id,source,"owner");
  const pending=questions.createPendingQuestion([{key:"choice",question:"Choice",type:"text"}],chat.id,"owner");
  try{
   const answerResponse=await answerApi.POST(request("/api/chat/answer",{questionId:pending.questionId,values:{choice:"Accepted"}}));
   assert.equal(answerResponse.status,200);const submitted=await answerResponse.json();await pending.promise;
   const responseId="question-answer-"+pending.questionId;
   const expectedReference={...submitted.message.questionAnswer};
   if(legacy){delete expectedReference.cursor;store.upsertMessage(chat.id,{...submitted.message,questionAnswer:expectedReference});}
   const later:MessagePart[]=Array.from({length:32},(_,index)=>({type:"tool",id:"read-"+index,name:"read_file",status:"completed"}));
   const continued={...source,content:"Before.After.",parts:[...source.parts!,...later,{type:"text" as const,content:"After."}]};
   store.upsertMessage(chat.id,continued);
   const params={params:Promise.resolve({id:chat.id})};
   const reload=async()=>{const response=await chatApi.GET(request("/api/chats/"+chat.id),params);assert.equal(response.status,200);return (await response.json()).chat.messages as ChatMessage[];};
   const raw=await reload();assert.ok(raw[0].eventOffset!>0);assert.ok(!raw[0].parts?.some(part=>part.type==="tool"&&part.id==="question-call"));
   assert.deepEqual(raw.find(message=>message.id===responseId)?.questionAnswer,expectedReference);
   function assertVisibleOrder(messages:ChatMessage[],suffix:string){const view=projectQuestionTranscript(hydrate(messages));const answerIndex=view.findIndex(message=>message.id===responseId);const continuationIndex=view.findIndex(message=>message.role==="assistant"&&message.content.includes(suffix));assert.ok(answerIndex>=0&&answerIndex<continuationIndex,JSON.stringify(view.map(({id,content})=>({id,content}))));assert.ok(!view[continuationIndex].content.includes("Before."));assert.equal(view.filter(message=>message.id===responseId).length,1);return view;}
   const projected=assertVisibleOrder(raw,"After.");
   assert.ok(projected[0].eventsUrl);assert.equal(projected.at(-1)?.eventsUrl,undefined);
   const cached=chatNavigationSnapshot({messages:store.getChat(chat.id,"owner")!.messages},chat.id);
   assertVisibleOrder(JSON.parse(JSON.stringify(cached.messages)),"After.");
   const updated={...continued,content:"Before.After.More.",parts:[...continued.parts.slice(0,-1),{type:"text" as const,content:"After.More."}]};
   store.checkpointAssistantMessage(chat.id,updated);
   const fresh=await reload();
   const merged=mergeChatMessages(hydrate(raw),hydrate(fresh));assertVisibleOrder(merged,"More.");
   assertVisibleOrder(await reload(),"More.");
   const fullResponse=await messageApi.GET(request("/api/chats/"+chat.id+"/message?messageId=assistant&full=1"),params);assert.equal(fullResponse.status,200);const full=await fullResponse.json();
   const expanded=fresh.map(message=>message.id==="assistant"?{...message,...full,eventOffset:0,eventsUrl:undefined,contentUrl:undefined}:message);
   assert.deepEqual(projectQuestionTranscript(hydrate(expanded)).map(message=>message.content),["Before.",submitted.summary,"After.More."]);
   assert.equal(store.getChat(chat.id,"owner")!.messages[0].content,"Before.After.More.");
  }finally{pending.stop();}
 });
}
test("legacy flat-only replies remain available through full-message hydration",async()=>{
 const [,store,,,chatApi,messageApi]=await loaded;
 const chat=store.createChat("Legacy reply",undefined,"owner");
 const source:ChatMessage={id:"legacy",role:"assistant",createdAt:stamp,content:"The complete legacy reply.",parts:Array.from({length:35},(_,index)=>({type:"tool",id:"legacy-read-"+index,name:"read_file",status:"completed"}))};
 store.appendMessage(chat.id,source,"owner");
 const params={params:Promise.resolve({id:chat.id})};
 const page=await (await chatApi.GET(request("/api/chats/"+chat.id),params)).json();
 const [window]=hydrate(page.chat.messages);
 assert.ok(window.contentUrl?.includes("full=1"));
 const full=await (await messageApi.GET(request(window.contentUrl!),params)).json();
 const [restored]=hydrate([{...window,...full,eventOffset:0,eventsUrl:undefined,contentUrl:undefined}]);
 assert.equal(restored.content,source.content);
 assert.equal(restored.parts.filter(part=>part.type==="text").map(part=>part.type==="text"?part.content:"").join(""),source.content);
});
test("filtered compatibility events preserve canonical cursor indexes and partial pages do not append flat prefix",()=>{
 const raw:ChatMessage={id:"assistant",role:"assistant",createdAt:stamp,eventOffset:8,content:"Hidden.Visible.After.",parts:[{type:"tool",id:"noise",name:"legacy-noise",status:"completed"},{type:"text",content:"Visible.After."}]};
 const window=reconcileChatMessageWindow(raw,part=>part.type!=="tool"||part.id!=="noise");
 const answer:ChatMessage={id:"question-answer-q",role:"user",createdAt:stamp,content:"Answer",questionAnswer:{questionId:"q",assistantMessageId:"assistant",cursor:{partIndex:9,textOffset:8}}};
 assert.equal(window.content,"Visible.After.");
 assert.deepEqual(projectQuestionTranscript([{...raw,...window},answer]).map(message=>message.content),["Visible.","Answer","After."]);
 const cached=chatNavigationSnapshot({messages:[{...raw,...window},answer]},"chat");
 assert.deepEqual(projectQuestionTranscript(hydrate(cached.messages)).map(message=>message.content),["Visible.","Answer","After."]);
});
