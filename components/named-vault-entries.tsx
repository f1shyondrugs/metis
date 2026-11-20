"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { namedVaultMutation, vaultFieldTypes, type NamedVaultSummary, type VaultFieldType } from "@/lib/named-vault-contract";

const endpoint="/api/browser/credential-entries";
const labels:Record<VaultFieldType,string>={url:"URL",text:"Text",login_id:"Login ID",secret:"Secret"};
type FieldDraft={key:string;id?:string;name:string;type:VaultFieldType;value:string};
type Draft={entry?:NamedVaultSummary;title:string;fields:FieldDraft[]};

export function NamedVaultEntriesPanel(){
  const [entries,setEntries]=useState<NamedVaultSummary[]>([]);
  const [loading,setLoading]=useState(true);
  const [failure,setFailure]=useState("");
  const [draft,setDraft]=useState<Draft|null>(null);
  const [remove,setRemove]=useState<NamedVaultSummary|null>(null);
  const [saving,setSaving]=useState(false);
  const [formError,setFormError]=useState("");
  const request=useRef<AbortController|null>(null);
  const update=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    request.current?.abort();
    const controller=new AbortController();request.current=controller;
    setLoading(true);setFailure("");
    try{
      const result=await fetch(endpoint,{signal:controller.signal,cache:"no-store"});
      const body=await result.json();
      if(!result.ok||!Array.isArray(body.entries))throw Error("Named vault entries are unavailable.");
      if(!controller.signal.aborted)setEntries(body.entries);
    }catch(error){
      if(!controller.signal.aborted)setFailure(error instanceof Error?error.message:"Could not reload entries.");
    }finally{if(!controller.signal.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();return()=>{request.current?.abort();update.current?.abort();};},[refresh]);

  const begin=(entry?:NamedVaultSummary)=>{
    setRemove(null);setFormError("");
    setDraft({entry,title:entry?.title??"",fields:(entry?.fields??[]).map(field=>({...field,key:field.id,value:""}))});
  };
  const close=()=>{if(saving)return;setDraft(null);setRemove(null);setFormError("");};
  const patchField=(key:string,patch:Partial<FieldDraft>)=>setDraft(current=>current&&{
    ...current,fields:current.fields.map(field=>field.key===key?{...field,...patch}:field),
  });
  async function submit(){
    const payload=remove?{action:"delete",id:remove.id,revision:remove.revision}:
      draft?{action:draft.entry?"update":"create",...(draft.entry?{id:draft.entry.id,revision:draft.entry.revision}:{}),
        title:draft.title,fields:draft.fields.map(field=>({id:field.id,name:field.name,type:field.type,value:field.value||undefined}))}:null;
    const parsed=namedVaultMutation.safeParse(payload);
    if(!parsed.success){setFormError("Enter a title and valid, unique field names and values.");return;}
    if(draft?.fields.some(field=>!field.value&&(!field.id||draft.entry?.fields.find(prior=>prior.id===field.id)?.type!==field.type))){
      setFormError("Enter a value for new fields or fields whose type changed.");return;
    }
    setSaving(true);setFormError("");
    const controller=new AbortController();update.current=controller;
    try{
      const result=await fetch(endpoint,{method:"POST",signal:controller.signal,
        headers:{"Content-Type":"application/json"},body:JSON.stringify(parsed.data)});
      const body=await result.json();
      if(!result.ok)throw Error(body.error||"Could not save the vault entry.");
      if(!controller.signal.aborted){setDraft(null);setRemove(null);void refresh();}
    }catch(error){
      if(!controller.signal.aborted)setFormError(error instanceof Error?error.message:"Could not save the vault entry.");
    }finally{if(!controller.signal.aborted)setSaving(false);}
  }

  return <section aria-label="Named vault entries" className="mt-6 space-y-3 border-t border-border pt-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">Named entries</h2>
      <Button variant="outline" className="min-h-11" disabled={loading||Boolean(failure)} onClick={()=>begin()}><Plus className="size-4" aria-hidden="true"/>Add entry</Button>
    </div>
    <p className="text-sm text-muted-foreground">Store named fields. Custom entries are not used automatically by login tools.</p>
    {failure?<div className="space-y-2"><p role="alert" className="text-sm text-destructive">{failure}</p><Button variant="outline" onClick={()=>void refresh()}>Retry</Button></div>:
      loading?<p role="status" className="text-sm text-muted-foreground">Loading named entries…</p>:
      entries.length===0?<p className="text-sm text-muted-foreground">No named entries yet.</p>:
      <ul className="divide-y divide-border">{entries.map(entry=><li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <div className="min-w-0 flex-1"><p className="break-words font-medium">{entry.title}</p><p className="text-xs text-muted-foreground">{entry.kind==="custom"?"Custom":entry.kind==="browser"?"Website":"Console"} · {entry.fields.length} {entry.fields.length===1?"field":"fields"}</p></div>
        <Button variant="outline" className="min-h-11" onClick={()=>begin(entry)}>Edit entry</Button>
        {entry.kind==="custom"?<Button variant="ghost" className="min-h-11 text-destructive" onClick={()=>{setDraft(null);setFormError("");setRemove(entry);}}>Delete</Button>:null}
      </li>)}</ul>}
    <Dialog open={Boolean(draft||remove)} onOpenChange={open=>{if(!open)close();}}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onEscapeKeyDown={event=>{if(saving)event.preventDefault();}} onPointerDownOutside={event=>{if(saving)event.preventDefault();}}>
        <DialogHeader>
          <DialogTitle>{remove?"Delete vault entry?":draft?.entry?"Edit vault entry":"Add vault entry"}</DialogTitle>
          <DialogDescription>{remove?`This permanently removes “${remove.title}” and its fields.`:draft?.entry&&draft.entry.kind!=="custom"?"The existing sign-in target stays bound. Manage its built-in login fields in Saved logins.":"Values are encrypted. Existing values are never prefilled."}</DialogDescription>
        </DialogHeader>
        <form className="min-w-0 space-y-4" onSubmit={event=>{event.preventDefault();void submit();}}>
          {draft?<fieldset className="min-w-0 space-y-3" disabled={saving}>
            <label className="block space-y-1 text-sm"><span>Title</span><Input required autoFocus maxLength={120} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label>
            {draft.fields.map((field,index)=><div key={field.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-border pt-3">
              <label className="min-w-0 space-y-1 text-sm"><span>Field {index+1} name</span><Input required maxLength={64} value={field.name} onChange={event=>patchField(field.key,{name:event.target.value})}/></label>
              <Button type="button" size="icon" variant="ghost" className="mt-5 size-11" aria-label={`Remove field ${index+1}`} onClick={()=>setDraft({...draft,fields:draft.fields.filter(item=>item.key!==field.key)})}><X className="size-4" aria-hidden="true"/></Button>
              <label className="col-span-2 space-y-1 text-sm"><span>Type</span><select value={field.type} className="h-10 w-full rounded-md border border-input bg-background px-2" onChange={event=>patchField(field.key,{type:event.target.value as VaultFieldType,value:""})}>{vaultFieldTypes.map(type=><option key={type} value={type}>{labels[type]}</option>)}</select></label>
              <label className="col-span-2 min-w-0 space-y-1 text-sm"><span>Value</span><Input autoComplete="off" type={field.type==="secret"||field.type==="login_id"?"password":field.type==="url"?"url":"text"} data-metis-sensitive="true" placeholder={field.id?"Leave blank to keep current value":""} maxLength={4096} value={field.value} onChange={event=>patchField(field.key,{value:event.target.value})}/></label>
            </div>)}
            <Button type="button" variant="outline" className="min-h-11" disabled={draft.fields.length>=20} onClick={()=>setDraft({...draft,fields:[...draft.fields,{key:crypto.randomUUID(),name:"",type:"secret",value:""}]})}><Plus className="size-4" aria-hidden="true"/>Add field</Button>
          </fieldset>:null}
          {formError?<p role="alert" className="text-sm text-destructive">{formError}</p>:null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={close}>Cancel</Button>
            <Button variant={remove?"destructive":"default"} className="min-h-11" disabled={saving}>{saving?"Saving…":remove?"Delete entry":"Save entry"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
