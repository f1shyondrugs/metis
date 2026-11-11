"use client";
import type { CSSProperties } from "react";
import { OverlayPdfPreview } from "@/components/overlay-pdf-preview";
import { FileEmbed } from "@/components/file-embed";
import { ImageSurface } from "@/components/image-viewer";
import { fileViewKind, type FileEmbedSpec } from "@/lib/file-types";

// URL shape is an additional renderer boundary; authorization remains on the endpoint.
export function isOverlayResourceUrl(url: string) {
  if (/^\/api\/file-uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/file$/.test(url)) return true;
  const match=/^\/api\/uploads\/([A-Za-z0-9_-]+)\/([^/?#\\\s]+)$/.exec(url);
  if(!match)return false;
  try {
    const name=decodeURIComponent(match[2]);
    return name!=="."&&name!==".."&&!/[/\\\u0000-\u001f\u007f]/.test(name);
  } catch { return false; }
}
type ImagePlacement = {imageFit?: "contain"|"cover";imagePosition?: {x:number;y:number}};

export function OverlayFilePreview({file,content}:{file:FileEmbedSpec;content:ImagePlacement}) {
  const kind=fileViewKind(file.mimeType,file.name);
  if(!isOverlayResourceUrl(file.url))return <p role="alert">File preview requires a trusted attachment URL.</p>;
  if(kind==="binary")return <p>Preview unavailable for {file.name}. This file is not executed.</p>;
  const coordinate=(value:unknown)=>typeof value==="number" && Number.isFinite(value)?Math.min(100,Math.max(0,value)):50;
  const position=coordinate(content.imagePosition?.x)+"% "+coordinate(content.imagePosition?.y)+"%";
  if(kind==="image")return <div data-overlay-file="" data-overlay-image="" style={{height:"100%",overflow:"hidden","--overlay-image-fit":content.imageFit==="cover"?"cover":"contain","--overlay-image-position":position} as CSSProperties}>
    <style>{'[data-overlay-image] [data-image-surface]>img{object-fit:var(--overlay-image-fit);object-position:var(--overlay-image-position);cursor:default!important}'}</style>
    <div inert style={{height:"100%"}}><ImageSurface key={file.url} src={file.url} alt={file.name}/></div>
  </div>;
  if(kind==="pdf")return <OverlayPdfPreview key={file.url} file={file}/>;
  return <FileEmbed key={file.url} file={{...file,width:undefined,height:undefined}} previewOnly resizable={false}/>;
}
