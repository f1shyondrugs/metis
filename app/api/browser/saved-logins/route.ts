import { getAuthenticatedUserId } from "@/lib/auth";
import { browserLoginRequest, browserLoginSameOrigin } from "@/lib/browser-login-client";
import { z } from "zod";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
async function owner(req:Request){return req.headers.get("cookie")&&!req.headers.has("x-chat-password")?getAuthenticatedUserId(req):null;}
export async function GET(req:Request){
  const user=await owner(req);if(!user)return Response.json({error:"Unauthorized"},{status:401,headers});
  try{return Response.json(await browserLoginRequest(user,undefined,"list",{},true),{headers});}
  catch{return Response.json({error:"Geschützter Passwortdienst nicht verfügbar."},{status:503,headers});}
}
export async function POST(req:Request){
  const user=await owner(req);if(!user)return Response.json({error:"Unauthorized"},{status:401,headers});
  if(!browserLoginSameOrigin(req))return Response.json({error:"Forbidden"},{status:403,headers});
  try{
    const text=await req.text();if(Buffer.byteLength(text)>20000)throw Error();
    const input=z.discriminatedUnion("action",[
      z.object({action:z.literal("delete"),origin:z.string().min(1).max(2048),kind:z.enum(["browser","console"]).default("browser")}).strict(),
      z.object({action:z.literal("update"),origin:z.string().min(1).max(2048),kind:z.enum(["browser","console"]).default("browser"),password:z.string().min(1).max(4096).optional(),username:z.string().min(1).max(512).optional(),email:z.string().email().max(320).optional()}).strict(),
    ]).parse(JSON.parse(text));
    if(input.action==="update"&&(!input.password&&!input.username&&!input.email||input.kind==="console"&&(!input.password||input.username||input.email)))throw Error();
    const result=await browserLoginRequest(user,undefined,input.action,input,true);
    if("password" in input)input.password="";
    if("username" in input)input.username="";
    if("email" in input)input.email="";
    return Response.json(result,{headers});
  }catch{return Response.json({error:"Passwort konnte nicht geändert werden."},{status:400,headers});}
}
