import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {GET} from "../app/api/desktop-overlay/pdf-worker/route";
test("PDF worker endpoint serves only the pinned local library with offline worker policy",async()=>{
 const response=await GET();
 assert.equal(response.status,200);assert.match(response.headers.get("content-type")||"",/javascript/);
 assert.equal(response.headers.get("x-content-type-options"),"nosniff");
 assert.equal(response.headers.get("cross-origin-resource-policy"),"same-origin");
 assert.match(response.headers.get("content-security-policy")||"",/connect-src 'none'/);
 const actual=Buffer.from(await response.arrayBuffer());
 const expected=await readFile(path.join(process.cwd(),"node_modules/pdfjs-dist/build/pdf.worker.mjs"));
 const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
 assert.equal(sha(actual),sha(expected));assert.ok(actual.length>100000);
});
