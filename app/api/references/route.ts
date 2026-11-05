import { getAuthenticatedUserId,isAuthenticated } from "@/lib/auth";
import { REFERENCE_KINDS,type ReferenceKind } from "@/lib/reference-search";
import { searchReferences } from "@/lib/reference-search-server";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:Request){
 if(!(await isAuthenticated(req)))return Response.json({error:"Unauthorized"},{status:401});
 const ownerId=await getAuthenticatedUserId(req);
 if(!ownerId)return Response.json({error:"Account context required"},{status:401});
 const url=new URL(req.url),kind=url.searchParams.get("kind") as ReferenceKind|null;
 if(kind && !(REFERENCE_KINDS as readonly string[]).includes(kind))return Response.json({error:"Unknown reference category"},{status:400});
 const rawKinds=url.searchParams.get("kinds");
 const kinds=rawKinds ? rawKinds.split(",") as ReferenceKind[] : undefined;
 if(kinds && (kinds.length>REFERENCE_KINDS.length || kinds.some(value=>!(REFERENCE_KINDS as readonly string[]).includes(value)) || (kind && !kinds.includes(kind))))return Response.json({error:"Unknown reference category"},{status:400});
 const currentChatId=url.searchParams.get("chatId")||"";
 try{
  const payload=await searchReferences({ownerId,kind,kinds,currentChatId,query:(url.searchParams.get("q")||"").trim().toLowerCase().slice(0,200)},req.signal);
  return Response.json({...payload,currentChatId},{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){
  if(error instanceof Error && error.name==="AbortError")return new Response(null,{status:499});
  return Response.json({error:"Could not load context. Try again."},{status:503});
 }
}
