"use client";
import { useEffect, useRef, useState } from "react";
import { Download, File, Maximize, Pencil, X } from "lucide-react";
import { flushSync } from "react-dom";
import { ImageSurface, ImageViewer, type ImageViewerHandle } from "@/components/image-viewer";
import { fileDownloadUrl, fileViewKind, type FileEmbedSpec } from "@/lib/file-types";
import { formatFileBytes } from "@/lib/upload-limits";
import { readTextFilePreview } from "@/lib/text-file-preview";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FileWorkspaceActions } from "@/components/file-workspace-actions";
import { EditableMarkdown } from "@/components/editable-markdown";
import { isMarkdownFile } from "@/lib/markdown-file";

export function FileEmbed({ file, onChange, onRemove, className = "", resizable = true, previewOnly = false }: {
  file:FileEmbedSpec; onChange?:(file:FileEmbedSpec)=>void; onRemove?:()=>void; className?:string; resizable?:boolean; previewOnly?:boolean;
}) {
  const markdownFile = isMarkdownFile(file.name, file.mimeType);
  const kind = markdownFile ? "text" : fileViewKind(file.mimeType,file.name);
  const [text,setText] = useState<string|null>(file.text ?? null);
  const [error,setError] = useState("");
  const [editing,setEditing] = useState(false);
  const [draft,setDraft] = useState("");
  const [removing,setRemoving] = useState(false);
  const [imageFullscreen,setImageFullscreen] = useState(false);
  const imageViewerRef = useRef<ImageViewerHandle>(null);
  const movedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const officeUrl = kind === "office" ? ((file.url.startsWith("/api/share/attachment?") || /^\/api\/shared-notes\/[A-Za-z0-9_-]{43}\/assets\?/.test(file.url)) ? file.url + "&preview=1" : file.url.split("?")[0] + "/preview") : file.url;
  useEffect(() => {
    setError(""); setText(file.text ?? null);
    if (file.text !== undefined || (kind !== "text" && kind !== "office")) return;
    const controller = new AbortController();
    fetch(officeUrl,{signal:controller.signal}).then(async response => {
      if (!response.ok) throw new Error("Preview unavailable. Download the original file.");
      return readTextFilePreview(response,previewOnly ? 8_001 : 80_001);
    }).then(value=>setText(value)).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return () => controller.abort();
  },[file.url,file.text,kind,officeUrl,previewOnly]);
  const canEdit = Boolean(onChange && kind === "text" && text !== null && text.length <= 80_000 && !error);
  const save = () => { if(JSON.stringify({...file,text:draft}).length > 45_000) {setError("Edited content is too large for this embedding. Keep it below 45 KB, including formatting.");return;} if(onChange)onChange({...file,text:draft}); setEditing(false); };
  return <div ref={rootRef} className={"relative flex min-h-0 min-w-0 flex-col overflow-hidden text-foreground " + className}
    data-file-embed={kind} onPointerDown={e=>e.stopPropagation()}
    style={file.height ? {height:file.height,width:file.width || undefined,maxWidth:"100%"}:undefined}>
    {onRemove && <button type="button" aria-label={"Remove " + file.name} title="Remove file"
      className="absolute right-2 top-2 z-20 flex size-7 items-center justify-center rounded bg-background/90 text-foreground hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-2 focus-visible:outline-ring"
      onClick={()=>setRemoving(true)}><X className="size-4" aria-hidden="true"/></button>}
    <div className="min-h-0 flex-1 overflow-auto" style={{minHeight:kind === "audio" ? 60:120}}>
      {kind === "image" ?
        <div inert={previewOnly || undefined} className="h-full max-h-[70dvh] min-h-32"><ImageSurface key={file.url} src={file.url} alt={file.name} loading="lazy"/></div>
        : kind === "video" ? <video src={file.url} controls={!previewOnly} playsInline preload="metadata" aria-label={file.name} className="h-full max-h-[70vh] w-full object-contain" onError={()=>setError("This video format cannot be played by your browser. Download the original file.")}/>
        : kind === "audio" ? <audio src={file.url} controls={!previewOnly} preload="metadata" aria-label={file.name} className="w-full px-2 py-4" onError={()=>setError("This audio format cannot be played by your browser. Download the original file.")}/>
        : kind === "pdf" ? <iframe src={file.url} title={file.name} tabIndex={previewOnly ? -1 : undefined} className="h-full min-h-64 w-full border-0" />
        : kind === "text" || kind === "office" ? editing ?
          <div className="flex h-full min-h-52 flex-col gap-2 bg-background p-2 text-foreground">
            {markdownFile ? <EditableMarkdown editorId={`attachment:${file.url}`} aria-label={"Edit " + file.name} value={draft} onChange={setDraft} maxLength={80_000} autoFocus hideAttachmentButton className="min-h-32 flex-1 rounded border border-border p-2" /> : <textarea aria-label={"Edit " + file.name} value={draft} maxLength={80_000} spellCheck={false} onChange={e=>setDraft(e.target.value)} className="min-h-32 w-full flex-1 resize-none rounded border border-border bg-background p-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring"/>}
            <div className="flex gap-2"><button type="button" onClick={save} className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring">Save changes</button><button type="button" onClick={()=>setEditing(false)} className="rounded px-2 py-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">Cancel</button></div>
          </div>
          : <pre className="m-0 h-full min-h-32 overflow-auto whitespace-pre bg-background p-3 pr-10 font-mono text-xs text-foreground"><code>{text === null && !error ? "Loading preview…" : text || ""}</code></pre>
        : <div className="flex min-h-32 flex-col items-center justify-center gap-2 p-4"><File className="size-8 text-muted-foreground" aria-hidden="true"/><p className="max-w-full truncate text-xs">{file.name}</p><p className="text-xs text-muted-foreground">Preview unavailable for this file type. Download to open it.</p></div>}
      {error && <p role="alert" className="p-3 text-xs text-destructive">{error}</p>}
    </div>
    {!previewOnly && <div className="flex shrink-0 items-center gap-2 border-t border-border/40 bg-background/80 px-2 py-1.5 text-xs">
      <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}{file.size === undefined ? "" : " · " + formatFileBytes(file.size)}</span>
      {canEdit && !editing && <button type="button" aria-label={"Edit " + file.name} className="flex size-7 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" onClick={()=>{setDraft(text!);setEditing(true);}}><Pencil className="size-3.5" aria-hidden="true"/></button>}
      <FileWorkspaceActions file={file} />
      <a href={fileDownloadUrl(file.url)} download={file.name} aria-label={"Download " + file.name} className="flex size-7 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><Download className="size-3.5" aria-hidden="true"/></a>
      {kind === "image" && <button type="button" aria-label={"Fullscreen " + file.name} title="Fullscreen"
        className="flex size-7 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        onClick={()=>{flushSync(()=>setImageFullscreen(true));imageViewerRef.current?.enterFullscreen();}}><Maximize className="size-3.5" aria-hidden="true"/></button>}
      {onChange && resizable && <button type="button" aria-label="Resize embedded file" title="Resize embedded file" className="size-7 shrink-0 cursor-nwse-resize rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        onClick={()=>{ if(movedRef.current)return; onChange({...file,height:Math.min(1200,(file.height || rootRef.current?.clientHeight || 240)+80)});}}
        onPointerDown={e=>{
          e.preventDefault(); e.stopPropagation(); const node=e.currentTarget; node.setPointerCapture(e.pointerId);
          const y=e.clientY,x=e.clientX,h=rootRef.current?.clientHeight || 240,w=rootRef.current?.clientWidth || 320; movedRef.current=false;
          const move=(next:PointerEvent)=>{movedRef.current=Math.abs(next.clientX-x)+Math.abs(next.clientY-y)>3;if(rootRef.current) {rootRef.current.style.height=Math.max(120,Math.min(1200,h+next.clientY-y))+"px";rootRef.current.style.width=Math.max(160,Math.min(1600,w+next.clientX-x))+"px";}};
          const up=(next:PointerEvent)=>{node.removeEventListener("pointermove",move);node.removeEventListener("pointerup",up);node.removeEventListener("pointercancel",up);if(movedRef.current)onChange({...file,height:Math.max(120,Math.min(1200,h+next.clientY-y)),width:Math.max(160,Math.min(1600,w+next.clientX-x))});};
          node.addEventListener("pointermove",move);node.addEventListener("pointerup",up);node.addEventListener("pointercancel",up);
        }}>↘</button>}
    </div>}
    {imageFullscreen && <ImageViewer ref={imageViewerRef} image={{src:file.url,alt:file.name,name:file.name}} initialFullscreen onOpenChange={open=>setImageFullscreen(open)}/>}
    <ConfirmDialog open={removing} onOpenChange={setRemoving} title="Remove file?" description="Remove this embedding. The original uploaded file is kept." confirmLabel="Remove" onConfirm={()=>onRemove?.()}/>
  </div>;
}
