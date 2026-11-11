import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,writeFileSync,rmSync,chmodSync} from "node:fs";
import path from "node:path";
import os from "node:os";
import {activeMcpEndpoint} from "../lib/mcp-active-endpoint";
test("new connection routing accepts only protected loopback config and preserves existing values",()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-mcp-active-")),file=path.join(root,"active-endpoint.json"),fallback="http://127.0.0.1:8798";
 try{
  assert.equal(activeMcpEndpoint(root,fallback),fallback);
  writeFileSync(file,JSON.stringify({version:1,url:"http://127.0.0.1:8799"}),{mode:0o600});
  const pinned=activeMcpEndpoint(root,fallback);assert.equal(pinned,"http://127.0.0.1:8799");
  writeFileSync(file,JSON.stringify({version:1,url:fallback}));
  assert.equal(pinned,"http://127.0.0.1:8799");assert.equal(activeMcpEndpoint(root,fallback),fallback);
  for(const url of ["https://outside.example","http://user:password@127.0.0.1:8799","http://127.0.0.1:8799/path"]){
   writeFileSync(file,JSON.stringify({version:1,url}));assert.throws(()=>activeMcpEndpoint(root,fallback));
  }
  writeFileSync(file,JSON.stringify({version:1,url:fallback}));chmodSync(file,0o666);assert.throws(()=>activeMcpEndpoint(root,fallback));
 }finally{rmSync(root,{recursive:true,force:true});}
});
