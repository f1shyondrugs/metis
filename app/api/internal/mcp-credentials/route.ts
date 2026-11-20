import {bearerTokenMatches} from "@/lib/security";
import {internalRunLeaseAuthorized} from "@/lib/internal-run-lease";
import {getJob} from "@/lib/db-jobs";
import {listSavedLoginSummaries} from "@/lib/protected-console-login";
import {browserLoginRequest} from "@/lib/browser-login-client";
import {namedVaultSummarySchema} from "@/lib/named-vault-contract";
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
   const credentials=[...await listSavedLoginSummaries(owner,chat),...mcp];
   try {
    const {entries}=await browserLoginRequest(owner,chat,"named_vault_list",{},true);
    const namedEntries=z.array(namedVaultSummarySchema).parse(entries).map(({id,title,kind,fields})=>({
     id,title,kind,fields,...(kind==="custom"?{}:{usage:kind==="browser"?"browser_request_login":"console_connect"}),
    }));
    return Response.json({credentials,namedEntries},{headers});
   } catch {
    // Older brokers expose legacy credentials without named references.
    return Response.json({credentials,namedEntriesUnavailable:true},{headers});
   }
  }catch{
   return Response.json({credentials:mcp,partial:true,unavailable:["browser","console"]},{headers});
  }
 }catch{return Response.json({error:"The credential vault is unavailable."},{status:503,headers});}
}
