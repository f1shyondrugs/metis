import {getAuthenticatedUser} from "@/lib/auth";
import {getDatabase} from "@/lib/sqlite";
import {noteParticipantAvatar} from "@/lib/note-participant";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:Request,{params}:{params:Promise<{userId:string}>}){
 const viewer=await getAuthenticatedUser(req);
 if(!viewer)return new Response(null,{status:401,headers:{"Cache-Control":"private, no-store"}});
 const {userId}=await params;
 const user=getDatabase().prepare("SELECT username FROM users WHERE id=?").get(userId) as {username:string}|undefined;
 return user?noteParticipantAvatar(userId,user.username,viewer.id,req.headers.get("if-none-match")):new Response(null,{status:404,headers:{"Cache-Control":"private, no-store"}});
}
