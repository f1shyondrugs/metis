import assert from "node:assert/strict";
import test,{after} from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";import path from "node:path";import {generateKeyPairSync,randomBytes,createHash,sign} from "node:crypto";import {createRequire} from "node:module";
const directory=mkdtempSync(path.join(os.tmpdir(),"metis-passkey-security-"));
Object.assign(process.env,{AI_CHAT_ROOT:directory,CHAT_DATA_DIR:directory,CHAT_DB_PATH:path.join(directory,"chat.sqlite"),AGENT_CWD:directory,AI_CHAT_PUBLIC_URL:"https://passkeys.example.test"});
void (async()=>{
const auth=await import("../lib/auth"),pk=await import("../lib/passkeys"),{getDatabase}=await import("../lib/sqlite"),{resetRateLimit}=await import("../lib/rate-limit");
after(()=>{getDatabase().close();rmSync(directory,{recursive:true,force:true});});
const owner=auth.createUser("synthetic-passkey-owner","local-test-password"),other=auth.createUser("synthetic-passkey-other","local-test-password");
const first=auth.createUserSession(owner.id),second=auth.createUserSession(other.id);
const cookie=(token:string)=>"ai_chat_auth="+token;
function req(body?:unknown,cookies="",origin="https://passkeys.example.test"){return new Request("https://passkeys.example.test/api/passkeys/test",{method:"POST",headers:{origin,cookie:cookies,...(body?{"content-type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});}
async function call(action:string,body?:unknown,cookies="",origin?:string){resetRateLimit("passkeys:unknown");resetRateLimit("passkeys:global");return pk.passkeyRequest(req(body,cookies,origin),action);}
function binding(response:Response){return response.headers.get("set-cookie")!.match(/metis_passkey_ceremony=([^;]+)/)![0];}
test("registration and management require authentication; origin is never caller-authoritative",async()=>{
 for(const action of ["list","register/options","register/verify","remove"])assert.equal((await call(action)).status,401);
 assert.equal((await call("register/options",undefined,cookie(first.token),"https://evil.test")).status,400);
 const noOrigin=new Request("https://passkeys.example.test/api/passkeys/test",{method:"POST"});assert.equal((await pk.passkeyRequest(noOrigin,"authenticate/options")).status,400);
});
test("registration requires resident keys, user verification, random challenge and secure browser binding",async()=>{
 const a=await call("register/options",undefined,cookie(first.token)),b=await call("register/options",undefined,cookie(first.token));
 const options=await a.json();assert.equal(options.rp.id,"passkeys.example.test");assert.equal(options.authenticatorSelection.residentKey,"required");assert.equal(options.authenticatorSelection.userVerification,"required");
 assert.notEqual(options.challenge,(await b.json()).challenge);assert.match(a.headers.get("set-cookie")!,/HttpOnly/i);assert.match(a.headers.get("set-cookie")!,/Secure/i);assert.match(a.headers.get("set-cookie")!,/SameSite=strict/i);
});
test("registration ceremony is single-use, user/session-bound, expiring and not interchangeable with login",async()=>{
 let options=await call("register/options",undefined,cookie(first.token));let bind=binding(options);
 assert.equal((await call("register/verify",{credential:{}},cookie(second.token)+"; "+bind)).status,400);
 assert.equal((await call("register/verify",{credential:{}},cookie(first.token)+"; "+bind)).status,400);
 options=await call("register/options",undefined,cookie(first.token));bind=binding(options);
 const alternate=auth.createUserSession(owner.id);
 assert.equal((await call("register/verify",{credential:{}},cookie(alternate.token)+"; "+bind)).status,400);
 options=await call("register/options",undefined,cookie(first.token));bind=binding(options);getDatabase().prepare("UPDATE passkey_ceremonies SET expires_at=0").run();
 assert.equal((await call("register/verify",{credential:{}},cookie(first.token)+"; "+bind)).status,400);
 options=await call("register/options",undefined,cookie(first.token));bind=binding(options);
 assert.equal((await call("authenticate/verify",{credential:{}},bind)).status,400);
});
const require=createRequire(path.join(process.cwd(),"package.json")),cbor=createRequire(require.resolve("@simplewebauthn/server"))("@levischuck/tiny-cbor");
const pair=generateKeyPairSync("ec",{namedCurve:"prime256v1"}),jwk=pair.publicKey.export({format:"jwk"}),keyId=randomBytes(32).toString("base64url");
const publicKey=cbor.encodeCBOR(new Map<number,unknown>([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x!,"base64url"))],[-3,new Uint8Array(Buffer.from(jwk.y!,"base64url"))]]));
async function installKey(){await call("list",undefined,cookie(first.token));getDatabase().prepare("INSERT OR REPLACE INTO account_passkeys VALUES(?,?,?,?,?,?,?,?,NULL)").run(keyId,owner.id,"passkeys.example.test",Buffer.from(publicKey).toString("base64url"),0,"[]","Synthetic key",new Date().toISOString());}
async function assertion(overrides:{origin?:string;challenge?:string;flags?:number;userHandle?:string;rp?:string;badSignature?:boolean}={}){
 const options=await call("authenticate/options"),body=await options.json(),client=Buffer.from(JSON.stringify({type:"webauthn.get",challenge:overrides.challenge||body.challenge,origin:overrides.origin||"https://passkeys.example.test",crossOrigin:false}));
 const counter=Buffer.alloc(4);counter.writeUInt32BE(1);
 const data=Buffer.concat([createHash("sha256").update(overrides.rp||"passkeys.example.test").digest(),Buffer.from([overrides.flags??5]),counter]);
 const signature=sign("sha256",Buffer.concat([data,createHash("sha256").update(client).digest()]),pair.privateKey);
 if(overrides.badSignature)signature[signature.length-1]^=1;
 return {bind:binding(options),credential:{id:keyId,rawId:keyId,type:"public-key",clientExtensionResults:{},response:{clientDataJSON:client.toString("base64url"),authenticatorData:data.toString("base64url"),signature:signature.toString("base64url"),userHandle:overrides.userHandle||Buffer.from(owner.id).toString("base64url")}}};
}
test("real cryptographic WebAuthn assertion issues canonical session; replay and counters are rejected",async()=>{
 await installKey();const a=await assertion();const response=await call("authenticate/verify",{credential:a.credential},a.bind);
 assert.equal(response.status,200,await response.clone().text());const token=response.headers.get("set-cookie")!.match(/ai_chat_auth=([^;]+)/)![1];
 assert.equal(await auth.getAuthenticatedUserId(req(undefined,cookie(token))),owner.id);
 assert.equal((await call("authenticate/verify",{credential:a.credential},a.bind)).status,400);
 const stale=await assertion();assert.equal((await call("authenticate/verify",{credential:stale.credential},stale.bind)).status,400);
});
test("invalid signatures, challenge, origin, RP hash, user handle and absent UV cannot authenticate",async()=>{
 for(const overrides of [{badSignature:true},{challenge:"wrong"},{origin:"https://evil.test"},{rp:"evil.test"},{userHandle:Buffer.from(other.id).toString("base64url")},{flags:1}]){
  await installKey();const a=await assertion(overrides);const response=await call("authenticate/verify",{credential:a.credential},a.bind);assert.equal(response.status,400);assert.ok(!response.headers.get("set-cookie")?.includes("ai_chat_auth="));
 }
});
test("management is owner scoped; deleting a key invalidates pending assertions",async()=>{
 await installKey();assert.deepEqual((await(await call("list",undefined,cookie(second.token))).json()).passkeys,[]);
 await call("remove",{id:keyId},cookie(second.token));assert.ok(getDatabase().prepare("SELECT id FROM account_passkeys WHERE id=?").get(keyId));
 const a=await assertion();await call("remove",{id:keyId},cookie(first.token));assert.equal((await call("authenticate/verify",{credential:a.credential},a.bind)).status,400);
 assert.ok(auth.authenticateUser(owner.username,"local-test-password"),"password fallback is unchanged");
});
})();
