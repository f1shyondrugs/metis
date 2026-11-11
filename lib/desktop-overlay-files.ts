import { getCompletedUpload } from "@/lib/file-upload-store";
import { getChat } from "@/lib/db-store";
import { resolveUploadPath } from "@/lib/uploads";
import type { UploadedFile } from "@/lib/upload-limits";

type ResolvedFile=UploadedFile & {overlayUrl?:string};
/** Resolve exact registered snapshots; cache the authorized chat once per command,
 * not once per item. Caller URLs and native paths are never accepted.
 */
export function createDesktopOverlayFileResolver(ownerId:string,chatId?:string) {
  let loaded=false,chat:ReturnType<typeof getChat>=null;
  return (requestedOwner:string,id:string):ResolvedFile=>{
    if(!ownerId||requestedOwner!==ownerId)throw new Error("Overlay attachment not found");
    try { return getCompletedUpload(ownerId,id); }
    catch { /* provide_file snapshots use the current chat, not chunked upload storage. */ }
    if(!loaded){loaded=true;chat=chatId?getChat(chatId,ownerId):null;}
    const attachment=chat?.messages.flatMap(m=>m.attachments||[]).find(a=>a.id===id);
    if(!chat || !attachment || !resolveUploadPath(chat.id,attachment.storedName,ownerId))throw new Error("Overlay attachment not found");
    return {id:attachment.id,name:attachment.name,mimeType:attachment.mimeType,size:attachment.size,kind:attachment.kind,
      overlayUrl:"/api/uploads/"+encodeURIComponent(chat.id)+"/"+encodeURIComponent(attachment.storedName)};
  };
}
export function resolveDesktopOverlayFile(ownerId:string,id:string,chatId?:string):ResolvedFile {
  return createDesktopOverlayFileResolver(ownerId,chatId)(ownerId,id);
}
