import {notesNavigationTarget} from "./notes-navigation";
export type NotebookLink=
 |{type:"note";id:string;blockId?:string}
 |{type:"share";token:string;noteId?:string};
const validId=(id:string)=>id.length<=200&&!/[\u0000-\u001f\u007f/\\]/.test(id);
/** Only this installation's URLs can address its private notes or share grants. */
export function parseNotebookLink(href:string|undefined,origin:string|undefined):NotebookLink|null{
 if(!href||!origin||! /^(?:https?:\/\/|\/(?!\/))/i.test(href))return null;
 try{
  const url=new URL(href,origin),base=new URL(origin);
  if(url.origin!==base.origin||url.username||url.password||!/^https?:$/.test(url.protocol))return null;
  const target=notesNavigationTarget(url.hash);
  if(target&&(!validId(target.id)||target.kind!=="note"))return null;
  if(url.pathname==="/"&&url.searchParams.get("c")==="notes"&&target?.kind==="note")return {type:"note",id:target.id,...(target.blockId?{blockId:target.blockId}:{})};
  const share=/^\/share\/notes\/([A-Za-z0-9_-]{43})\/?$/.exec(url.pathname);
  return share?{type:"share",token:share[1],...(target?.kind==="note"?{noteId:target.id}:{})}:null;
 }catch{return null;}
}
