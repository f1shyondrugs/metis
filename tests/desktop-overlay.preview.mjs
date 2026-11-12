// Isolated synthetic fixture. No production services or account data.
import fs from "node:fs";
import http from "node:http";
import {createRequire} from "node:module";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve("tsx"))("esbuild");
const directory=process.env.OVERLAY_FIXTURE_DIR || "data/artifacts/desktop-annotations-20261111/overlay-fixture";
const entry=process.env.OVERLAY_FIXTURE_ENTRY || "tests/desktop-overlay.browser.tsx";
const port=Number(process.env.OVERLAY_FIXTURE_PORT || 3257);
fs.mkdirSync(directory,{recursive:true});
await build({entryPoints:[entry],outdir:directory,entryNames:"app",bundle:true,platform:"browser",format:"esm",splitting:true,jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},loader:{".woff2":"dataurl",".woff":"dataurl",".ttf":"dataurl"}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:"app/globals.css"});
fs.writeFileSync(directory+"/theme.css",css.css);
fs.writeFileSync(directory+"/index.html",'<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overlay fixture</title><link rel="stylesheet" href="/theme.css"><body><script type="module" src="/app.js"></script></body></html>');
// Valid one-page synthetic PDF, with a visible red panel and text. Exact production headers below.
const stream="q 0.9 0.12 0.1 rg 20 20 260 120 re f Q\nBT /F1 22 Tf 28 160 Td (OVERLAY PDF PROOF) Tj ET\n";
const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Length "+Buffer.byteLength(stream)+" >>\nstream\n"+stream+"endstream"];
let pdf="%PDF-1.4\n",offsets=[0];
objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+" 0 obj\n"+o+"\nendobj\n";});
const xref=Buffer.byteLength(pdf);
pdf+="xref\n0 6\n0000000000 65535 f \n"+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF\n";
const pdfBuffer=Buffer.from(pdf);
// Raster test asset generated without adding any dependency.
const {deflateSync}=await import("node:zlib");
function crc32(data){let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,crc]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(600);ihdr.writeUInt32BE(200,4);ihdr[8]=8;ihdr[9]=2;
const pixels=Buffer.alloc(200*(600*3+1));for(let y=0;y<200;y++)for(let x=0;x<600;x++){const p=y*1801+1+x*3;pixels[p]=x<200?240:20;pixels[p+1]=x>=200&&x<400?210:30;pixels[p+2]=x>=400?240:30;}
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(pixels)),chunk("IEND",Buffer.alloc(0))]);
console.log("OVERLAY_FIXTURE_BUILT");
if(!process.argv.includes("--build-only")){
const server=http.createServer((request,response)=>{
 const url=new URL(request.url,"http://localhost");
 if(url.pathname==="/report"&&request.method==="POST"){let data="";request.on("data",part=>data+=part);request.on("end",()=>{const report=JSON.parse(data);fs.writeFileSync(directory+"/result-"+report.width+".json",JSON.stringify(report,null,2));console.log("BROWSER_RESULT "+report.width+" "+report.results.filter(x=>x.startsWith("FAIL")).length+" failures");response.end("saved");});return;}
 if(url.pathname==="/api/file-uploads/11111111-1111-4111-8111-111111111111/file"||url.pathname==="/api/uploads/fixture/colors.png"){
 const isPdf=url.pathname.includes("file-uploads"),body=isPdf?pdfBuffer:png;
 response.writeHead(200,{"Content-Type":isPdf?"application/pdf":"image/png","Content-Length":body.length,"Content-Disposition":"inline","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox","Cache-Control":"no-store"});response.end(body);return;}
 if(url.pathname==="/api/desktop-overlay/pdf-worker"){response.writeHead(200,{"Content-Type":"text/javascript","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; script-src 'self'; connect-src 'none'"});response.end(fs.readFileSync("node_modules/pdfjs-dist/build/pdf.worker.mjs"));return;}
 const file=url.pathname==="/"?"index.html":url.pathname.slice(1);
 if(!["index.html","app.js","theme.css"].includes(file)&&!(/^[a-zA-Z0-9_-]+\.js$/.test(file)&&fs.existsSync(directory+"/"+file))){response.writeHead(404).end();return;}
 response.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");response.setHeader("Cache-Control","no-store");response.end(fs.readFileSync(directory+"/"+file));
});
server.listen(port,"127.0.0.1",()=>console.log("OVERLAY_FIXTURE_READY pid="+process.pid+" http://127.0.0.1:"+port));
process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
}
