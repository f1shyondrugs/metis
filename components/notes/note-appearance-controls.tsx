"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NOTE_BANNER_ACCEPT, uploadNoteBanner } from "@/lib/note-banner-upload";
export { NoteIconPicker } from "./note-icon-picker";

export function NoteBannerUpload({ noteId, value, onChange }: {
  noteId: string; value: string | null | undefined; onChange: (cover: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { request.current?.abort(); }, [noteId]);
  async function upload(file: File) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setUploading(true); setError("");
    try {
      const cover = await uploadNoteBanner(noteId, file, controller.signal);
      if (!controller.signal.aborted) onChange(cover);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not upload the banner.");
    } finally {
      if (!controller.signal.aborted) { request.current = null; setUploading(false); }
    }
  }
  return <div className="min-w-0">
    <div className="flex flex-wrap items-center gap-1">
      <Button type="button" variant="ghost" disabled={uploading} className="h-11 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        aria-label={value ? "Change banner" : "Add banner"} onClick={() => input.current?.click()}>
        {uploading ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : value ? <ImagePlus aria-hidden="true" className="size-3.5" /> : <Plus aria-hidden="true" className="size-3.5" />}
        {uploading ? <span role="status">Uploading…</span> : value ? "Change banner" : "Banner"}
      </Button>
      {value && <Button type="button" variant="ghost" disabled={uploading} className="size-11 text-muted-foreground" aria-label="Remove banner" title="Remove banner" onClick={() => { setError(""); onChange(null); }}><Trash2 aria-hidden="true" className="size-3.5" /></Button>}
    </div>
    <input ref={input} type="file" accept={NOTE_BANNER_ACCEPT} hidden aria-label="Upload banner image"
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
    {error && <p role="alert" className="max-w-72 pb-2 text-xs text-destructive">{error}</p>}
  </div>;
}
