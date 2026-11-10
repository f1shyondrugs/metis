import {getAuthenticatedUserId} from "@/lib/auth";
import {browserLoginRequest,browserLoginSameOrigin} from "@/lib/browser-login-client";
import {ProtectedLoginError} from "@/lib/protected-login-errors";
import {consoleConnectionSchema} from "@/lib/credential-vault";
import {z} from "zod";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
async function owner(req:Request){return req.headers.get("cookie")&&!req.headers.has("x-chat-password")?getAuthenticatedUserId(req):null;}
export async function GET(req:Request){
 const user=await owner(req);if(!user)return Response.json({error:"Unauthorized"},{status:401,headers});
 try{return Response.json(await browserLoginRequest(user,undefined,"list",{},true),{headers});}
 catch{return Response.json({error:"The protected credential service is unavailable."},{status:503,headers});}
}
const fields={password:z.string().min(1).max(4096).optional(),username:z.string().min(1).max(512).optional(),email:z.string().email().max(320).optional()};
const origin=z.string().trim().min(1).max(2048);
const schema=z.union([
 z.object({action:z.literal("create"),origin,kind:z.literal("browser").default("browser"),...fields,password:z.string().min(1).max(4096)}).strict(),
 z.object({action:z.literal("create"),kind:z.literal("console"),connection:consoleConnectionSchema,target:origin,password:z.string().min(1).max(4096)}).strict(),
 z.object({action:z.literal("inspect"),connection:consoleConnectionSchema}).strict(),
 z.object({action:z.literal("delete"),origin,kind:z.enum(["browser","console"]).default("browser")}).strict(),
 z.object({action:z.literal("update"),origin,kind:z.enum(["browser","console"]).default("browser"),...fields}).strict(),
]);
export async function POST(req:Request){
 const user=await owner(req);if(!user)return Response.json({error:"Unauthorized"},{status:401,headers});
 if(!browserLoginSameOrigin(req))return Response.json({error:"Forbidden"},{status:403,headers});
 let input:z.infer<typeof schema>|undefined;
 try{
  const text=await req.text();if(Buffer.byteLength(text)>20000)throw Error();
  input=schema.parse(JSON.parse(text));
  if(input.action==="update"&&(!input.password&&!input.username&&!input.email||input.kind==="console"&&(!input.password||input.username||input.email)))throw Error();
  const result=await browserLoginRequest(user,undefined,input.action==="inspect"?"inspect_console":input.action,input,true);
  return Response.json(result,{headers});
 }catch(error){
  if(error instanceof ProtectedLoginError){
   const status=error.code==="credential_exists"||error.code==="console_credential_exists"||error.code==="credential_target_changed"?409:error.code==="credential_unavailable"?404:error.code==="https_required"?400:503;
   return Response.json({error:error.message,code:error.code},{status,headers});
  }
  return Response.json({error:"Could not save this login. Check the target and fields, then try again."},{status:400,headers});
 }finally{
  if(input){if("password" in input)input.password="";if("username" in input)input.username="";if("email" in input)input.email="";}
 }
}
