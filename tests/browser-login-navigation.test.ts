import test from "node:test";
import assert from "node:assert/strict";
import {loginNavigationOrigins,protectedRequestAllowed} from "../services/browser-login/navigation-policy";
import type {Page,Request} from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {loadOperatorReturnOrigins,snapshotOperatorReturnOrigins} from "../services/browser-login/operator-return-origins";
test("only explicitly declared HTTPS return origins join protected navigation",()=>{
  const origins=loginNavigationOrigins(new URL("https://login.example.test/?url="+Buffer.from("https://app.example.test/home").toString("base64")));
  assert.deepEqual([...origins],["https://login.example.test","https://app.example.test"]);
  for(const target of ["http://other.test","https://user:pass@other.test","https://other.test:444/path"]){
    assert.deepEqual([...loginNavigationOrigins(new URL("https://login.example.test/?next="+encodeURIComponent(target)))],["https://login.example.test"]);
  }
  const page={context:()=>({})} as Page;
  const request=(url:string)=>({url:()=>url,postData:()=>null}) as Request;
  assert.equal(protectedRequestAllowed(page,request("https://app.example.test/home"),"https://login.example.test",origins),true);
  assert.equal(protectedRequestAllowed(page,request("https://unapproved.test/"),"https://login.example.test",origins),false);
});


test("operator returns are exact credential-origin mappings and preserve the fixed session cap",()=>{
  const config=snapshotOperatorReturnOrigins({"https://login.example.test":["https://task.example.test"]});
  const target=new URL("https://login.example.test/?return_url="+encodeURIComponent("https://app.example.test/home"));
  assert.deepEqual([...loginNavigationOrigins(target)],["https://login.example.test","https://app.example.test"]);
  assert.deepEqual([...loginNavigationOrigins(target,config[target.origin])],["https://login.example.test","https://app.example.test","https://task.example.test"]);
  assert.deepEqual([...loginNavigationOrigins(new URL("https://other.example.test/"),config["https://other.example.test"])],["https://other.example.test"]);
  const full=new URL(target.href+"&next="+encodeURIComponent("https://third.example.test")+"&returnto="+encodeURIComponent("https://fourth.example.test"));
  assert.throws(()=>loginNavigationOrigins(full,config[target.origin]),/Too many/);
});

test("operator configuration rejects malformed, ambiguous and unbounded origin grants",()=>{
  for(const origin of ["http://app.test","https://app.test/","https://app.test/path","https://app.test?next=x","https://app.test#x","https://user:pass@app.test","https://app.test:444","https://app.test:443","https://APP.test","*.test"," https://app.test"]){
    assert.throws(()=>snapshotOperatorReturnOrigins({[origin]:[]}));
    assert.throws(()=>snapshotOperatorReturnOrigins({"https://login.test":[origin]}));
  }
  for(const value of [null,[],"x",{"https://login.test":"https://app.test"},{"https://login.test":["https://login.test"]},{"https://login.test":["https://app.test","https://app.test"]},{"https://login.test":["https://a.test","https://b.test","https://c.test","https://d.test"]},Object.fromEntries(Array.from({length:65},(_,i)=>["https://login"+i+".test",[]]))])assert.throws(()=>snapshotOperatorReturnOrigins(value));
});

test("operator file is an immutable snapshot and unsafe filesystem inputs fail closed",t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"metis-return-origins-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,"returns.json");
  const source={"https://login.test":["https://task.test"]};
  fs.writeFileSync(file,JSON.stringify(source));
  const snapshot=loadOperatorReturnOrigins(file,true);
  source["https://login.test"].push("https://later.test");
  fs.writeFileSync(file,JSON.stringify(source));
  assert.deepEqual(snapshot["https://login.test"],["https://task.test"]);
  assert(Object.isFrozen(snapshot)&&Object.isFrozen(snapshot["https://login.test"]));
  assert.throws(()=>loadOperatorReturnOrigins(file),/Invalid/); // shared /tmp is never production operator storage
  assert.deepEqual(Object.keys(loadOperatorReturnOrigins(undefined)),[]);
  assert.throws(()=>loadOperatorReturnOrigins(path.join(dir,"missing.json"),true));
  assert.throws(()=>loadOperatorReturnOrigins(dir,true));
  fs.symlinkSync(file,path.join(dir,"link.json"));
  assert.throws(()=>loadOperatorReturnOrigins(path.join(dir,"link.json"),true));
  fs.symlinkSync(dir,path.join(dir,"link-dir"));
  assert.throws(()=>loadOperatorReturnOrigins(path.join(dir,"link-dir","returns.json"),true));
  fs.writeFileSync(file,"{");
  assert.throws(()=>loadOperatorReturnOrigins(file,true));
  fs.writeFileSync(file," ".repeat(32769));
  assert.throws(()=>loadOperatorReturnOrigins(file,true));
});
