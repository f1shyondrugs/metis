"use client";

import { useEffect, useRef, useState } from "react";
import { Crop, ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { ImageFramingDialog } from "@/components/image-framing-dialog";
import { parseImageFraming, withImageFraming } from "@/lib/image-framing";
import { Button } from "@/components/ui/button";
import { MAX_INLINE_IMAGE_BYTES } from "@/lib/upload-limits";

const BANNER_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export function BannerUpload({ value, onChange, uploadFile, disabled = false, onUploadingChange }: {
  value: string | null | undefined; onChange: (cover: string | null) => void;
  uploadFile: (file: File, signal: AbortSignal) => Promise<string>; disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<{ url: string; file?: File } | null>(null);
  useEffect(() => () => { if (selection?.file) URL.revokeObjectURL(selection.url); }, [selection]);
  useEffect(() => () => { request.current?.abort(); }, []);
  async function upload(file: File, framedValue: string) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setUploading(true); onUploadingChange?.(true); setError("");
    try {
      const cover = await uploadFile(file, controller.signal);
      if (!controller.signal.aborted) { onChange(withImageFraming(cover, parseImageFraming(framedValue).framing)); setSelection(null); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not upload the banner.");
    } finally {
      if (!controller.signal.aborted) { request.current = null; setUploading(false); onUploadingChange?.(false); }
    }
  }
  return <div className="min-w-0">
    <div className="flex flex-wrap items-center gap-1">
      <Button type="button" variant="ghost" disabled={disabled || uploading} className="h-11 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        aria-label={value ? "Change banner" : "Add banner"} onClick={() => input.current?.click()}>
        {uploading ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : value ? <ImagePlus aria-hidden="true" className="size-3.5" /> : <Plus aria-hidden="true" className="size-3.5" />}
        {uploading ? <span role="status">Uploading…</span> : value ? "Change banner" : "Banner"}
      </Button>
      {value && <Button type="button" variant="ghost" disabled={disabled || uploading} className="h-11 gap-1.5 px-2 text-xs text-muted-foreground" aria-label="Adjust banner" onClick={() => { setError(""); setSelection({ url: value }); }}><Crop aria-hidden="true" className="size-3.5"/>Adjust</Button>}
      {value && <Button type="button" variant="ghost" disabled={disabled || uploading} className="size-11 text-muted-foreground" aria-label="Remove banner" title="Remove banner" onClick={() => { setError(""); onChange(null); }}><Trash2 aria-hidden="true" className="size-3.5" /></Button>}
    </div>
    <input ref={input} type="file" accept={BANNER_ACCEPT} disabled={disabled || uploading} hidden aria-label="Upload banner image"
      onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        if (!BANNER_ACCEPT.split(",").includes(file.type) || !file.size || file.size > MAX_INLINE_IMAGE_BYTES) { setError("Choose a PNG, JPG, WebP or GIF image smaller than 20 MB."); return; }
        setError(""); setSelection({ url: URL.createObjectURL(file), file });
      }} />
    <ImageFramingDialog value={selection?.url || null} kind="banner" busy={uploading} error={error} onClose={() => { if (!uploading) setSelection(null); }} onApply={framed => {
      if (uploading) return;
      if (selection?.file) void upload(selection.file, framed); else { onChange(framed); setSelection(null); }
    }}/>
    {error && <p role="alert" className="max-w-72 pb-2 text-xs text-destructive">{error}</p>}
  </div>;
}
