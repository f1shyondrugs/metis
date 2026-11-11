import { Worker } from "node:worker_threads";
import path from "node:path";
import { config } from "./config";

export type RemotePresence = {
 clientId:string;ownerId:string;status:"online"|"offline";at:string;
 address?:string;desktopGui?:boolean;overlayAnnotations?:boolean;credentialHash?:string;credentialUsedAt?:string;
};
type Pending=RemotePresence & {sequence:number};
/** Advisory presence is coalesced per device, never written on the HTTP/WS thread. */
export class RemotePresenceWriter {
 private pending=new Map<string,Pending>();
 private worker:Worker|undefined;
 private busy=false;
 private sequence=0;
 private retry:ReturnType<typeof setTimeout>|undefined;
 private idle:ReturnType<typeof setTimeout>|undefined;
 private stopped=false;
 constructor(private databasePath=config.databasePath){}
 enqueue(update:RemotePresence){
  if(this.stopped)return false;
  if(!this.pending.has(update.clientId)&&this.pending.size>=1024)this.pending.delete(this.pending.keys().next().value!);
  this.pending.set(update.clientId,{...this.pending.get(update.clientId),...update,sequence:++this.sequence});
  queueMicrotask(()=>this.pump());
  return true;
 }
 peek(clientId:string,ownerId:string){const value=this.pending.get(clientId);return value?.ownerId===ownerId?value:undefined;}
 private pump(){
  if(this.stopped||this.busy||!this.pending.size||this.retry)return;
  clearTimeout(this.idle);
  if(!this.worker){
   let owned:Worker;
   try{owned=new Worker(path.join(process.env.AI_CHAT_INSTALL_DIR || process.cwd(),"lib/remote-presence-worker.mjs"),{
    workerData:{databasePath:this.databasePath},execArgv:[],
    resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:16},
   });}catch{this.scheduleRetry();return;}
   this.worker=owned;
   owned.on("message",(reply:{sequences:number[];ok:boolean})=>{
    if(this.worker!==owned)return;
    this.busy=false;
    if(reply.ok)for(const [id,item] of this.pending)if(reply.sequences.includes(item.sequence))this.pending.delete(id);
    if(!reply.ok)this.scheduleRetry();
    else if(this.pending.size)this.pump();
    else {this.idle=setTimeout(()=>{if(this.worker===owned){this.worker=undefined;void owned.terminate();}},120_000);this.idle.unref();}
   });
   owned.on("error",()=>{if(this.worker===owned){this.worker=undefined;this.busy=false;this.scheduleRetry();}});
   owned.on("exit",()=>{if(this.worker===owned){this.worker=undefined;this.busy=false;this.scheduleRetry();}});
   owned.unref();
  }
  this.busy=true;
  try{this.worker.postMessage([...this.pending.values()].slice(0,32));}
  catch{const owned=this.worker;this.worker=undefined;this.busy=false;void owned?.terminate();this.scheduleRetry();}
 }
 private scheduleRetry(){
  if(this.stopped||this.retry||!this.pending.size)return;
  this.retry=setTimeout(()=>{this.retry=undefined;this.pump();},500);this.retry.unref();
 }
 async stop(){
  this.stopped=true;clearTimeout(this.retry);clearTimeout(this.idle);this.pending.clear();
  const owned=this.worker;this.worker=undefined;if(owned)await owned.terminate();
 }
}
const shared=globalThis as typeof globalThis & {__metisRemotePresenceWriter?:RemotePresenceWriter};
export async function stopRemotePresenceWriter(){const writer=shared.__metisRemotePresenceWriter;delete shared.__metisRemotePresenceWriter;await writer?.stop();}
export function getRemotePresence(clientId:string,ownerId:string){return shared.__metisRemotePresenceWriter?.peek(clientId,ownerId);}
export function queueRemotePresence(update:RemotePresence){
 return (shared.__metisRemotePresenceWriter??=new RemotePresenceWriter()).enqueue(update);
}
