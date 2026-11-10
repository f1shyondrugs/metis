/** Notebook presence shares location metadata, never document text or selection contents. */
export const NOTEBOOK_PRESENCE_URL="/ws/notes?presence=1";
export type NotebookPerson={id:string;username:string;name:string;avatar:string|null;color:string};
export type NotebookView={scroll:number;blockId?:string;point?:{x:number;y:number;seq:number}};
export type NotebookPeer={sessionId:string;user:NotebookPerson;note:{id:string;title:string;projectId?:string};view?:NotebookView};
export type NotebookSnapshot={type:"presence";self:NotebookPerson;sessionId:string;peers:NotebookPeer[]};
export function notebookView(value:unknown):NotebookView|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(typeof v.scroll!=="number"||!Number.isFinite(v.scroll)||v.scroll<0||v.scroll>1)return null;
 const view:NotebookView={scroll:v.scroll};
 if(v.blockId!==undefined){if(typeof v.blockId!=="string"||v.blockId.length>200||/[\u0000-\u001f\u007f]/.test(v.blockId))return null;view.blockId=v.blockId;}
 if(v.point!==undefined){
  if(!v.point||typeof v.point!=="object")return null;
  const p=v.point as Record<string,unknown>;
  if(![p.x,p.y].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=1)||!Number.isSafeInteger(p.seq)||Number(p.seq)<0)return null;
  view.point={x:p.x as number,y:p.y as number,seq:p.seq as number};
 }
 if(Object.keys(v).some(k=>!["scroll","blockId","point"].includes(k)))return null;
 return view;
}
/** Invalidates pending note loads on Stop, participant changes and A → B → A navigation. */
export class NotebookFollowNavigation {
 private version=0;
 private location:string|null=null;
 move(sessionId:string,noteId:string){
  const next=JSON.stringify([sessionId,noteId]);
  if(next===this.location)return false;
  this.location=next;this.version++;return true;
 }
 stop(){this.location=null;this.version++;}
 capture(){
  const version=this.version;
  return ()=>this.location!==null&&this.version===version;
 }
}
export function uniqueNotebookPeers(peers:NotebookPeer[],selfId:string){
 const users=new Map<string,NotebookPeer>();
 for(const peer of peers)if(peer.user.id!==selfId&&!users.has(peer.user.id))users.set(peer.user.id,peer);
 return [...users.values()];
}
