"use client";
import { useEffect, useState } from "react";
import { Copy, Link2, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PublicShareUrlHint, usePublicBaseUrl } from "@/components/public-base-url";
export function SkillShareControls({ id }: { id: string }) {
  const publicBaseUrl = usePublicBaseUrl();
  const [url,setUrl] = useState(""); const [active,setActive] = useState(false);
  const [busy,setBusy] = useState(false); const [error,setError] = useState("");
  const endpoint = "/api/skills/" + encodeURIComponent(id) + "/share";
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint,{ signal:controller.signal, cache:"no-store" }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (!controller.signal.aborted) { setUrl(body.url || ""); setActive(Boolean(body.token)); }
    }).catch(e => {if (!controller.signal.aborted) setError(e.message);});
    return () => controller.abort();
  },[endpoint]);
  async function change(method: "POST" | "DELETE") {
    setBusy(true);setError("");
    try {
      const response = await fetch(endpoint,{method});
      const body = await response.json();if (!response.ok) throw new Error(body.error || "Could not update share link.");
      setUrl(body.url || ""); setActive(Boolean(body.token));
      toast.success(method === "POST" ? (body.url ? "Share link created" : "Sharing enabled") : "Share link revoked");
    } catch(e) {setError(e instanceof Error ? e.message : "Could not update share link.");}
    finally {setBusy(false);}
  }
  return <section aria-label="Share skill" className="mb-6 space-y-3 border-t border-border pt-5">
    <h4 className="text-sm font-medium">Share skill</h4>
    <p className="text-xs leading-5 text-muted-foreground">Anyone with the link can preview this skill and its files, then import their own copy. Later edits do not change that copy.</p>
    {publicBaseUrl.state !== "configured" ? <PublicShareUrlHint /> : null}
    {url ? <div className="flex flex-wrap gap-2"><Input aria-label="Skill share link" readOnly value={url} className="min-w-0 flex-1 basis-48" onFocus={e=>e.currentTarget.select()} /><Button variant="outline" disabled={busy} onClick={async()=>{try{await navigator.clipboard.writeText(url);toast.success("Link copied");}catch{setError("Select the link and copy it manually.");}}}><Copy />Copy link</Button></div> : null}
    {active ? <Button variant="ghost" disabled={busy} onClick={()=>void change("DELETE")}>Revoke link</Button> :
    <Button variant="outline" disabled={busy} onClick={()=>void change("POST")}>{busy ? <LoaderCircle className="animate-spin" /> : <Link2 />}Create share link</Button>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </section>;
}
