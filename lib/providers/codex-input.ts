import type {Input} from "@openai/codex-sdk";
import type {ProviderModelDefinition} from "./types";
import type {AgentJob} from "@/lib/jobs";
import {isImageMime,resolveUploadPath} from "@/lib/uploads";
import {readSafeFile,ensureSafeDirectory,writeSafeFile} from "@/lib/safe-file-read";
import {MAX_ATTACHMENTS,MAX_INLINE_IMAGE_BYTES} from "@/lib/upload-limits";
import {nativeRuntimeScope} from "./native-sandbox";
import {canAccessChat} from "@/lib/project-access";
import {randomUUID} from "node:crypto";
import {rmSync} from "node:fs";
import path from "node:path";
import os from "node:os";

/** Native multimodal input, not a provider-native file tool. Snapshot only this
 * authorized turn's uploads into the already mounted account home. The SDK
 * reads them later, so never hand it a mutable workspace path or symlink. */
export function prepareCodexInput(prompt:string,job:Pick<AgentJob,"chatId"|"userId"|"attachments">,model:Pick<ProviderModelDefinition,"capabilities">|undefined,home?:string){
 const images=(job.attachments||[]).filter(a=>a.kind==="image"&&isImageMime(a.mimeType));
 let directory:string|undefined;
 const dispose=()=>{if(directory){rmSync(directory,{recursive:true,force:true});directory=undefined;}};
 if(!images.length)return {input:prompt as Input,dispose};
 if(model?.capabilities?.vision!==true)return {input:prompt+"\n\nImage input is unavailable or unconfirmed for the selected model. Attached image paths are references only; do not claim to have seen their pixels." as Input,dispose};
 if(!job.userId||!canAccessChat(job.chatId,job.userId))throw Error("Image input requires an authorized chat.");
 if(images.length>MAX_ATTACHMENTS)throw Error("Too many image attachments.");
 const input:Exclude<Input,string>=[{type:"text",text:prompt}];
 try{
  directory=path.join(home||nativeRuntimeScope()?.home||os.tmpdir(),"metis-vision-"+randomUUID());
  ensureSafeDirectory(directory,{mode:0o700});
  for(const [index,attachment] of images.entries()){
   const source=resolveUploadPath(job.chatId,attachment.storedName,job.userId);
   if(!source)throw Error("An attached image is no longer available. Please attach it again.");
   const bytes=readSafeFile(source,MAX_INLINE_IMAGE_BYTES);
   if(!bytes.length)throw Error("An attached image is empty.");
   const imagePath=path.join(directory,String(index)+path.extname(attachment.storedName).toLowerCase());
   writeSafeFile(imagePath,bytes,{exclusive:true,mode:0o600});
   input.push({type:"local_image",path:imagePath});
  }
  return {input,dispose};
 }catch(error){dispose();throw error;}
}
