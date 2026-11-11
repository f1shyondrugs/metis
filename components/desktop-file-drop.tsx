"use client";
import { useEffect } from "react";
import { mimeTypeFromFileName } from "@/lib/file-types";
import { desktopBridge } from "@/lib/desktop-bridge";

// Native Windows compatibility drops enter the SAME DOM pipeline as ordinary
// browser drops. The target under the pointer retains ownership (chat/note/etc).
export function DesktopFileDrop() {
  useEffect(()=>{
    const bridge=desktopBridge();
    return bridge?.onFilesDropped?.(payload=>{
      if(!payload?.files?.length||payload.files.length>10||!Number.isFinite(payload.point?.x)||!Number.isFinite(payload.point?.y))return;
      const target=document.elementFromPoint(payload.point.x,payload.point.y);
      if(!target)return;
      const transfer=new DataTransfer();
      let total=0;
      for(const item of payload.files){
        if(typeof item.name!=="string"||!(item.bytes instanceof Uint8Array)||item.bytes.byteLength>64*1024*1024-total)return;
        total+=item.bytes.byteLength;
        transfer.items.add(new File([new Uint8Array(item.bytes)],item.name,{lastModified:item.lastModified,type:mimeTypeFromFileName(item.name)}));
      }
      target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:payload.point.x,clientY:payload.point.y}));
    });
  },[]);
  return null;
}
