"use client";
import {useEffect,useState} from "react";
import {Download,Monitor,Smartphone,RefreshCw} from "lucide-react";
import {Button} from "@/components/ui/button";
import {suggestedAppPlatform,type AppPlatform} from "@/lib/client-onboarding";
const platforms:readonly {id:AppPlatform;label:string}[]=[{id:"windows",label:"Windows"},{id:"macos",label:"macOS"},{id:"linux",label:"Linux"},{id:"ios",label:"iOS"},{id:"android",label:"Android"}];
export function AppInstallOffer(){
 const [suggested,setSuggested]=useState<AppPlatform|null>(null),[platform,setPlatform]=useState<AppPlatform|null>(null);
 const [downloads,setDownloads]=useState<{label:string;url:string}[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0);
 useEffect(()=>{const found=suggestedAppPlatform(navigator);setSuggested(found);setPlatform(found);},[]);
 useEffect(()=>{
  setDownloads([]);setError("");if(!platform||platform==="ios"||platform==="android"){setLoading(false);return;}
  const controller=new AbortController();setLoading(true);
  void fetch("/api/onboarding/downloads?platform="+platform,{cache:"no-store",signal:controller.signal}).then(async response=>{
   const body=await response.json();if(!response.ok)throw Error(body.error||"Could not load app downloads.");
   if(!controller.signal.aborted)setDownloads((Array.isArray(body.downloads)?body.downloads:[]).filter((item:{url?:unknown})=>typeof item.url==="string"&&/^https:\/\/github\.com\/f1shyondrugs\/Metis-Apps\/releases\/(?:download|latest\/download)\//.test(item.url)));
  }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Could not load app downloads.");}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[platform,retry]);
 const mobile=platform==="ios"||platform==="android";
 return <section aria-label="Get the Metis app">
  <div className="flex items-start gap-3"><Monitor className="mt-1 size-6 shrink-0 text-primary"/><div><h2 className="text-lg font-medium">Choose your platform</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Or stay in your browser.</p></div></div>
  <label className="onboarding-platforms"><span className="sr-only">App platform</span><select aria-label="App platform" value={platform||""} onChange={event=>setPlatform(event.target.value as AppPlatform)}><option value="" disabled>Choose platform</option>{platforms.map(item=><option key={item.id} value={item.id}>{item.label}{item.id==="ios"||item.id==="android"?" · In development":""}</option>)}</select></label>
  {platform===suggested&&platform?<p className="text-xs text-muted-foreground">Suggested for this device</p>:!platform?<p className="text-sm text-muted-foreground">Choose your operating system to see available downloads.</p>:null}
  {mobile?<div className="mt-5 flex items-start gap-3 rounded-lg border border-border p-4"><Smartphone className="size-5 shrink-0"/><div><p className="font-medium">{platform==="ios"?"iOS":"Android"} · In development</p><p className="mt-1 text-sm text-muted-foreground">Use Metis in your browser for now.</p></div></div>:loading?<p role="status" className="mt-4 text-sm">Checking available installers…</p>:error?<div role="alert" className="mt-4 text-sm"><p>{error}</p><Button variant="outline" className="mt-3" onClick={()=>setRetry(value=>value+1)}><RefreshCw className="size-4"/>Retry</Button></div>:platform?<div className="onboarding-downloads">{downloads.length?downloads.map(item=><a key={item.url} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-4" href={item.url} target="_blank" rel="noopener noreferrer"><Download className="size-4"/>Download {item.label}</a>):<p role="status" className="text-sm text-muted-foreground">No confirmed installer.<button className="ml-2 underline" onClick={()=>setRetry(value=>value+1)}>Check again</button></p>}</div>:null}
 </section>;
}
