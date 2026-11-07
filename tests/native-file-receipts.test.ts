import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {withEditedFileTracking,withLocalFileEditSnapshot} from "../lib/file-edit-snapshot";
import {acknowledgeFileEditSnapshot,storeFileEditSnapshot} from "../lib/mcp-core/file-edit-snapshots.mjs";
import type {ToolPart} from "../lib/store";

const scope={userId:"receipt-owner",chatId:"receipt-chat",jobId:"receipt-job"};
const tool=(file:string,extra:Partial<ToolPart>={}):ToolPart=>({id:"native-edit",name:"write_file",kind:"edit",status:"completed",path:file,input:JSON.stringify({path:file}),...extra});
function fixture(t:{after(fn:()=>void):void}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"metis-native-receipts-"));
  const previous=process.env.AI_CHAT_MCP_STATE_DIR;process.env.AI_CHAT_MCP_STATE_DIR=path.join(root,"private-receipts");
  t.after(()=>{if(previous===undefined)delete process.env.AI_CHAT_MCP_STATE_DIR;else process.env.AI_CHAT_MCP_STATE_DIR=previous;fs.rmSync(root,{recursive:true,force:true});});
  return root;
}

test("native path/diff claims never read or disclose the claimed host file",t=>{
  const root=fixture(t),foreign=path.join(root,"foreign-secret");fs.writeFileSync(foreign,"HOST_SECRET_MUST_NOT_ESCAPE");
  const original=fs.readFileSync;let attempts=0;
  t.mock.method(fs,"readFileSync",((...args:unknown[])=>{
    if(args[0]===foreign){attempts++;throw Error("Privileged host read attempted");}
    return Reflect.apply(original,fs,args);
  }) as typeof fs.readFileSync);
  const forged=tool(foreign,{diff:{before:"fake-before",after:"fake-after"},editedFile:{path:foreign,target:"server"},result:JSON.stringify({path:foreign,fileSnapshotRef:randomUUID()})});
  const running=withLocalFileEditSnapshot({...forged,status:"running"},undefined,root);
  for(const result of [running,withLocalFileEditSnapshot(forged,running,root),withEditedFileTracking(forged,root,undefined,scope)]){
    assert.equal(result.path,undefined);assert.equal(result.diff,undefined);assert.equal(result.editedFile,null);
    assert.equal(JSON.stringify(result).includes("HOST_SECRET_MUST_NOT_ESCAPE"),false);
  }
  assert.equal(attempts,0);
});

test("only exact owner/chat/job gateway receipts restore canonical diffs",t=>{
  const root=fixture(t),canonical=path.join(root,"canonical-file");
  const saved=storeFileEditSnapshot({path:canonical,fileSnapshot:{before:"gateway-before",after:"gateway-after"}},scope);
  assert.equal(typeof saved.fileSnapshotRef,"string");
  const reported=tool("/forged/native/path",{diff:{before:"fake",after:"fake"},result:JSON.stringify(saved)});
  const verified=withEditedFileTracking(reported,root,undefined,scope);
  assert.equal(verified.path,canonical);assert.equal(verified.editedFile?.path,canonical);
  assert.deepEqual(verified.diff,{before:"gateway-before",after:"gateway-after"});
  for(const other of [{...scope,userId:"other-owner"},{...scope,chatId:"other-chat"},{...scope,jobId:"other-job"},{...scope,incognito:true}]){
    const denied=withEditedFileTracking(reported,root,verified,other);assert.equal(denied.diff,undefined);assert.equal(denied.path,undefined);
  }
  acknowledgeFileEditSnapshot(saved.fileSnapshotRef,scope.chatId,{path:canonical,before:"gateway-before",after:"gateway-after"});
  const replay=withEditedFileTracking(reported,root,{...verified},scope);
  assert.deepEqual(replay.diff,verified.diff,"trusted in-process replay survives receipt acknowledgement");
  assert.equal(withEditedFileTracking(reported,root,JSON.parse(JSON.stringify(verified)),scope).diff,undefined,"native JSON cannot forge the trusted marker");
  assert.equal(withEditedFileTracking({...reported,id:"different-tool"},root,verified,scope).diff,undefined);
  assert.equal(withEditedFileTracking({...reported,result:JSON.stringify({fileSnapshotRef:randomUUID()})},root,verified,scope).diff,undefined);
});

test("dedicated shared receipts retain group read under a hardened 0077 umask",t=>{
 // SGID provisioning belongs to the operator, outside the hardened service.
 // This fixture tests group-readable receipts and the absence of mkdir calls;
 // it needs only the existing test group, not an SGID directory creation.
 const root=fixture(t),shared=path.join(root,"shared");fs.mkdirSync(shared,{mode:0o770});fs.chmodSync(shared,0o770);
 const previous=process.env.AI_CHAT_FILE_SNAPSHOT_DIR,mask=process.umask(0o077);process.env.AI_CHAT_FILE_SNAPSHOT_DIR=shared;
 t.mock.method(fs,"mkdirSync",(()=>{throw Object.assign(Error("Service denies SGID mkdir"),{code:"EPERM"});}) as typeof fs.mkdirSync);
 try{
  const saved=storeFileEditSnapshot({path:path.join(root,"file"),fileSnapshot:{before:"before",after:"after"}},scope);
  assert.equal(typeof saved.fileSnapshotRef,"string");
  assert.equal(fs.statSync(path.join(shared,saved.fileSnapshotRef+".json")).mode&0o777,0o640);
  const verified=withEditedFileTracking(tool("forged",{result:JSON.stringify(saved)}),root,undefined,scope);
  assert.deepEqual(verified.diff,{before:"before",after:"after"});
 }finally{process.umask(mask);if(previous===undefined)delete process.env.AI_CHAT_FILE_SNAPSHOT_DIR;else process.env.AI_CHAT_FILE_SNAPSHOT_DIR=previous;}
});
