import {closeSync,fstatSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import {openSafeRead,readSafeFile} from "@/lib/safe-file-read";
function stripXml(value: string) {
  return value
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/(?:t|v)>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unzipText(filePath: string, entries: string[]) {
  return entries
    .map((entry) => {
      try {
        return execFileSync("unzip", ["-p", filePath, entry], {
          encoding: "utf8",
          maxBuffer: 2 * 1024 * 1024,
          timeout: 5000,
        });
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .map(stripXml)
    .filter(Boolean)
    .join("\n\n");
}

export function officePreview(filePath: string, mimeType: string) {
  const fd=openSafeRead(filePath);let temporary:string|undefined;
  try{
    if(fstatSync(fd).size>20*1024*1024)throw Error("Preview too large");
    temporary=mkdtempSync(path.join(os.tmpdir(),"metis-office-"));const snapshot=path.join(temporary,"document.zip");
    writeFileSync(snapshot,readSafeFile(filePath,20*1024*1024),{mode:0o600});return previewSnapshot(snapshot,mimeType);
  }finally{closeSync(fd);if(temporary)rmSync(temporary,{recursive:true,force:true});}
}
function previewSnapshot(filePath:string,mimeType:string){
  if (mimeType.includes("wordprocessingml")) {
    return unzipText(filePath, [
      "word/document.xml",
      "word/header1.xml",
      "word/footer1.xml",
    ]);
  }
  if (mimeType.includes("spreadsheetml")) {
    return unzipText(filePath, [
      "xl/sharedStrings.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
  }
  if (mimeType.includes("presentationml")) {
    return unzipText(filePath, [
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml",
      "ppt/slides/slide3.xml",
    ]);
  }
  return "";
}

export function officePreviewResponse(file: string, mime: string) {
  let preview:string;try{preview=officePreview(file,mime);}catch(error){return Response.json({error:"Preview unavailable"},{status:error instanceof Error&&error.message==="Preview too large"?413:404});}
  if(!preview)return Response.json({error:"Preview unavailable. Download to open."},{status:415});
  return new Response(preview,{headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"private, max-age=0"}});
}
