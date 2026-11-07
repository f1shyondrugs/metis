import { REFERENCE_KINDS, type ReferenceResult } from "./reference-search";

type LinkReference = Pick<ReferenceResult,"kind"|"id"> & Partial<ReferenceResult>;
const clean=(value:unknown,max=4096):value is string=>typeof value==="string"&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);

/** Identity and navigation hints only. Destination APIs retain their normal access checks. */
export function referenceHref(item:LinkReference):string|null {
  if(!clean(item.id,2000)||!item.id.trim())return null;
  if(item.kind==="note"||item.kind==="issue")return item.kind+"://"+encodeURIComponent(item.id);
  if(item.kind==="canvas"||item.kind==="plan")return "workspace://"+item.kind+"/"+encodeURIComponent(item.id);
  if(!(REFERENCE_KINDS as readonly string[]).includes(item.kind))return null;
  const query=new URLSearchParams();
  for(const key of ["label","chatId","path","sessionId","target"] as const){
    const value=item[key];if(clean(value))query.set(key,value);
  }
  return "metis://reference/"+item.kind+"/"+encodeURIComponent(item.id)+(query.size?"?"+query:"");
}

export function parseReferenceLink(href:string|undefined):ReferenceResult|null {
  if(!href||href.length>16000||!/^metis:\/\/reference\//i.test(href))return null;
  try{
    const url=new URL(href),parts=url.pathname.split("/");
    if(parts.length!==3||url.hash||url.username||url.password)return null;
    const kind=parts[1] as ReferenceResult["kind"],id=decodeURIComponent(parts[2]);
    if(!(REFERENCE_KINDS as readonly string[]).includes(kind)||!clean(id,2000)||!id.trim())return null;
    const item:ReferenceResult={kind,id,label:id};
    for(const key of ["label","chatId","path","sessionId","target"] as const){
      const value=url.searchParams.get(key);if(value!==null){if(!clean(value))return null;item[key]=value;}
    }
    if(kind==="browser"&&item.path&&!/^https?:\/\//i.test(item.path))return null;
    return item;
  }catch{return null;}
}
