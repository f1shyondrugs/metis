import { getAuthenticatedUser } from "@/lib/auth";
import { getNoteCollaborationSession } from "@/lib/note-collaboration-store";
import {noteParticipant} from "@/lib/note-participant";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  const user=await getAuthenticatedUser(req);if(!user)return Response.json({error:"Unauthorized"},{status:401,headers});
  try{const session=getNoteCollaborationSession((await params).id,user);return session?Response.json({...session,user:await noteParticipant(user)},{headers}):Response.json({error:"Note unavailable"},{status:404,headers});}
  catch{return Response.json({error:"Live editing is unavailable for this document."},{status:409,headers});}
}
