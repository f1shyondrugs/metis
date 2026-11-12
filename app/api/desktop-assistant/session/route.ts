import { getAuthenticatedUser } from "@/lib/auth";
import { requestOriginAllowed } from "@/lib/request-network";
import { AssistantSessionError, getAssistantSession, saveAssistantSession } from "@/lib/desktop-assistant-session-store";
import type { AssistantSessionPatch } from "@/lib/desktop-assistant-session";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(req:Request){
 const user=await getAuthenticatedUser(req);
 if(!user)return Response.json({error:"Unauthorized"},{status:401});
 const deviceId=new URL(req.url).searchParams.get("deviceId");
 if(!deviceId||deviceId.length>200)return Response.json({error:"Invalid device ID."},{status:400});
 try{return Response.json({session:getAssistantSession(user.id,deviceId)},{headers});}
 catch(error){return failure(error);}
}
export async function PUT(req:Request){
 const user=await getAuthenticatedUser(req);
 if(!user)return Response.json({error:"Unauthorized"},{status:401});
 // Preserve origin checks across the trusted HTTPS proxy/custom-server boundary.
 if(!requestOriginAllowed(req))return Response.json({error:"Invalid origin."},{status:403,headers});
 try{
  const body=await req.json() as {deviceId:string;version:number;patch:AssistantSessionPatch;editQueueId?:string};
  if(typeof body.deviceId!=="string"||!body.deviceId||body.deviceId.length>200||!Number.isSafeInteger(body.version)||body.version<0||!body.patch||typeof body.patch!=="object"||Array.isArray(body.patch))throw new AssistantSessionError("Invalid assistant session.",400);
  if(body.editQueueId!==undefined&&(typeof body.editQueueId!=="string"||!body.editQueueId||body.editQueueId.length>200))throw new AssistantSessionError("Invalid queued message.",400);
  return Response.json({session:saveAssistantSession(user.id,body.deviceId,body.version,body.patch,body.editQueueId)},{headers});
 }catch(error){return failure(error);}
}
function failure(error:unknown){
 if(error instanceof AssistantSessionError)return Response.json({error:error.message},{status:error.status,headers});
 return Response.json({error:"Could not save the assistant. Retry shortly."},{status:400,headers});
}
