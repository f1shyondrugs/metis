import { getAuthenticatedUser } from "@/lib/auth";
import { getChatMetadata, updateChat } from "@/lib/db-store";
import { getActiveJob, requestJobModelSwitch } from "@/lib/db-jobs";
import { chatModelChain, getModelChain, ModelChainError, resolveChainStep, setChatModelChain, snapshotModelChain } from "@/lib/model-chains";
import { projectModelOverride } from "@/lib/project-model-server";
import { transaction } from "@/lib/sqlite";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
type Params={params:Promise<{id:string}>};
export async function GET(req:Request,{params}:Params) {
  const user=await getAuthenticatedUser(req),{id}=await params;
  if(!user)return Response.json({error:"Unauthorized"},{status:401,headers});
  const chat=getChatMetadata(id,user.id);
  if(!chat)return Response.json({error:"Chat not found."},{status:404,headers});
  return Response.json({chain:projectModelOverride(chat.projectId,user.id)?null:chatModelChain(user.id,id)},{headers});
}
export async function PUT(req:Request,{params}:Params) {
  const user=await getAuthenticatedUser(req),{id}=await params;
  if(!user)return Response.json({error:"Unauthorized"},{status:401,headers});
  try {
    const body=await req.json();
    if(body.chainId!==null && typeof body.chainId!=="string")throw new ModelChainError("Choose a model chain.");
    return transaction(()=>{
      const chat=getChatMetadata(id,user.id);
      if(!chat)throw new ModelChainError("Chat not found.",404);
      if(projectModelOverride(chat.projectId,user.id))throw new ModelChainError("This project's model is locked.",409);
      const active=getActiveJob(id);
      if(active&&active.userId!==user.id)throw new ModelChainError("Another project member is using this chat.",409);
      const chain=body.chainId?getModelChain(user.id,body.chainId):null;
      if(body.chainId&&!chain)throw new ModelChainError("Model chain not found.",404);
      const run=chain?snapshotModelChain(user.id,chain):null;
      const step=run?resolveChainStep(user.id,run.steps[run.index]):resolveChainStep(user.id,{modelId:body.modelId||chat.modelId||"",modelParams:body.modelParams??chat.modelParams});
      setChatModelChain(user.id,id,chain?.id||null);
      const saved=updateChat(id,{...step,agentId:null,touchUpdatedAt:false},user.id,{metadataProjection:true});
      if(!saved)throw new ModelChainError("Chat not found.",404);
      requestJobModelSwitch(id,user.id,step.modelId,step.modelParams,run);
      return Response.json({chain,selection:{...step,modelChainId:chain?.id||null}},{headers});
    });
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Could not select chain."},{status:error instanceof ModelChainError?error.status:400,headers});}
}
