import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase, transaction } from "@/lib/sqlite";
import type { ModelChain, ModelChainRun, ModelChainStep } from "@/lib/model-chain-types";
import { discoveredProjectModel } from "@/lib/project-model-server";
import { defaultParamsForModel, sanitizeModelParams } from "@/lib/model-params";
import { canAccessChat } from "@/lib/project-access";

const inputSchema = z.object({
  id:z.string().uuid().optional(), version:z.number().int().positive().optional(),
  name:z.string().trim().min(1).max(80),
  steps:z.array(z.object({
    modelId:z.string().trim().min(1).max(300),
    modelParams:z.array(z.object({id:z.string().max(80),value:z.string().max(300)}).strict()).max(20).optional(),
  }).strict()).min(2).max(16),
}).strict();
export class ModelChainError extends Error {
  constructor(message:string, public status=400) { super(message); }
}
type Row={id:string;name:string;data:string;version:number;created_at:string;updated_at:string};
function fromRow(row:Row):ModelChain {
  return {id:row.id,name:row.name,steps:JSON.parse(row.data).steps,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at};
}
export function listModelChains(ownerId:string):ModelChain[] {
  return (getDatabase().prepare("SELECT * FROM model_chains WHERE owner_id=? ORDER BY created_at,id").all(ownerId) as Row[]).map(fromRow);
}
export function getModelChain(ownerId:string,id:string):ModelChain|null {
  const row=getDatabase().prepare("SELECT * FROM model_chains WHERE owner_id=? AND id=?").get(ownerId,id) as Row|undefined;
  return row?fromRow(row):null;
}
export function resolveChainStep(ownerId:string,step:{modelId:string;modelParams?:ModelChainStep["modelParams"]}):ModelChainStep {
  const model=discoveredProjectModel(ownerId,step.modelId);
  const params=step.modelParams===undefined?defaultParamsForModel(model):sanitizeModelParams(model,step.modelParams);
  if(step.modelParams && (params.length!==step.modelParams.length || new Set(params.map(p=>p.id)).size!==params.length))
    throw new ModelChainError("Choose options supported by each model in the chain.");
  return {modelId:step.modelId,modelParams:params};
}
export function saveModelChain(ownerId:string,input:unknown):ModelChain {
  const parsed=inputSchema.safeParse(input);
  if(!parsed.success)throw new ModelChainError("Use a name and 2–16 models with valid options.");
  const value=parsed.data;
  if(new Set(value.steps.map(s=>s.modelId)).size!==value.steps.length)throw new ModelChainError("Each model can appear only once in a chain.");
  let steps:ModelChainStep[];
  try { steps=value.steps.map(step=>resolveChainStep(ownerId,step)); }
  catch(error){throw new ModelChainError(error instanceof Error?error.message:"Choose available models.");}
  return transaction(()=>{
    const current=value.id?getModelChain(ownerId,value.id):null;
    if(value.id&&!current)throw new ModelChainError("Model chain not found.",404);
    if(current&&value.version!==current.version)throw new ModelChainError("This chain changed in another tab. Reload it before saving.",409);
    if(!current&&listModelChains(ownerId).length>=50)throw new ModelChainError("You can save up to 50 model chains.");
    const id=current?.id||randomUUID(),timestamp=new Date().toISOString(),version=(current?.version||0)+1;
    getDatabase().prepare("INSERT INTO model_chains(id,owner_id,name,data,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,data=excluded.data,version=excluded.version,updated_at=excluded.updated_at")
      .run(id,ownerId,value.name,JSON.stringify({steps}),version,current?.createdAt||timestamp,timestamp);
    return getModelChain(ownerId,id)!;
  });
}
export function deleteModelChain(ownerId:string,id:string,version:number) {
  const result=getDatabase().prepare("DELETE FROM model_chains WHERE id=? AND owner_id=? AND version=?").run(id,ownerId,version);
  if(!result.changes)throw new ModelChainError("The chain was removed or changed. Reload it before deleting.",409);
}
export function chatModelChain(ownerId:string,chatId:string):ModelChain|null {
  if(!canAccessChat(chatId,ownerId))return null;
  const row=getDatabase().prepare("SELECT chain_id FROM chat_model_chains WHERE chat_id=? AND owner_id=?").get(chatId,ownerId) as {chain_id:string}|undefined;
  return row?getModelChain(ownerId,row.chain_id):null;
}
export function setChatModelChain(ownerId:string,chatId:string,chainId:string|null) {
  if(!canAccessChat(chatId,ownerId))throw new ModelChainError("Chat not found.",404);
  if(chainId&&!getModelChain(ownerId,chainId))throw new ModelChainError("Model chain not found.",404);
  if(chainId)getDatabase().prepare("INSERT INTO chat_model_chains(chat_id,owner_id,chain_id) VALUES(?,?,?) ON CONFLICT(chat_id,owner_id) DO UPDATE SET chain_id=excluded.chain_id").run(chatId,ownerId,chainId);
  else getDatabase().prepare("DELETE FROM chat_model_chains WHERE chat_id=? AND owner_id=?").run(chatId,ownerId);
}
export function snapshotModelChain(ownerId:string,chain:ModelChain):ModelChainRun {
  // Recheck current account access and discovery. Missing metadata stays unavailable.
  const index=chain.steps.findIndex(step=>{try{resolveChainStep(ownerId,step);return true;}catch(error){if(error instanceof ModelChainError)throw error;return false;}});
  if(index<0)throw new ModelChainError("No model in this chain is currently available.");
  return {id:chain.id,name:chain.name,version:chain.version,steps:chain.steps.map(s=>({...s,modelParams:s.modelParams.map(p=>({...p}))})),index,unavailableRetries:0};
}
