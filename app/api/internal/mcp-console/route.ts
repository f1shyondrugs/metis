import {bearerTokenMatches} from "@/lib/security";
import {internalRunLeaseAuthorized} from "@/lib/internal-run-lease";
import {getJob} from "@/lib/db-jobs";
import {browserLoginRequest} from "@/lib/browser-login-client";
import {z} from "zod";
export const runtime="nodejs";
export async function POST(req:Request){
  const jobId=req.headers.get("x-ai-chat-job-id")||"",owner=req.headers.get("x-ai-chat-user-id")||"",chat=req.headers.get("x-ai-chat-id")||"";
  const job=getJob(jobId);
  if(!bearerTokenMatches(req,process.env.MCP_BEARER_TOKEN)||!job||job.userId!==owner||job.chatId!==chat||job.status!=="running"||!internalRunLeaseAuthorized(req,jobId))return Response.json({error:"Unauthorized"},{status:401});
  try{
    const body=z.discriminatedUnion("operation",[
      z.object({operation:z.literal("console_read"),waitMs:z.number().int().min(0).max(2000).optional()}).strict(),
      z.object({operation:z.literal("console_input"),command:z.string().min(1).max(16000)}).strict(),
      z.object({operation:z.literal("console_close")}).strict(),
    ]).parse(await req.json());
    return Response.json(await browserLoginRequest(owner,chat,body.operation,body),{headers:{"Cache-Control":"no-store"}});
  }catch{return Response.json({error:"Secure console operation denied"},{status:409});}
}
