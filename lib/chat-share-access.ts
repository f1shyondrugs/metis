import {createHash} from "node:crypto";
import {config} from "@/lib/config";
import {signShareCredential,verifyShareCredential} from "@/lib/share-credential";
import type {ChatShare} from "@/lib/store";

const cookieName=(id:string)=>"metis_chat_share_"+createHash("sha256").update(id).digest("hex").slice(0,32);
export function chatShareCredential(req:Request,id:string) {
  return req.headers.get("cookie")?.split(";").map(s=>s.trim()).find(s=>s.startsWith(cookieName(id)+"="))?.slice(cookieName(id).length+1);
}
export function createChatShareAccess(share:ChatShare) {
  return signShareCredential(share.id+":"+share.updatedAt,share.accessKey||share.passwordHash||"");
}
export function validChatShareAccess(share:ChatShare,credential?:string) {
  return verifyShareCredential(share.id+":"+share.updatedAt,share.accessKey||share.passwordHash||"",credential);
}
export function chatShareAccessCookie(req:Request,id:string,credential:string) {
  const secure=new URL(req.url).protocol==="https:"||new URL(config.publicUrl).protocol==="https:";
  return cookieName(id)+"="+credential+"; HttpOnly; SameSite=Lax; Path=/api/share; Max-Age=43200"+(secure?"; Secure":"");
}
