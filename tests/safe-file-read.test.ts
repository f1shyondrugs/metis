import assert from "node:assert/strict";
import {closeSync,mkdtempSync,mkdirSync,readFileSync,renameSync,rmSync,statSync,symlinkSync,writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {copySafeFile,copySafeFileAsync,ensureSafeDirectory,openSafeRead,readSafeFile,unlinkSafeFile,writeSafeFile} from "../lib/safe-file-read";
import {fileResponse} from "../lib/file-response";

test("Linux file operations reject final/intermediate symlinks and pin readable inodes",{skip:process.platform!=="linux"},async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-safe-file-"));
 try{
  const privateDir=path.join(root,"private"),publicDir=path.join(root,"public");mkdirSync(privateDir);mkdirSync(publicDir);
  const secret=path.join(privateDir,"secret");writeFileSync(secret,"FOREIGN-SECRET");
  const link=path.join(publicDir,"link");symlinkSync(secret,link);
  assert.throws(()=>readSafeFile(link));assert.throws(()=>writeSafeFile(link,"x",{exclusive:true}));
  assert.equal(fileResponse(link,{name:"test.txt",mimeType:"text/plain"}).status,404);
  const nested=path.join(publicDir,"nested");symlinkSync(privateDir,nested);
  assert.throws(()=>ensureSafeDirectory(path.join(nested,"new")));
  assert.throws(()=>readSafeFile(path.join(nested,"secret")));
  assert.throws(()=>writeSafeFile(path.join(nested,"secret"),"attacker"));
  writeSafeFile(link,"OWN-NEW");assert.equal(readFileSync(secret,"utf8"),"FOREIGN-SECRET");assert.equal(readSafeFile(link).toString(),"OWN-NEW");
  const fd=openSafeRead(link);renameSync(link,path.join(publicDir,"moved"));symlinkSync(secret,link);
  try{assert.equal(readFileSync(fd,"utf8"),"OWN-NEW");}finally{closeSync(fd);}
  unlinkSafeFile(link);assert.equal(readFileSync(secret,"utf8"),"FOREIGN-SECRET");
  copySafeFile(secret,link,{exclusive:true});assert.equal(readSafeFile(link).toString(),"FOREIGN-SECRET");
  assert.throws(()=>readSafeFile(link,2),/too large/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("asynchronous copy pins both file inodes and rejects symlink paths",{skip:process.platform!=="linux"},async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-safe-async-copy-"));try{
  const source=path.join(root,"source"),target=path.join(root,"target"),foreign=path.join(root,"foreign");
  writeFileSync(source,"authorized",{mode:0o700});writeFileSync(foreign,"PRIVATE");
  symlinkSync(foreign,target);
  await assert.rejects(copySafeFileAsync(source,target));
  assert.equal(readFileSync(foreign,"utf8"),"PRIVATE");
  unlinkSafeFile(target);
  const copying=copySafeFileAsync(source,target,{mode:0o644});
  renameSync(source,path.join(root,"original-source"));symlinkSync(foreign,source);
  renameSync(target,path.join(root,"original-target"));symlinkSync(foreign,target);
  assert.equal(await copying,10);
  assert.equal(readSafeFile(path.join(root,"original-target")).toString(),"authorized");
  assert.equal(statSync(path.join(root,"original-target")).mode&0o777,0o644);
  assert.equal(readFileSync(foreign,"utf8"),"PRIVATE");
  await assert.rejects(copySafeFileAsync(source,path.join(root,"other")));
  const link=path.join(root,"linked-directory");symlinkSync(root,link);
  await assert.rejects(copySafeFileAsync(path.join(root,"original-source"),path.join(link,"nested")));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("download stream reads its authorized inode after pathname replacement",{skip:process.platform!=="linux"},async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-safe-stream-"));try{
  const file=path.join(root,"document.txt"),foreign=path.join(root,"foreign");writeFileSync(file,"authorized");writeFileSync(foreign,"PRIVATE");
  const response=fileResponse(file,{name:"document.txt",mimeType:"text/plain"});renameSync(file,path.join(root,"old"));symlinkSync(foreign,file);
  assert.equal(await response.text(),"authorized");
 }finally{rmSync(root,{recursive:true,force:true});}
});
