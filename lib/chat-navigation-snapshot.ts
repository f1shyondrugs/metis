import type { ChatMessage, ToolPart } from "./store";
import { estimateSnapshotBytes } from "./snapshot-cache";
const EVENTS=24, BUDGET=256*1024;
/** Navigation caches contain previews, never expanded tool/subagent payloads. */
export function chatNavigationSnapshot<T>(value:T,chatId:string):T {
 if(!value || typeof value!=="object")return value;
 const snapshot=value as T & {messages?:ChatMessage[];hasEarlierMessages?:boolean;messageOffset?:number};
 if(!Array.isArray(snapshot.messages) || snapshot.messages.some(message=>!message || typeof message!=="object" || !message.id || typeof message.content!=="string"))return value;
 const messages=snapshot.messages.slice(-10).map(message=>{
  const compact=<P extends ToolPart>(tool:P):P=>{
   const url=tool.resultUrl || tool.inputUrl || `/api/chats/${encodeURIComponent(chatId)}/tool-result?messageId=${encodeURIComponent(message.id)}&toolId=${encodeURIComponent(tool.id)}`;
   const nested=tool.subagent?.messages?.length || tool.subagent?.tools?.length || tool.subagent?.thinking;
   const resultLarge=(tool.result?.length || 0)>2048,inputLarge=(tool.input?.length || 0)>2048;
   const diffLarge=(tool.diff?.before?.length || 0)+(tool.diff?.after?.length || 0)>2048;
   return {...tool,
    ...(resultLarge?{result:tool.result!.slice(0,256),resultUrl:url}:{}),
    ...(inputLarge?{input:tool.input!.slice(0,256),inputUrl:url}:{}),
    ...(nested?{resultUrl:url,subagent:{agentId:tool.subagent?.agentId,chatId:tool.subagent?.chatId,title:tool.subagent?.title,model:tool.subagent?.model,mode:tool.subagent?.mode,prompt:tool.subagent?.prompt?.slice(0,512)}}:{}),
    ...(diffLarge?{resultUrl:url,diff:{additions:tool.diff?.additions,deletions:tool.diff?.deletions}}:{}),
   };
  };
  const parts=message.parts || message.tools?.map(tool=>({type:"tool" as const,...tool})) || [];
  const start=Math.max(0,parts.length-EVENTS);
  const selected=parts.slice(start).map(part=>part.type==="tool"?compact(part):"content" in part?{...part,content:part.content.slice(0,16384)}:part);
  const firstIndex=(selected[0] as {transcriptIndex?:number}|undefined)?.transcriptIndex;
  const offset=Number.isSafeInteger(firstIndex) && firstIndex!>=0 ? firstIndex! : (message.eventOffset || 0)+start;
  const selectedIds=new Set(selected.flatMap(part=>part.type==="tool"?[part.id]:[]));
  const detail=`/api/chats/${encodeURIComponent(chatId)}/message?messageId=${encodeURIComponent(message.id)}`;
  return {...message,content:message.content.slice(0,16384),thinking:message.thinking?.slice(0,4096),
   ...(message.content.length>16384 || (message.thinking?.length || 0)>4096?{contentUrl:detail+"&full=1"}:{}),
   ...(message.parts?{parts:selected}:{}),tools:message.tools?.filter(tool=>selectedIds.has(tool.id)).map(compact),
   ...(offset?{eventsUrl:detail+"&before="+offset,eventOffset:offset}:{}),
  };
 });
 while(messages.length>1 && estimateSnapshotBytes(messages,BUDGET)>BUDGET)messages.shift();
 if(estimateSnapshotBytes(messages,BUDGET)>BUDGET)return {...snapshot,messages:[],hasEarlierMessages:true} as T;
 return {...snapshot,messages,messageOffset:0,hasEarlierMessages:snapshot.hasEarlierMessages || messages.length<snapshot.messages.length} as T;
}
