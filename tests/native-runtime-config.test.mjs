import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {prepareNativeRuntime} from "../scripts/prepare-native-runtime.mjs";
test("native runtime config loads as JavaScript without its type-only dependencies",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"metis-config-"));
 try{
  fs.writeFileSync(path.join(root,"next.config.ts"),'import type {Missing} from "not-installed";const config:{distDir:string;value:number}={distDir:process.env.NEXT_DIST_DIR||".next",value:42};export default config;');
  const file=prepareNativeRuntime(root);
  const loaded=await import(pathToFileURL(file));
  assert.equal(loaded.default.value,42);assert.equal(loaded.default.distDir,process.env.NEXT_DIST_DIR||".next");
  assert.ok(!fs.readFileSync(file,"utf8").includes("not-installed"));
 }finally{fs.rmSync(root,{recursive:true});}
});
