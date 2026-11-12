import {startUpload,waitForUpload,cancelUpload,getUploadStatus} from "@/lib/background-uploads";
import type {DesktopCapture} from "@/lib/desktop-assistant";

/** Enqueue together; the canonical upload pump owns bounded concurrency.
 * Promise.all preserves monitor order, not completion order. Drain every task
 * before returning so cancellation/failure cannot add uploads after cleanup. */
export async function uploadAssistantScreens(monitors:DesktopCapture["monitors"],invalid:()=>boolean){
 const tasks:string[]=[];let failed=false;let failure:unknown;
 const check=()=>{if(failed||invalid())throw Error("Message cancelled before submission. Your draft is preserved.");};
 const cancel=()=>{failed=true;tasks.forEach(cancelUpload);};
 const pending=monitors.map(async(monitor,index)=>{
  try{
   check();const blob=await (await fetch(monitor.image)).blob();check();
   const task=startUpload(new File([blob],"Monitor-"+(index+1)+"-"+monitor.id+".png",{type:"image/png"}),{label:"Desktop Assistant"});
   tasks.push(task);
   const result=await new Promise<{id:string}>((resolve,reject)=>{
    const timer=setInterval(()=>{if(invalid()){cancelUpload(task);reject(Error("Message cancelled before submission. Your draft is preserved."));}else if(getUploadStatus(task)==="error"){cancelUpload(task);reject(Error("Screen upload failed. Retry the message."));}},200);
    void waitForUpload(task).then(resolve,reject).finally(()=>clearInterval(timer));
   });
   check();return result.id;
  }catch(error){if(!failed)failure=error;cancel();throw error;}
 });
 const results=await Promise.allSettled(pending);
 const rejected=results.find((r):r is PromiseRejectedResult=>r.status==="rejected");
 if(rejected)throw failure||rejected.reason;
 check();
 return {ids:results.map(r=>(r as PromiseFulfilledResult<string>).value),tasks};
}
