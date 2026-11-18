import type { Chat } from "@/lib/store";

export type AssistantQueuedMessage = NonNullable<Chat["queuedMessages"]>[number];
export type AssistantDraft = Pick<AssistantQueuedMessage,"text"|"referenceText"|"references"|"attachments"|"assistantDeviceId">;
export type AssistantPanelSize = {width:number;height:number};
export type AssistantSession = {version:number;chatId:string|null;draft:AssistantDraft;panelSize:AssistantPanelSize};
export type AssistantSessionPatch = {chatId?:string|null;draftText?:string;clearContext?:boolean;panelSize?:AssistantPanelSize};
export const DEFAULT_ASSISTANT_PANEL:AssistantPanelSize = {width:360,height:360};
export const EMPTY_ASSISTANT_SESSION:AssistantSession = {version:0,chatId:null,draft:{text:""},panelSize:DEFAULT_ASSISTANT_PANEL};
export function assistantPanelSize(value:unknown):AssistantPanelSize {
  if(!value||typeof value!=="object")throw new Error("Invalid conversation size.");
  const {width,height}=value as AssistantPanelSize;
  if(!Number.isFinite(width)||!Number.isFinite(height))throw new Error("Invalid conversation size.");
  return {width:Math.round(Math.max(280,Math.min(1200,width))),height:Math.round(Math.max(160,Math.min(1200,height)))};
}
/** Writes stay ordered; a stale window cannot silently overwrite another session. */
export function createAssistantSessionWriter(
 initial:AssistantSession,
 request:(version:number,patch:AssistantSessionPatch,editQueueId?:string)=>Promise<AssistantSession>,
) {
 let session=initial,chain=Promise.resolve(),blocked:unknown;
 return {
  save(patch:AssistantSessionPatch,editQueueId?:string){
   const result=chain.then(async()=>{
    if(blocked)throw blocked;
    try {session=await request(session.version,patch,editQueueId);return session;}
    catch(error){blocked=error;throw error;}
   });
   chain=result.then(()=>{},()=>{});
   return result;
  },
  async settle(){await chain;if(blocked)throw blocked;return session;},
  reset(next:AssistantSession){session=next;blocked=undefined;},
 };
}
