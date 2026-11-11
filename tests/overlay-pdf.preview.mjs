import fs from "node:fs";
import http from "node:http";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve("tsx"))("esbuild");
const directory="data/artifacts/desktop-annotations-20261111";
fs.mkdirSync(directory,{recursive:true});
await build({entryPoints:["tests/overlay-pdf.browser.tsx"],outdir:directory,entryNames:"pdf-app",bundle:true,platform:"browser",format:"esm",splitting:true,jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'}});
const stream="q 0.9 0.12 0.1 rg 20 20 260 120 re f Q\nBT /F1 22 Tf 28 160 Td (OVERLAY PDF PROOF) Tj ET\n";
const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Length "+Buffer.byteLength(stream)+" >>\nstream\n"+stream+"endstream","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"];
let pdf="%PDF-1.4\n",offsets=[0];
objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+" 0 obj\n"+o+"\nendobj\n";});
const xref=Buffer.byteLength(pdf);
pdf+="xref\n0 7\n0000000000 65535 f \n"+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF\n";
let retries=0;
const worker=fs.readFileSync("node_modules/pdfjs-dist/build/pdf.worker.mjs");
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,"http://localhost");
 if(url.pathname==="/report"&&req.method==="POST"){let data="";req.on("data",x=>data+=x);req.on("end",()=>{const report=JSON.parse(data);fs.writeFileSync(directory+"/pdf-result-"+report.width+".json",JSON.stringify(report,null,2));res.end("saved");});return;}
 if(url.pathname.startsWith("/api/file-uploads/")||url.pathname==="/api/uploads/fixture/retry.pdf"){
 if(!req.headers.cookie?.includes("pdf_fixture=authorized")){res.writeHead(401).end();return;} if(url.pathname.includes("retry")&&retries++%2===0){res.writeHead(503).end();return;}
 res.writeHead(200,{"Content-Type":"application/pdf","Content-Length":Buffer.byteLength(pdf),"Content-Security-Policy":"sandbox","X-Content-Type-Options":"nosniff","Cache-Control":"no-store"});res.end(pdf);return;}
 if(url.pathname==="/api/desktop-overlay/pdf-worker"){res.writeHead(200,{"Content-Type":"text/javascript","Content-Security-Policy":"default-src 'none'; script-src 'self'; connect-src 'none'","X-Content-Type-Options":"nosniff"});res.end(worker);return;}
 if(url.pathname==="/"){res.writeHead(200,{"Content-Type":"text/html","Set-Cookie":"pdf_fixture=authorized; HttpOnly; SameSite=Strict; Path=/","Content-Security-Policy":"default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'unsafe-inline'"});res.end('<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic PDF proof</title><body style="margin:8px;background:#18181b;color:white;font:14px system-ui"><script type="module" src="/pdf-app.js"></script></body></html>');return;}
 const name=url.pathname.slice(1);
 if(!/^[a-zA-Z0-9_-]+\.js$/.test(name)||!fs.existsSync(directory+"/"+name)){res.writeHead(404).end();return;}
 res.writeHead(200,{"Content-Type":"text/javascript"});res.end(fs.readFileSync(directory+"/"+name));
});
server.listen(3258,"127.0.0.1",()=>console.log("PDF_FIXTURE_READY pid="+process.pid));
process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
