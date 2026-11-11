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
  // @ts-expect-error Shared gateway ESM runtime boundary.
  const {listMcpCredentialTargets}=await import("@/packages/mcp-gateway/index.mjs");
  const mcp=await listMcpCredentialTargets(owner);
  try{
   // Reuse the existing read-only management index, including older live engines.
   // It returns routing metadata only; no credential envelope is retrieved.
   const reply=await browserLoginRequest(owner,chat,"list",{},true);
   // Re-project service replies; transport fields and encrypted values never reach agents.
   return Response.json({credentials:[...savedLoginSummaries((reply.credentials||[]) as SavedLogin[]),...mcp]},{headers});
  }catch{
   return Response.json({credentials:mcp,partial:true,unavailable:["browser","console"]},{headers});
  }
 }catch{return Response.json({error:"The credential vault is unavailable."},{status:503,headers});}
}
