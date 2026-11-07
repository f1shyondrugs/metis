"use client";

import { useEffect, useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { Area } from "react-easy-crop";
const Cropper = dynamic(() => import("react-easy-crop"), { ssr: false, loading: () => <div role="status" className="p-4 text-sm">Loading crop controls…</div> });
import { Blend, Crop, Expand, Loader2, RectangleHorizontal, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FramedImage } from "@/components/framed-image";
import { BannerImage } from "@/components/banner-image";
import { parseImageFraming, validImageCrop, withImageFraming, withBannerStyle, type BannerStyle } from "@/lib/image-framing";

export function ImageFramingDialog({ value, kind, onApply, onClose, busy = false, error }: {
  value: string | null; kind: "banner" | "profile"; onApply: (value: string) => void; onClose: () => void; busy?: boolean; error?: string;
}) {
  return <Dialog open={Boolean(value)} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl data-[state=open]:animate-none data-[state=closed]:animate-none">
      <DialogHeader><DialogTitle>{kind === "profile" ? "Adjust profile picture" : "Adjust banner"}</DialogTitle>
        <DialogDescription>Show the whole image, or drag and zoom to choose a crop.</DialogDescription></DialogHeader>
      {value && <ImageFramingEditor key={value} value={value} kind={kind} onApply={onApply} onClose={onClose} busy={busy} externalError={error}/>}
    </DialogContent>
  </Dialog>;
}

function ImageFramingEditor({ value, kind, onApply, onClose, busy, externalError }: {
  value: string; kind: "banner" | "profile"; onApply: (value: string) => void; onClose: () => void; busy: boolean; externalError?: string;
}) {
  const parsed = useMemo(() => parseImageFraming(value), [value]);
  const initialArea = parsed.framing?.mode === "crop" ? parsed.framing.area : undefined;
  const [mode, setMode] = useState<"fit" | "crop">(parsed.framing?.mode || "crop");
  const [style, setStyle] = useState<BannerStyle>(parsed.framing?.bannerStyle || "standard");
  const [area, setArea] = useState<Area | undefined>(initialArea);
  const [restoreArea, setRestoreArea] = useState<Area | undefined>(initialArea);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const id = useId();
  useEffect(() => {
    let disposed = false;
    const image = new window.Image();
    image.onload = () => { if (!disposed) { setLoaded(true); setError(false); } };
    image.onerror = () => { if (!disposed) setError(true); };
    image.src = parsed.source;
    return () => { disposed = true; image.onload = null; image.onerror = null; image.src = ""; };
  }, [parsed.source, retry]);
  const metadata = kind === "banner" && style === "fade" ? { bannerStyle: "fade" as const } : {};
  const fitValue = withImageFraming(parsed.source, { mode: "fit", ...metadata });
  return <>
    <div className="grid grid-cols-2 gap-2" aria-label="Image display mode">
      {([{ mode: "fit", label: "Whole image", Icon: Expand }, { mode: "crop", label: "Crop", Icon: Crop }] as const).map(item =>
        <Button key={item.mode} type="button" variant={mode === item.mode ? "secondary" : "outline"} aria-pressed={mode === item.mode}
          className="min-h-11 gap-2" disabled={busy} onClick={() => { if (mode === "crop") setRestoreArea(area); setMode(item.mode); }}><item.Icon className="size-4" aria-hidden="true"/>{item.label}</Button>)}
    </div>
    <div className="relative h-64 overflow-hidden rounded-lg bg-muted sm:h-72" aria-label="Image preview" aria-busy={!loaded && !error}>
      {error ? <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm">
        <p>Could not load this image.</p><Button variant="outline" onClick={() => { setError(false); setLoaded(false); setRetry(n => n + 1); }}><RefreshCw className="size-4" aria-hidden="true"/>Retry</Button>
      </div> : !loaded ? <div role="status" className="flex h-full items-center justify-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" aria-hidden="true"/>Loading image…</div> :
      mode === "fit" ? <div className="flex h-full items-center justify-center p-4">{kind === "banner" ? <BannerImage src={fitValue} alt="Whole image preview" className="aspect-[4/1] w-full"/> : <FramedImage src={fitValue} alt="Whole image preview" circle className="size-48 ring-1 ring-border sm:size-56"/>}</div> :
      <Cropper image={parsed.source} crop={crop} zoom={zoom} aspect={kind === "profile" ? 1 : 4} cropShape={kind === "profile" ? "round" : "rect"}
        minZoom={1} maxZoom={4} rotation={0} zoomSpeed={1} style={{}} classes={{}} mediaProps={{}} restrictPosition={true} keyboardStep={10} onCropChange={setCrop} onZoomChange={setZoom} onCropAreaChange={setArea}
        initialCroppedAreaPercentages={restoreArea} zoomWithScroll={false}
        cropperProps={{ "aria-label": "Drag image to position crop. Use arrow keys to move." }} />}
    </div>
    {mode === "crop" && <label htmlFor={id} className="flex min-h-11 items-center gap-3 text-sm">Zoom
      <input id={id} type="range" aria-label="Image zoom" min={1} max={4} step={0.01} value={zoom} disabled={busy || !loaded || error}
        className="h-11 min-w-0 flex-1 accent-primary" onChange={event => setZoom(Number(event.target.value))}/>
      <output htmlFor={id} className="w-12 text-right tabular-nums">{Math.round(zoom * 100)}%</output></label>}
    {kind === "banner" && <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">Banner style</legend>
      <div className="grid grid-cols-2 gap-2">{([
        { value: "standard", label: "Flat", Icon: RectangleHorizontal },
        { value: "fade", label: "Fade", Icon: Blend },
      ] as const).map(item =>
        <Button key={item.value} type="button" aria-pressed={style === item.value} variant={style === item.value ? "secondary" : "outline"}
          disabled={busy} className="min-h-11 gap-2" onClick={() => setStyle(item.value)}><item.Icon className="size-4" aria-hidden="true"/>{item.label}</Button>)}</div>
      <p className="text-xs text-muted-foreground">{style === "fade" ? "Fades from fully visible at the top to transparent at the bottom." : "A separate banner with a defined bottom edge."}</p>
    </fieldset>}
    {kind === "banner" && mode === "crop" && area && validImageCrop(area) && <BannerImage
      src={withBannerStyle(withImageFraming(parsed.source, { mode: "crop", area }), style)}
      alt="Banner style preview" className="aspect-[4/1] w-full rounded-lg"/>}
    <p className="text-xs leading-relaxed text-muted-foreground">{mode === "fit" ? "The entire image stays visible. Empty space is kept around it when needed." : "Drag the image or use arrow keys. Your original stays available for later adjustments."}</p>
    {externalError && <p role="alert" className="text-sm text-destructive">{externalError}</p>}
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button type="button" disabled={busy || !loaded || error || mode === "crop" && (!area || !validImageCrop(area))}
        onClick={() => onApply(withImageFraming(parsed.source, mode === "fit" ? { mode: "fit", ...metadata } : { mode: "crop", area: area!, ...metadata }))}>{busy ? "Uploading…" : "Apply"}</Button></DialogFooter>
  </>;
}
