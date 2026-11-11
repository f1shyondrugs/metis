import type { ToolPart } from "./store";

export function isLegacyCodexNoiseTool(tool: Pick<ToolPart,"name"|"input"|"result"|"detail"|"todos">) {
  const name=String(tool.name??"").trim().toLowerCase();
  return !tool.input&&!tool.result&&!tool.detail&&!tool.todos?.length&&(name==="codex error"||name==="codex todo list");
}
type FlatPart<TTool>={type:"text";content:string}|{type:"thinking";content:string;done?:boolean;durationMs?:number}|({type:"tool"}&TTool);

/** Shared legacy fallback; structured parts remain authoritative in both chat views. */
export function partsFromFlat<TTool extends ToolPart>(message:{
  content:string;thinking?:string;thinkingDone?:boolean;thinkingDurationMs?:number;tools?:readonly TTool[];
}):FlatPart<TTool>[] {
  const parts:FlatPart<TTool>[]=[];
  if(message.thinking)parts.push({type:"thinking",content:message.thinking,done:message.thinkingDone,durationMs:message.thinkingDurationMs});
  const tools=new Map<string,TTool>();
  for(const tool of message.tools??[]){
    if(isLegacyCodexNoiseTool(tool))continue;
    const prior=tools.get(tool.id);tools.set(tool.id,prior?{...prior,...tool}:tool);
  }
  for(const tool of tools.values())parts.push({type:"tool",...tool});
  if(message.content)parts.push({type:"text",content:message.content});
  return parts;
}
