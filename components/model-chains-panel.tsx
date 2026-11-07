"use client";
import {useState} from "react";
import {ArrowDown,ArrowUp,Link2,Plus,Trash2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {ModelPicker} from "@/components/model-picker";
import {ModelOptionsMenu} from "@/components/model-options-menu";
import type {ModelInfo} from "@/components/settings-panel";
import type {ModelChain,ModelChainStep} from "@/lib/model-chain-types";
import {modelForSelection} from "@/lib/model-selection";
import {useModelChains,notifyModelChainsChanged} from "@/components/use-model-chains";

type Draft={id?:string;version?:number;name:string;steps:ModelChainStep[]};
export function ModelChainsPanel({models}:{models:ModelInfo[]}){
 const {chains,loading,error,refresh}=useModelChains();
 const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[failure,setFailure]=useState("");
 const [deleteId,setDeleteId]=useState<string|null>(null);
 function begin(chain?:ModelChain){setFailure("");setDeleteId(null);setDraft(chain?{id:chain.id,version:chain.version,name:chain.name,steps:chain.steps.map(s=>({...s,modelParams:[...s.modelParams]}))}:{name:"",steps:[{modelId:"",modelParams:[]},{modelId:"",modelParams:[]}]});}
 async function mutate(method:"PUT"|"DELETE",body:unknown){
  setBusy(true);setFailure("");
  try{
   const response=await fetch("/api/model-chains",{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
   const data=await response.json();if(!response.ok)throw Error(data.error||"Could not save model chain.");
   setDraft(null);setDeleteId(null);notifyModelChainsChanged();
  }catch(e){setFailure(e instanceof Error?e.message:"Could not save model chain.");}finally{setBusy(false);}
 }
 function stepChange(index:number,step:ModelChainStep){setDraft(v=>v?{...v,steps:v.steps.map((s,i)=>i===index?step:s)}:v);}
 function move(index:number,by:number){setDraft(v=>{if(!v)return v;const steps=[...v.steps];[steps[index],steps[index+by]]=[steps[index+by],steps[index]];return {...v,steps};});}
 return <div className="min-w-0 space-y-5">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Link2 className="size-5"/>Model Chains</h2><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Try models in order. Usage exhaustion switches immediately; temporary unavailability switches after 3 retries.</p></div><Button onClick={()=>begin()} disabled={busy||Boolean(draft)} className="min-h-11 gap-2"><Plus className="size-4"/>New chain</Button></div>
  {(failure||error)&&<div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm"><p>{failure||error}</p>{error&&<Button variant="outline" onClick={refresh}>Retry</Button>}</div>}
  {loading?<p role="status" className="text-sm text-muted-foreground">Loading model chains…</p>:null}
  {draft?<form className="space-y-5" onSubmit={e=>{e.preventDefault();void mutate("PUT",draft);}}>
   <label className="block space-y-2 text-sm">Chain name<Input autoFocus aria-label="Chain name" required maxLength={80} value={draft.name} disabled={busy} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
   <ol className="space-y-3" aria-label="Models in fallback order">{draft.steps.map((step,index)=>{
    const model=modelForSelection(models,step.modelId);
    return <li key={index} className="min-w-0 rounded-lg border border-border p-3">
     <div className="mb-2 flex items-center justify-between gap-2"><span className="text-sm font-medium">{index===0?"1 · Preferred":(index+1)+" · Fallback "+index}</span><div className="flex shrink-0 gap-1">
      <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={"Move model "+(index+1)+" up"} disabled={busy||index===0} onClick={()=>move(index,-1)}><ArrowUp className="size-4"/></Button>
      <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={"Move model "+(index+1)+" down"} disabled={busy||index===draft.steps.length-1} onClick={()=>move(index,1)}><ArrowDown className="size-4"/></Button>
      <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={"Remove model "+(index+1)} disabled={busy||draft.steps.length<=2} onClick={()=>setDraft({...draft,steps:draft.steps.filter((_,i)=>i!==index)})}><Trash2 className="size-4"/></Button>
     </div></div>
     <div className="flex min-w-0 items-center gap-2"><ModelPicker models={models} value={step.modelId} onValueChange={id=>stepChange(index,{modelId:id,modelParams:modelForSelection(models,id)?.defaultParams||[]})} favoriteModelKeys={[]} onToggleFavorite={()=>{}} allowPinning={false} disabled={busy} className="w-0 min-w-0 flex-1" ariaLabel={"Chain model "+(index+1)}/>{model&&<ModelOptionsMenu model={model} modelParams={step.modelParams} disabled={busy} onModelParamsChange={params=>stepChange(index,{...step,modelParams:params})}/>}</div>
     {!model&&step.modelId?<p className="mt-2 break-all text-xs text-destructive">Unavailable: {step.modelId}. Choose an available model.</p>:null}
    </li>;
   })}</ol>
   <div className="flex flex-wrap justify-between gap-3"><Button type="button" variant="outline" className="min-h-11 gap-2" disabled={busy||draft.steps.length>=16} onClick={()=>setDraft({...draft,steps:[...draft.steps,{modelId:"",modelParams:[]}]})}><Plus className="size-4"/>Add fallback</Button><div className="flex gap-2"><Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={()=>setDraft(null)}>Cancel</Button><Button type="submit" className="min-h-11" disabled={busy||!draft.name.trim()||draft.steps.some(s=>!modelForSelection(models,s.modelId))}>{busy?"Saving…":"Save chain"}</Button></div></div>
  </form>:<div className="divide-y divide-border">{chains.map(chain=><section key={chain.id} className="py-4 first:pt-0">
   <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-medium">{chain.name}</h3><ol className="mt-2 space-y-1 text-sm text-muted-foreground">{chain.steps.map((step,index)=><li key={step.modelId} className="break-words">{index+1}. {modelForSelection(models,step.modelId)?.displayName||step.modelId}</li>)}</ol></div><div className="flex shrink-0 gap-1"><Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>begin(chain)}>Edit</Button><Button variant="ghost" size="icon" className="size-11" disabled={busy} aria-label={"Delete "+chain.name} onClick={()=>setDeleteId(chain.id)}><Trash2 className="size-4"/></Button></div></div>
   {deleteId===chain.id&&<div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><span>Delete this chain?</span><Button variant="destructive" disabled={busy} onClick={()=>void mutate("DELETE",{id:chain.id,version:chain.version})}>Delete chain</Button><Button variant="ghost" onClick={()=>setDeleteId(null)}>Cancel</Button></div>}
  </section>)}</div>}
  {!loading&&!error&&!chains.length&&!draft?<div className="rounded-lg border border-dashed border-border px-5 py-8 text-center"><Link2 className="mx-auto mb-3 size-6 text-muted-foreground"/><p className="text-sm">No model chains yet.</p><p className="mt-1 text-xs text-muted-foreground">Create a chain to add the Chains tab beside All in the chat model picker.</p></div>:null}
  <p className="text-xs leading-relaxed text-muted-foreground">Authentication, invalid requests and tool errors do not trigger fallback. Each run keeps its starting chain order; changes apply to new runs.</p>
 </div>;
}
