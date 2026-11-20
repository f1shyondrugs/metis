import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { NamedVaultEntries } from "../services/browser-login/named-vault";
import { ScopedCredentials } from "../services/browser-login/scoped-credentials";

test("named fields are encrypted, revisioned and scoped to the owner", () => {
  const dir=mkdtempSync(path.join(os.tmpdir(),"metis-named-vault-"));
  const file=path.join(dir,"vault.sqlite"), key=randomBytes(32);
  let db=new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;");
    let vault=new NamedVaultEntries(key,db);
    const password="SYNTHETIC-NAMED-PASSWORD", identity="SYNTHETIC-NAMED-LOGIN-ID";
    const entry=vault.mutate("owner",{action:"create",title:"Office",fields:[
      {name:"endpoint",type:"url",value:"https://service.example/"},
      {name:"user",type:"login_id",value:identity},
      {name:"api_token",type:"secret",value:password},
      {name:"region",type:"text",value:"EU"},
    ]}).entry!;
    assert.equal(entry.revision,1);assert.equal(entry.fields.length,4);
    assert.doesNotMatch(JSON.stringify(vault.list("owner")),/SYNTHETIC-NAMED|service\.example|\bEU\b/);
    assert.deepEqual(vault.list("other"),[]);
    assert.throws(()=>vault.mutate("other",{action:"delete",id:entry.id,revision:entry.revision}), /no longer available/);
    assert.throws(()=>vault.mutate("owner",{action:"update",id:entry.id,revision:9,title:"Office",fields:[]}),/another session/);
    assert.throws(()=>vault.mutate("owner",{action:"update",id:entry.id,revision:1,title:"Office",fields:
      [{...entry.fields[2],type:"text"}]}),/Re-enter/);
    assert.throws(()=>vault.mutate("owner",{action:"create",title:"Office",fields:[
      {name:"same",type:"text",value:"one"},{name:"Same",type:"secret",value:"two"},
    ]}),/unique/);
    assert.throws(()=>vault.mutate("owner",{action:"create",title:"Invalid",fields:[
      {name:"url",type:"url",value:"https://secret@service.example"},
    ]}),/credentials/);
    const revised=vault.mutate("owner",{action:"update",id:entry.id,revision:1,title:"Renamed",fields:[
      {...entry.fields[2],name:"new_name"}, {name:"another",type:"secret",value:"SYNTHETIC-ROTATED"},
    ]}).entry!;
    assert.equal(revised.id,entry.id);assert.equal(revised.fields[0].id,entry.fields[2].id);
    assert.equal(revised.revision,2);
    const duplicate=vault.mutate("owner",{action:"create",title:"Renamed",fields:[]}).entry!;
    assert.notEqual(duplicate.id,entry.id,"same titles are not a reference");
    const encoded=db.prepare("SELECT envelope FROM named_vault_entries WHERE owner=? AND id=?").get("owner",entry.id)?.envelope;
    assert.equal(typeof encoded,"string");
    assert.doesNotMatch(String(encoded),/SYNTHETIC|ROTATED/);
    for(const path of [file,file+"-wal"]) if(existsSync(path)){
      const bytes=readFileSync(path);
      assert.equal(bytes.includes(Buffer.from(password)),false);
      assert.equal(bytes.includes(Buffer.from(identity)),false);
    }
    db.close();db=new DatabaseSync(file);vault=new NamedVaultEntries(key,db);
    assert.deepEqual(vault.list("owner").find(item=>item.id===entry.id),revised);
    vault.mutate("owner",{action:"delete",id:entry.id,revision:2});
    assert.deepEqual(vault.list("owner"),[duplicate]);
  } finally { db.close();rmSync(dir,{force:true,recursive:true}); }
});

test("additive migration preserves old login envelopes and stable references", () => {
  const db=new DatabaseSync(":memory:"),key=randomBytes(32);
  try{
    db.exec("CREATE TABLE website_logins (owner TEXT, origin TEXT, envelope TEXT, PRIMARY KEY(owner,origin))");
    const passwords=new ScopedCredentials(key,db);
    const url="https://example.test",target=JSON.stringify(["su","fixture",0,"root","root","local"]);
    passwords.save("owner","","browser",url,"SYNTHETIC-WEB",true);
    passwords.save("owner","","console",target,"SYNTHETIC-LOCAL",true,"Local login");
    const envelopes = () => [db.prepare("SELECT envelope FROM website_logins").get(),db.prepare("SELECT envelope FROM console_logins").get()];
    const prior=envelopes(), vault=new NamedVaultEntries(key,db);
    const sync=()=>vault.syncBound("owner",passwords.list("owner") as Array<{origin:string}>);
    sync();
    const [web,local]=["browser","console"].map(kind=>vault.list("owner").find(entry=>entry.kind===kind)!);
    vault.mutate("owner",{action:"update",id:local.id,revision:1,title:"Operator",fields:[]});
    sync();
    assert.equal(vault.list("owner").find(entry=>entry.id===local.id)?.title,"Operator");
    assert.equal(vault.list("owner").find(entry=>entry.kind==="browser")?.id,web.id);
    assert.deepEqual(envelopes(),prior);
    assert.equal(passwords.get("owner","chat","console",target)?.password,"SYNTHETIC-LOCAL");
    assert.equal(passwords.get("owner","chat","browser",url)?.password,"SYNTHETIC-WEB");
    vault.requireBound("owner",web.id,"browser",url);
    assert.throws(()=>vault.requireBound("other",web.id,"browser",url),/no longer available/);
    assert.throws(()=>vault.requireBound("owner",web.id,"browser","https://other.test"),/target/);
    assert.throws(()=>vault.requireBound("owner",web.id,"console",target),/no longer available/);
    assert.throws(()=>vault.mutate("owner",{action:"delete",id:local.id,revision:2}),/bound login/);
    passwords.delete("owner","console",target);sync();
    assert.equal(vault.list("owner").some(entry=>entry.id===local.id),false);
  } finally { db.close(); }
});
