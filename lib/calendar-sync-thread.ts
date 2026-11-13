import {Worker} from "node:worker_threads";
/** Native background sync is off the request/event loop and survives closing the browser. */
export function startCalendarSyncWorker(){
 if(process.env.METIS_CALENDAR_SYNC_DISABLED==="1")return ()=>Promise.resolve();
 let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,stopped=false,failures=0;
 function launch(){
  if(stopped)return;
  const current=new Worker(new URL("../scripts/calendar-worker.mjs",import.meta.url),{execArgv:[],resourceLimits:{maxOldGenerationSizeMb:512}});
  worker=current;current.unref();
  current.on("message",message=>{if(message?.type==="ready")failures=0;});
  current.on("error",()=>console.warn("[calendar] Background sync worker failed; local events are retained."));
  current.on("exit",()=>{if(worker===current)worker=undefined;if(!stopped){timer=setTimeout(launch,Math.min(60000,1000*2**Math.min(++failures,6)));timer.unref();}});
 }
 launch();
 return async()=>{stopped=true;clearTimeout(timer);if(worker){const current=worker;worker=undefined;await current.terminate();}};
}
