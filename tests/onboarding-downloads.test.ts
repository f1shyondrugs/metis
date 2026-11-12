import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-onboarding-api-"));
process.env.CHAT_DATA_DIR=root;process.env.CHAT_DB_PATH=path.join(root,"db.sqlite");process.env.AI_CHAT_ROOT=root;process.env.AGENT_CWD=root;
const token="synthetic-onboarding-session",cookie="ai_chat_auth="+token;
let requests=0;
async function fixture(){
 const {getDatabase}=await import("../lib/sqlite");const db=getDatabase();
 db.prepare("INSERT OR IGNORE INTO users(id,username,password_hash,created_at)VALUES(?,?,?,?)").run("fixture-owner","fixture-user","unused",new Date().toISOString());
 db.prepare("INSERT OR IGNORE INTO sessions(token_hash,user_id,expires_at)VALUES(?,?,?)").run(createHash("sha256").update(token).digest("hex"),"fixture-owner",new Date(Date.now()+600000).toISOString());
 const {GET}=await import("../app/api/onboarding/downloads/route");
 return GET;
}
test("downloads require authentication before any release lookup",async()=>{
 const GET=await fixture(),original=globalThis.fetch;
 globalThis.fetch=(async()=>{requests++;throw Error("Must not call release API");}) as typeof fetch;
 try{assert.equal((await GET(new Request("http://fixture/api/onboarding/downloads?platform=windows"))).status,401);assert.equal(requests,0);}finally{globalThis.fetch=original;}
});
test("mobile platforms are honest development placeholders with no installer",async()=>{
 const GET=await fixture();
 for(const platform of ["ios","android"]){const response=await GET(new Request("http://fixture/api/onboarding/downloads?platform="+platform,{headers:{cookie}}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{platform,status:"development",downloads:[]});}
});
test("platform is an allowlist, not a caller supplied release URL",async()=>{
 const GET=await fixture();
 for(const value of ["https://evil.invalid","darwin","../windows"]){assert.equal((await GET(new Request("http://fixture/api/onboarding/downloads?platform="+encodeURIComponent(value),{headers:{cookie}}))).status,400);}
});
test("desktop downloads use verified existing release artifacts and expose available architectures only",async()=>{
 const GET=await fixture(),original=globalThis.fetch;
 const release=await import("../lib/remote-client-release");release.resetRemoteClientReleaseCache();
 globalThis.fetch=(async()=>Response.json({tag_name:"v-fixture",assets:[{name:"Metis-AI-Remote-Client-arm64.dmg"}]})) as typeof fetch;
 try{
  const response=await GET(new Request("http://fixture/api/onboarding/downloads?platform=macos",{headers:{cookie}}));assert.equal(response.status,200);assert.match(response.headers.get("cache-control")||"",/private, no-store/);
  const result=await response.json();assert.equal(result.downloads.length,1);assert.match(result.downloads[0].label,/Apple Silicon/);assert.equal(result.downloads[0].url,"https://github.com/f1shyondrugs/Metis-Apps/releases/download/v-fixture/Metis-AI-Remote-Client-arm64.dmg");
 }finally{globalThis.fetch=original;release.resetRemoteClientReleaseCache();}
});
