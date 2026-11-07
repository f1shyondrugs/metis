import { getAuthenticatedUserId } from "@/lib/auth";
import { getPendingQuestion } from "@/lib/db-questions";
import { getChat } from "@/lib/db-store";
import { browserLoginRequest, browserLoginSameOrigin } from "@/lib/browser-login-client";
import { z } from "zod";
export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(req:Request) {
  const headers={"Cache-Control":"no-store"};
  if(!req.headers.get("cookie") || req.headers.has("x-chat-password"))return Response.json({error:"Unauthorized"},{status:401,headers});
  const owner=await getAuthenticatedUserId(req);
  if(!owner)return Response.json({error:"Unauthorized"},{status:401,headers});
  if(!browserLoginSameOrigin(req))return Response.json({error:"Forbidden"},{status:403,headers});
  try {
    const text=await req.text();if(Buffer.byteLength(text)>20000)throw Error();
    const body=z.object({questionId:z.string().uuid(),password:z.string().min(1).max(4096).optional(),username:z.string().min(1).max(512).optional(),email:z.string().email().max(320).optional(),persist:z.boolean().default(false)}).strict().parse(JSON.parse(text));
    const pending=getPendingQuestion(body.questionId,owner);
    if(!pending || pending.status!=="waiting_for_user")throw Error();
    const chat=getChat(pending.chatId,owner);
    const secure=chat?.pendingQuestion?.questionId===body.questionId?chat.pendingQuestion.secureBrowserInput:undefined;
    if(!secure || Date.parse(secure.expiresAt)<=Date.now())throw Error();
    const required=secure.kind==="console"?["password"]as const:secure.fields??["password"];
    if(required.some(key=>!body[key as "password"|"username"|"email"])||secure.kind==="console"&&(body.username||body.email))throw Error();
    await browserLoginRequest(owner,pending.chatId,secure.kind==="console"?"console_fill":"fill",{requestId:secure.requestId,password:body.password,username:body.username,email:body.email,persist:body.persist},true);
    body.password="";body.username="";body.email="";
    return Response.json({status:body.persist?"filled_and_saved":"filled_for_chat"},{headers});
  }catch{return Response.json({error:"Credentials could not be entered. Request a new login form."},{status:409,headers});}
}
