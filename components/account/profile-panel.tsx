"use client";
import { useEffect, useState } from "react";
import { Check, Copy, Crop, ExternalLink, Link2, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import { ImageFramingDialog } from "@/components/image-framing-dialog";
import { BannerUpload } from "@/components/banner-upload";
import { BannerHeader } from "@/components/banner-image";
import { uploadProfileBannerFile } from "@/lib/profile-banner-upload";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ProfileAvatar } from "@/components/account/account-menu";
import { TokenHeatmap } from "@/components/account/token-heatmap";
import type { AccountProfile, AccountUsage } from "@/lib/account-types";
import { MAX_PROFILE_GIF_BYTES } from "@/lib/profile-avatar-limits";

async function avatarData(file:File) {
  if(file.type === "image/gif" || /\.gif$/i.test(file.name)) {
    if(file.size>MAX_PROFILE_GIF_BYTES) throw new Error("GIF profile pictures can be up to 50 MB.");
    const response=await fetch("/api/profile/avatar",{method:"PUT",headers:{"Content-Type":"image/gif"},body:file});
    const data=await response.json();if(!response.ok)throw new Error(data.error || "Could not upload GIF.");
    return data.avatar as string;
  }
  if(!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size>5_000_000) throw new Error("Choose a PNG, JPEG or WebP image smaller than 5 MB.");
  const bitmap=await createImageBitmap(file);
  try {
    const canvas=document.createElement("canvas");
    const context=canvas.getContext("2d");if(!context)throw new Error("Could not read this image.");
    let edge=512;
    while(edge>=64) {
      const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const source=canvas.toDataURL("image/png");
      if(source.length<340_000)return source;
      edge=Math.floor(edge*0.8);
    }
    throw new Error("This image is too large. Choose a smaller image.");
  } finally {bitmap.close();}
}
export function ProfilePanel({profile,onChange}: {profile:AccountProfile;onChange:(profile:AccountProfile)=>void}) {
  const [draft,setDraft]=useState(profile),[editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[uploading,setUploading]=useState(false);
  const [handleError,setHandleError]=useState("");
  const [imageToAdjust,setImageToAdjust]=useState<string|null>(null);
  const sharePath="/p/"+(profile.handle || profile.shareId);
  const [activity,setActivity]=useState<AccountUsage|null>(null),[activityError,setActivityError]=useState(""),[copied,setCopied]=useState(false);
  useEffect(()=>{if(!editing)setDraft(profile);},[profile,editing]);
  useEffect(()=>{
    const controller=new AbortController(),end=new Date().toISOString().slice(0,10);
    const start=new Date(Date.parse(end)-364*86400000).toISOString().slice(0,10);
    void fetch("/api/account-usage?"+new URLSearchParams({from:start,to:end}),{signal:controller.signal,cache:"no-store"}).then(async response=>{
      if(!response.ok)throw new Error("Could not load token activity.");setActivity((await response.json()).usage);
    }).catch(error=>{if(!controller.signal.aborted)setActivityError(error.message);});
    return ()=>controller.abort();
  },[]);
  async function save(value:AccountProfile) {
    setSaving(true);setHandleError("");
    try {
      const response=await fetch("/api/profile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        displayName:value.displayName,handle:value.handle,bio:value.bio,avatar:value.avatar,banner:value.banner ?? null,links:value.links,sharing:Boolean(value.shareId),shareActivity:value.shareActivity,
      })});
      const data=await response.json();
      if(!response.ok){if(data.field==="handle")setHandleError(data.error);throw new Error(data.error || "Could not save profile.");}
      onChange(data.profile);setDraft(data.profile);setEditing(false);toast.success("Profile saved");
    } catch(error){toast.error(error instanceof Error?error.message:"Could not save profile.");}
    finally{setSaving(false);}
  }
  async function copy() {
    try{await navigator.clipboard.writeText(new URL(sharePath,window.location.origin).href);setCopied(true);window.setTimeout(()=>setCopied(false),2000);}
    catch{toast.error("Copy the profile link from the field below.");}
  }
  return <div className="space-y-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Profile</h1><p className="mt-2 text-sm text-muted-foreground">A little about you, and what you build.</p></div>
      {!editing ? <Button variant="outline" className="h-11 gap-2" onClick={()=>{setDraft(profile);setHandleError("");setEditing(true);}}><Pencil className="size-4" /> Edit profile</Button>:null}
    </div>
    <BannerHeader value={editing ? draft.banner : profile.banner} alt="Profile banner" bannerClassName="aspect-[4/1] w-full rounded-xl" gapClassName="mt-8">
    <div className="grid items-start gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
      <div className="min-w-0">
        <ProfileAvatar profile={editing?draft:profile} name={profile.displayName} className="mb-5 size-24 text-3xl sm:size-28" />
        <h2 className="break-words text-xl font-semibold tracking-tight">{profile.displayName}</h2>
        {profile.handle?<p className="mt-1 break-all text-sm text-muted-foreground">@{profile.handle}</p>:null}
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{profile.bio || "Add a bio to make this profile yours."}</p>
        <div className="mt-5 space-y-2">{profile.links.map((link,index)=><a key={index} href={link.url} target="_blank" rel="noopener noreferrer" className="flex min-h-8 items-center gap-2 text-sm hover:underline"><Link2 className="size-3.5 shrink-0 text-muted-foreground"/><span className="truncate">{link.label}</span><ExternalLink className="ml-auto size-3 text-muted-foreground" /></a>)}</div>
      </div>
      <div className="min-w-0 space-y-6">
        {editing ? <form onSubmit={event=>{event.preventDefault();void save(draft);}} className="space-y-5 rounded-xl border border-border/60 p-5">
          <h2 className="text-base font-medium">Edit profile</h2>
          <div><p className="mb-1 text-sm">Profile banner</p><BannerUpload value={draft.banner} disabled={saving || uploading} uploadFile={uploadProfileBannerFile} onUploadingChange={setUploading} onChange={banner=>setDraft(value=>({...value,banner}))}/><p className="mt-1 text-xs text-muted-foreground">PNG, JPG, WebP or GIF up to 20 MB</p></div>
          <div><label htmlFor="profile-image" className="mb-2 block text-sm">Profile picture</label>
            <Input id="profile-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif,.gif" disabled={saving || uploading} className="h-11" onChange={event=>{
              const file=event.target.files?.[0];if(!file)return;
              setUploading(true);void avatarData(file).then(setImageToAdjust).catch(error=>toast.error(error.message)).finally(()=>setUploading(false));event.target.value="";
            }}/><p role="status" className="mt-2 text-xs text-muted-foreground">{uploading ? "Uploading picture…" : "Animated GIF up to 50 MB · PNG, JPEG or WebP up to 5 MB"}</p>
            {draft.avatar ? <div className="mt-2 flex flex-wrap gap-2"><Button variant="outline" type="button" className="min-h-11 gap-2" disabled={saving || uploading} onClick={()=>setImageToAdjust(draft.avatar)}><Crop className="size-4" aria-hidden="true"/>Adjust picture</Button><Button variant="ghost" type="button" className="min-h-11" disabled={saving || uploading} onClick={()=>setDraft({...draft,avatar:null})}>Remove picture</Button></div>:null}
            <ImageFramingDialog value={imageToAdjust} kind="profile" onClose={()=>setImageToAdjust(null)} onApply={avatar=>{setDraft(value=>({...value,avatar}));setImageToAdjust(null);}}/>
          </div>
          <label className="block space-y-2 text-sm">Name<Input aria-label="Profile name" value={draft.displayName} maxLength={80} required onChange={event=>setDraft({...draft,displayName:event.target.value})} className="h-11"/></label>
          <div className="space-y-2">
            <label htmlFor="profile-handle" className="text-sm">Handle</label>
            <Input id="profile-handle" aria-label="Profile handle" value={draft.handle || ""} maxLength={32} minLength={3} pattern="[A-Za-z0-9](?:[A-Za-z0-9_]|-){2,31}" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="your_handle" aria-invalid={Boolean(handleError)} aria-describedby="profile-handle-help" className="h-11" onChange={event=>{setDraft({...draft,handle:event.target.value});setHandleError("");}}/>
            <p id="profile-handle-help" className="break-words text-xs text-muted-foreground">{handleError || "3–32 letters, numbers, underscores or hyphens. Leave empty to use a generated link."}</p>
            {draft.handle?<p className="break-all text-xs text-muted-foreground">/p/{draft.handle.toLowerCase()}</p>:null}
          </div>
          <label className="block space-y-2 text-sm">Bio<Textarea aria-label="Profile bio" value={draft.bio} maxLength={500} rows={3} onChange={event=>setDraft({...draft,bio:event.target.value})}/></label>
          <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="text-sm">Links</h3><Button type="button" variant="ghost" className="h-11 gap-1" disabled={draft.links.length>=5} onClick={()=>setDraft({...draft,links:[...draft.links,{label:"",url:""}]})}><Plus className="size-4"/> Add link</Button></div>
            {draft.links.map((link,index)=><div key={index} className="grid grid-cols-[minmax(0,1fr)_44px] gap-2 sm:grid-cols-[130px_minmax(0,1fr)_44px]">
              <Input aria-label={"Link "+(index+1)+" label"} placeholder="Label" value={link.label} required maxLength={40} className="col-start-1 row-start-1 h-11 min-w-0" onChange={event=>setDraft({...draft,links:draft.links.map((value,i)=>i===index?{...value,label:event.target.value}:value)})}/>
              <Input aria-label={"Link "+(index+1)+" URL"} type="url" placeholder="https://…" value={link.url} required className="col-start-1 row-start-2 h-11 min-w-0 sm:col-start-2 sm:row-start-1" onChange={event=>setDraft({...draft,links:draft.links.map((value,i)=>i===index?{...value,url:event.target.value}:value)})}/>
              <Button type="button" variant="ghost" size="icon" aria-label={"Remove link "+(index+1)} className="col-start-2 row-start-1 size-11 sm:col-start-3" onClick={()=>setDraft({...draft,links:draft.links.filter((_,i)=>i!==index)})}><Trash2 className="size-4"/></Button>
            </div>)}
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" className="h-11" disabled={saving || uploading} onClick={()=>setEditing(false)}>Cancel</Button><Button className="h-11" type="submit" disabled={saving || uploading}>{saving?"Saving…":"Save profile"}</Button></div>
        </form>:null}
        {activity ? <TokenHeatmap days={activity.days} detailDays={activity.days}/> : <div className="rounded-xl border border-border/60 p-5 text-sm text-muted-foreground" role="status">{activityError || "Loading token activity…"}</div>}
        <section className="rounded-xl border border-border/60 p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium"><Share2 className="size-4"/> Share profile</h2>
          <div className="mt-4 flex items-center justify-between gap-4"><div><label htmlFor="profile-sharing" className="text-sm">Shareable link</label><p className="mt-1 text-xs text-muted-foreground">Anyone with the link can see your name, picture, banner, bio and links.</p></div>
            <Switch id="profile-sharing" checked={Boolean(profile.shareId)} disabled={saving || editing} onCheckedChange={sharing=>void save({...profile,shareId:sharing?"new":null})}/>
          </div>
          {profile.shareId ? <><div className="mt-4 flex items-center justify-between gap-4"><div><label htmlFor="profile-share-activity" className="text-sm">Include token activity</label><p className="mt-1 text-xs text-muted-foreground">Share the daily heatmap. Usage details and costs stay private.</p></div>
            <Switch id="profile-share-activity" checked={profile.shareActivity} disabled={saving || editing} onCheckedChange={shareActivity=>void save({...profile,shareActivity})}/>
          </div>
          <div className="mt-5 flex gap-2"><Input aria-label="Shared profile link" className="h-11 text-xs" readOnly value={typeof window!=="undefined"?new URL(sharePath,window.location.origin).href:sharePath}/>
            <Button className="size-11 shrink-0" variant="outline" size="icon" aria-label="Copy profile link" onClick={()=>void copy()}>{copied?<Check className="size-4"/>:<Copy className="size-4"/>}</Button>
          </div><p className="mt-2 text-xs text-muted-foreground">Turning sharing off revokes this link.</p></>:<p className="mt-4 text-xs text-muted-foreground">Your profile is private.</p>}
        </section>
      </div>
    </div>
    </BannerHeader>
  </div>;
}
