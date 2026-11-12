import sharp from "sharp";
import {readSafeFile} from "@/lib/safe-file-read";
import {isImageMime,resolveUploadPath,type StoredAttachment} from "@/lib/uploads";
import {MAX_INLINE_IMAGE_BYTES} from "@/lib/upload-limits";
export type ImageCrop={x:number;y:number;width:number;height:number};
export async function inspectAttachmentImage(chatId:string,ownerId:string,attachments:StoredAttachment[],id:unknown,crop?:unknown){
 const attachment=typeof id==="string"?attachments.find(a=>a.id===id):undefined;
 if(!attachment||attachment.kind!=="image"||!isImageMime(attachment.mimeType))throw Error("Image attachment not found.");
 const file=resolveUploadPath(chatId,attachment.storedName,ownerId);
 if(!file)throw Error("Image attachment not found.");
 const pixels=readSafeFile(file,MAX_INLINE_IMAGE_BYTES);
 const options={limitInputPixels:16*1024*1024,animated:false};
 const metadata=await sharp(pixels,options).metadata();
 if(!metadata.width||!metadata.height)throw Error("Image dimensions are unavailable.");
 let region:ImageCrop|undefined;
 if(crop!==undefined){
  if(!crop||typeof crop!=="object"||Array.isArray(crop))throw Error("Invalid crop.");
  const c=crop as Record<string,unknown>;
  if(Object.keys(c).some(k=>!["x","y","width","height"].includes(k))||!["x","y","width","height"].every(k=>Number.isSafeInteger(c[k])))throw Error("Crop must use integer source-image pixels.");
  region=c as ImageCrop;
  if(region.x<0||region.y<0||region.width<=0||region.height<=0||region.x+region.width>metadata.width||region.y+region.height>metadata.height)throw Error("Crop is outside the source image.");
 }
 let image=sharp(pixels,options);
 if(region)image=image.extract({left:region.x,top:region.y,width:region.width,height:region.height});
 const {data,info}=await image.resize({width:2048,height:2048,fit:"inside",withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
 if(data.length>MAX_INLINE_IMAGE_BYTES)throw Error("Image preview is too large. Request a smaller crop.");
 return {content:[{type:"text" as const,text:JSON.stringify({attachment_id:attachment.id,source:{width:metadata.width,height:metadata.height},crop:region||null,returned:{width:info.width,height:info.height},coordinates:"Crop uses original source-image pixels; this preview is not a fresh desktop observation."})},{type:"image" as const,mimeType:"image/png",data:data.toString("base64")}]};
}
