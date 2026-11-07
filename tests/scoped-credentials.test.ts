import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {randomBytes} from "node:crypto";
import {ScopedCredentials} from "../services/browser-login/scoped-credentials";

type TemporaryEntry={owner:string;chat:string;kind:string;target:string;envelope:string;expires:number};
function temporarySlots(store:ScopedCredentials){return (store as unknown as {temporary:Map<string,TemporaryEntry>}).temporary;}
function fixture(){const db=new DatabaseSync(":memory:");db.exec("CREATE TABLE website_logins(owner TEXT,origin TEXT,envelope TEXT,PRIMARY KEY(owner,origin));");const key=randomBytes(32);return {db,key,store:new ScopedCredentials(key,db)};}
test("unchecked credentials are memory-only, chat/owner/target-bound and never global",()=>{
  const {db,store}=fixture();
  try{
    store.save("alice","chat-a","browser","https://portal.example","TEST-CHAT-PASSWORD",false);
    assert.equal(store.get("alice","chat-a","browser","https://portal.example")?.password,"TEST-CHAT-PASSWORD");
    for(const [owner,chat,kind,target]of [["alice","chat-b","browser","https://portal.example"],["bob","chat-a","browser","https://portal.example"],["alice","chat-a","browser","https://other.example"],["alice","chat-a","console","https://portal.example"]]as const)assert.equal(store.get(owner,chat,kind,target),null);
    assert.deepEqual(store.list("alice"),[]);
    assert.equal((db.prepare("SELECT count(*) AS n FROM website_logins").get() as {n:number}).n,0);
    assert(!JSON.stringify([...temporarySlots(store).values()]).includes("TEST-CHAT-PASSWORD"));
    store.forgetChat("alice","chat-a");assert.equal(store.get("alice","chat-a","browser","https://portal.example"),null);
  }finally{db.close();}
});
test("permanent values survive service reconstruction while temporary overrides do not replace them",()=>{
  const {db,key,store}=fixture();
  try{
    store.save("alice","chat-a","browser","https://portal.example","TEST-PERMANENT",true);
    store.save("alice","chat-a","browser","https://portal.example","TEST-TEMPORARY",false);
    assert.equal(store.get("alice","chat-a","browser","https://portal.example")?.password,"TEST-TEMPORARY");
    assert.equal(store.get("alice","chat-b","browser","https://portal.example")?.password,"TEST-PERMANENT");
    const encoded=(db.prepare("SELECT envelope FROM website_logins").get() as {envelope:string}).envelope;assert(!encoded.includes("TEST-PERMANENT"));
    const restarted=new ScopedCredentials(key,db);assert.equal(restarted.get("alice","chat-a","browser","https://portal.example")?.password,"TEST-PERMANENT");
    store.delete("alice","browser","https://portal.example");assert.equal(store.get("alice","chat-a","browser","https://portal.example"),null);
  }finally{db.close();}
});
test("console credentials include host, user, auth method and SSH key in their separate binding",()=>{
  const {db,store}=fixture();const target=JSON.stringify(["ssh","host",22,"root","root","SHA256:test"]);
  try{
    store.save("alice","chat","console",target,"TEST-ROOT",true,"ssh: root@host");
    assert.equal(store.get("alice","other","console",target)?.password,"TEST-ROOT");
    for(const changed of [["ssh","other",22,"root","root","SHA256:test"],["ssh","host",22,"other","root","SHA256:test"],["su","host",22,"root","root","SHA256:test"],["ssh","host",22,"root","root","SHA256:changed"]])assert.equal(store.get("alice","chat","console",JSON.stringify(changed)),null);
    assert.equal(store.get("alice","chat","browser",target),null);
    assert(!JSON.stringify(store.list("alice")).includes("TEST-ROOT"));
  }finally{db.close();}
});
test("temporary values expire and transplanted ciphertext fails chat AAD authentication",()=>{
  const {db,store}=fixture();try{
    store.save("alice","chat-a","browser","https://portal.example","TEST-SECRET",false);
    const slots=temporarySlots(store);
    const entry=[...slots.values()][0];slots.set(JSON.stringify(["alice","chat-b","browser","https://portal.example"]),{...entry,chat:"chat-b"});
    assert.throws(()=>store.get("alice","chat-b","browser","https://portal.example"));
    entry.expires=Date.now()-1;assert.equal(store.get("alice","chat-a","browser","https://portal.example"),null);
  }finally{db.close();}
});

test("identity-only values are encrypted and owner-bound; saving another field never promotes chat-only identity",()=>{
 const {db,key,store}=fixture();const origin="https://portal.example";
 try{
  store.saveValues("alice","chat-a","browser",origin,{email:"TEST-PRIVATE@example.test"},false);
  store.saveValues("alice","chat-a","browser",origin,{password:"TEST-PERSISTENT"},true);
  assert.deepEqual(store.get("alice","chat-a","browser",origin),{email:"TEST-PRIVATE@example.test",password:"TEST-PERSISTENT"});
  assert.deepEqual(store.get("alice","chat-b","browser",origin),{});
  assert.equal(store.get("bob","chat-a","browser",origin),null);
  const restarted=new ScopedCredentials(key,db);assert.deepEqual(restarted.get("alice","chat-a","browser",origin),{});
  restarted.saveValues("alice","chat-a","browser",origin,{email:"TEST-PRIVATE@example.test"},false);
  assert.equal(restarted.get("alice","chat-a","browser",origin)?.password,"TEST-PERSISTENT");
  store.saveValues("alice","chat-a","browser",origin,{username:"TEST-PRIVATE-NAME",email:"TEST-PERSISTENT@example.test"},true);
  assert.deepEqual(restarted.get("alice","other","browser",origin),{username:"TEST-PRIVATE-NAME",email:"TEST-PERSISTENT@example.test"});
  assert(!JSON.stringify(db.prepare("SELECT envelope FROM website_logins").all()).includes("TEST-PRIVATE"));
 }finally{db.close();}
});

test("changing a login identifier cannot silently reuse the previous account's password",()=>{
 const {db,store}=fixture(),origin="https://portal.example";
 try{
  store.saveValues("alice","chat","browser",origin,{email:"first@example.test",password:"TEST-FIRST-ACCOUNT"},true);
  store.saveValues("alice","chat","browser",origin,{email:"second@example.test"},false);
  assert.deepEqual(store.get("alice","chat","browser",origin),{email:"second@example.test"});
  assert.deepEqual(store.get("alice","other","browser",origin),{email:"first@example.test",password:"TEST-FIRST-ACCOUNT"});
  store.saveValues("alice","chat","browser",origin,{password:"TEST-SECOND-ACCOUNT"},false);
  assert.equal(store.get("alice","chat","browser",origin)?.password,"TEST-SECOND-ACCOUNT");
  store.saveValues("alice","chat","browser",origin,{password:"TEST-SECOND-ACCOUNT"},true);
  assert.deepEqual(store.get("alice","other","browser",origin),{email:"first@example.test"},"a permanent password must not be paired with an unrelated permanent identifier");
  assert.equal(store.get("alice","chat","browser",origin)?.password,"TEST-SECOND-ACCOUNT");
  store.saveValues("alice","fresh","browser",origin,{email:"second@example.test"},false);
  assert.equal(store.get("alice","fresh","browser",origin)?.password,"TEST-SECOND-ACCOUNT","only the matching explicitly supplied identifier may recover its bound permanent password");
  store.saveValues("alice","new","browser",origin,{email:"third@example.test"},true);
  assert.deepEqual(store.get("alice","other","browser",origin),{email:"third@example.test"});
 }finally{db.close();}
});
