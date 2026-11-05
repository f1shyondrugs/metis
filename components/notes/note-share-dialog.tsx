"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { ShareLinkControls } from "@/components/share-link-controls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { noteDisplayTitle } from "@/lib/notes-tree";
import type { NoteShareLink } from "@/lib/note-share-types";

type SharePatch = { active?: boolean; password?: string | null };

export function NoteShareDialog({ note, onClose }: { note: { id: string; title: string }; onClose: () => void }) {
  const [share, setShare] = useState<NoteShareLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const endpoint = "/api/notes/" + encodeURIComponent(note.id) + "/share";
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setShare(null); setError("");
    void fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load sharing settings.");
        return body;
      })
      .then(body => { if (!controller.signal.aborted) setShare(body.share || null); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load sharing settings."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, retry]);

  async function change(method: "POST" | "PATCH", patch: SharePatch = {}) {
    if (working) return false;
    setWorking(true); setError("");
    try {
      const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = await response.json();
      if (!response.ok || !body.share) throw new Error(body.error || "Could not update sharing.");
      setShare(body.share);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update sharing.");
      return false;
    } finally { setWorking(false); }
  }
  const url = share ? new URL(share.url, typeof window !== "undefined" ? window.location.origin : "http://localhost").href : "";
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Share2 className="size-4 text-primary" />Share note</DialogTitle>
        <DialogDescription>Share “{noteDisplayTitle(note.title) || "Untitled"}” and all its subpages with a read-only link. Updates to this tree appear automatically.</DialogDescription>
      </DialogHeader>
      {loading ? <div role="status" className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading sharing settings…</div> : share ?
        <ShareLinkControls url={url} active={share.active} passwordProtected={share.passwordProtected} busy={working} onUpdate={patch => change("PATCH", patch)} /> :
        <Button disabled={working || Boolean(error)} onClick={() => void change("POST")}>{working ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}Create share link</Button>}
      {error ? <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Button variant="outline" size="sm" disabled={working} onClick={() => setRetry(value => value + 1)}>Retry</Button></div> : null}
    </DialogContent>
  </Dialog>;
}
