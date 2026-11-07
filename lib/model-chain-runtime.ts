import { getJob, updateJob } from "@/lib/db-jobs";
import { getChatMetadata, updateChat } from "@/lib/db-store";
import { transaction } from "@/lib/sqlite";
import { projectModelOverride } from "@/lib/project-model-server";
import type { AgentJob } from "@/lib/jobs";
import { chatModelChain, snapshotModelChain, ModelChainError, resolveChainStep } from "@/lib/model-chains";
import { modelChainFailure } from "@/lib/model-chain-failure";
import { MAX_PROVIDER_RETRIES } from "@/lib/provider-retry";
import { commitPendingModelSwitch } from "@/lib/model-switch";
import type { ModelSwitchPart } from "@/lib/run-control-event";

/** Fresh job processes also cover queued messages created by an older supervisor. */
export function initializeJobModelChain(job:AgentJob):AgentJob|null {
  return transaction(()=>{
    const current=getJob(job.id);
    if(!current || current.status!=="running")return null;
    if(current.modelChain || current.parentJobId || current.pendingModelId || !current.userId)return current;
    const chain=chatModelChain(current.userId,current.chatId);
    if(!chain)return current;
    const chat=getChatMetadata(current.chatId,current.userId);
    if(!chat || projectModelOverride(chat.projectId,current.userId))return current;
    const modelChain=snapshotModelChain(current.userId,chain),step=resolveChainStep(current.userId,modelChain.steps[modelChain.index]);
    const updated=updateJob(current.id,{...step,modelChain,agentId:undefined},{expectedRevision:current.revision??0});
    if(!updated)return null;
    if(!updateChat(current.chatId,{...step,...(chat.modelId!==step.modelId?{agentId:null}:{}),touchUpdatedAt:false},current.userId,{metadataProjection:true}))throw new Error("Model chain initialization lost its active writer.");
    return updated;
  });
}

export function requestModelChainFallback(jobId:string,error:unknown,checkpoint:(event:ModelSwitchPart)=>void):boolean {
  const reason=modelChainFailure(error);
  if(!reason)return false;
  return transaction(()=>{
    const current=getJob(jobId),chain=current?.modelChain;
    if(!current || current.status!=="running" || !current.userId || !chain || current.pendingModelId)return false;
    if(current.cancellationCause || (current.agentRuntimeDeadlineAt && Date.parse(current.agentRuntimeDeadlineAt)<=Date.now()))return false;
    const chat=getChatMetadata(current.chatId,current.userId);
    if(!chat || projectModelOverride(chat.projectId,current.userId))return false;
    if(reason==="unavailable" && chain.unavailableRetries<MAX_PROVIDER_RETRIES)return false;
    for(let index=chain.index+1;index<chain.steps.length;index++){
      let step;
      try {step=resolveChainStep(current.userId,chain.steps[index]);}catch(error){if(error instanceof ModelChainError)return false;continue;}
      const next={...chain,index,unavailableRetries:0};
      const updated=updateJob(current.id,{
        pendingModelId:step.modelId,pendingModelParams:step.modelParams,pendingModelChain:next,
        modelSwitchRequestedAt:new Date().toISOString(),
      },{expectedRevision:current.revision??0});
      if(!updated)return false;
      return commitPendingModelSwitch(current.id,current.modelId||"",checkpoint,undefined,{
        reason:reason==="usage"?"chain-usage":"chain-unavailable",chainName:chain.name,
      });
    }
    return false;
  });
}
