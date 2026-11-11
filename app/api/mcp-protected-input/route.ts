import {getAuthenticatedUserId} from "@/lib/auth";
import {getPendingQuestion} from "@/lib/db-questions";
import {getJob} from "@/lib/db-jobs";
import {getChat} from "@/lib/db-store";
import {browserLoginSameOrigin} from "@/lib/browser-login-client";
import {fillMcpInput} from "@/lib/mcp-protected-input";
import {z} from "zod";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:Request){
 const headers={"Cache-Control":"no-store"};
 if(!req.headers.get("cookie")||req.headers.has("x-chat-password"))return Response.json({error:"Unauthorized"},{status:401,headers});
 const owner=await getAuthenticatedUserId(req);
 if(!owner)return Response.json({error:"Unauthorized"},{status:401,headers});
 if(!browserLoginSameOrigin(req))return Response.json({error:"Forbidden"},{status:403,headers});
 let values:Record<string,string>|undefined;
 try{
  const text=await req.text();if(Buffer.byteLength(text)>65536)throw Error();
  const body=z.object({questionId:z.string().uuid(),values:z.record(z.string(),z.string())}).strict().parse(JSON.parse(text));
  values=body.values;
  const pending=getPendingQuestion(body.questionId,owner),secure=pending?.secureBrowserInput;
  if(!pending||pending.status!=="waiting_for_user"||secure?.kind!=="mcp"||!pending.jobId||getChat(pending.chatId,owner)?.pendingQuestion?.questionId!==body.questionId)throw Error();
  const job=getJob(pending.jobId);
  if(!job||job.userId!==owner||job.chatId!==pending.chatId||!["waiting_input","waiting_for_user"].includes(job.status))throw Error();
  return Response.json(await fillMcpInput(owner,pending.chatId,pending.jobId,secure.requestId,values),{headers});
 }catch{return Response.json({error:"MCP credentials could not be configured. Request a fresh protected form."},{status:409,headers});}
 finally{if(values)for(const key of Object.keys(values))values[key]="";}
}
