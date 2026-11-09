import { getAuthenticatedUserId } from "@/lib/auth";
import { listDeletedChats, restoreDeletedChat, permanentlyDeleteChat } from "@/lib/chat-trash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {"Cache-Control":"no-store"};

export async function GET(req:Request) {
  const userId=await getAuthenticatedUserId(req);
  if(!userId) return Response.json({error:"Unauthorized"},{status:401,headers});
  return Response.json({chats:listDeletedChats(userId)},{headers});
}
async function mutate(req:Request, permanent:boolean) {
  const userId=await getAuthenticatedUserId(req);
  if(!userId) return Response.json({error:"Unauthorized"},{status:401,headers});
  const origin=req.headers.get("origin");
  if(origin && origin!==new URL(req.url).origin) return Response.json({error:"Invalid origin"},{status:403,headers});
  let body:unknown;
  try { body=await req.json(); } catch { return Response.json({error:"Invalid request"},{status:400,headers}); }
  const id=body && typeof body==="object" && "id" in body ? body.id : null;
  if(typeof id!=="string" || !id || id.length>200) return Response.json({error:"Invalid chat ID"},{status:400,headers});
  const ok=permanent ? permanentlyDeleteChat(id,userId) : restoreDeletedChat(id,userId);
  return ok ? Response.json({ok:true},{headers}) : Response.json({error:"Not found"},{status:404,headers});
}
export async function POST(req:Request) {return mutate(req,false);}
export async function DELETE(req:Request) {return mutate(req,true);}
