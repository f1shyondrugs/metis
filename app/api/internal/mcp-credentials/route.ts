import {bearerTokenMatches} from "@/lib/security";
import {internalRunLeaseAuthorized} from "@/lib/internal-run-lease";
import {getJob} from "@/lib/db-jobs";
import {browserLoginRequest} from "@/lib/browser-login-client";
import {savedLoginSummaries,type SavedLogin} from "@/lib/credential-vault";
import {z} from "zod";
export const runtime="nodejs";
export async function POST(req:Request){
 const jobId=req.headers.get("x-ai-chat-job-id")||"",owner=req.headers.get("x-ai-chat-user-id")||"",chat=req.headers.get("x-ai-chat-id")||"";
 const job=getJob(jobId),headers={"Cache-Control":"no-store"};
 if(!bearerTokenMatches(req,process.env.MCP_BEARER_TOKEN)||!job||job.userId!==owner||job.chatId!==chat||job.status!=="running"||!internalRunLeaseAuthorized(req,jobId))return Response.json({error:"Unauthorized"},{status:401,headers});
 try{
  z.object({}).strict().parse(await req.json());
  const reply=await browserLoginRequest(owner,chat,"vault_list");
  // Re-project the service reply; extra transport fields must never reach agents.
  return Response.json({credentials:savedLoginSummaries((reply.credentials||[]) as SavedLogin[])},{headers});
 }catch{return Response.json({error:"The credential vault is unavailable."},{status:503,headers});}
}
