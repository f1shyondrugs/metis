"use client";
import { Markdown } from "./markdown";
import { ThinkingBlock } from "./thinking-block";
import { ToolCallGroup, type ToolCallData } from "./tool-call-chip";
import { RunEventDivider } from "./run-event-divider";
import { layoutAssistantParts } from "@/lib/tool-call-display";
import { partsFromFlat } from "@/lib/chat-message-parts";
import type { ChatMessage } from "@/lib/store";

export type AssistantMessage=Pick<ChatMessage,"id"|"content"|"errorMessage"|"parts"|"tools"|"thinking">&{thinkingDone?:boolean;thinkingDurationMs?:number};

/** Displays the saved canonical activity using the same layout and controls as normal chat. */
export function DesktopAssistantMessage({message,streaming,onOpenChat}:{
  message:AssistantMessage;streaming:boolean;onOpenChat:()=>void;
}){
  const blocks=layoutAssistantParts<ToolCallData>(message.parts?.length?message.parts:partsFromFlat(message));
  return <>
    {blocks.map((block,index)=>{
      const key=message.id+":"+index;
      if(block.type==="text")return <Markdown key={key} content={block.content} streaming={streaming&&index===blocks.length-1}/>;
      if(block.type==="thinking")return <ThinkingBlock key={key} text={block.content} done={Boolean(block.done)||Boolean(message.thinkingDone)||!streaming} durationMs={block.durationMs??message.thinkingDurationMs}/>;
      if(block.type==="tools")return <ToolCallGroup key={key} tools={block.tools} messageId={message.id}
        thinking={block.thinking?[{text:block.thinking.content,done:Boolean(block.thinking.done)||!streaming,durationMs:block.thinking.durationMs}]:undefined}
        live={streaming&&index===blocks.length-1} autoExpand={false}
        onOpenRaw={onOpenChat} onOpenDiff={onOpenChat} onOpenSubagent={onOpenChat} onOpenWorkspace={onOpenChat}/>;
      if(block.type==="compaction")return <ToolCallGroup key={key} tools={[{id:key,name:"context_compaction",kind:"compaction",status:block.status==="started"?"running":block.status,detail:block.message}]} live={streaming&&block.status==="started"}/>;
      return <RunEventDivider key={key} event={block}/>;
    })}
    {message.errorMessage?<p role="alert">{message.errorMessage}</p>:null}
  </>;
}
