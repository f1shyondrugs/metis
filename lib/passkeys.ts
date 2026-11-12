
import {createHash,randomBytes} from "node:crypto";
import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse,type RegistrationResponseJSON,type AuthenticationResponseJSON} from "@simplewebauthn/server";
import {getDatabase} from "@/lib/sqlite";
import {getAuthenticatedUser,CHAT_COOKIE,createUserSession,revokeRequestSession} from "@/lib/auth";
import {requestOriginAllowed,requestIsSecure} from "@/lib/request-network";
import {consumeRateLimit,requestClientAddress} from "@/lib/rate-limit";
import {NextResponse} from "next/server";
const COOKIE="metis_passkey_ceremony",TTL=300_000;
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
function db(){
 const database=getDatabase();
 database.exec("CREATE TABLE IF NOT EXISTS account_passkeys (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,rp_id TEXT NOT NULL,public_key TEXT NOT NULL,counter INTEGER NOT NULL,transports TEXT NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL,last_used_at TEXT); CREATE INDEX IF NOT EXISTS account_passkeys_owner ON account_passkeys(user_id,rp_id); CREATE TABLE IF NOT EXISTS passkey_ceremonies (binding TEXT PRIMARY KEY,challenge TEXT NOT NULL,purpose TEXT NOT NULL,user_id TEXT,session_hash TEXT,origin TEXT NOT NULL,rp_id TEXT NOT NULL,expires_at INTEGER NOT NULL);");
 return database;
}
function cookie(req:Request,name:string){return req.headers.get("cookie")?.split(";").map(v=>v.trim()).find(v=>v.startsWith(name+"="))?.slice(name.length+1)||"";}
function site(req:Request){
 const origin=req.headers.get("origin");
 if(!origin||!requestOriginAllowed(req))throw new Error("Invalid origin.");
 const url=new URL(origin);
 if(url.protocol!=="https:"&&!(url.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(url.hostname)))throw new Error("Passkeys require HTTPS.");
 return {origin:url.origin,rpID:url.hostname};
}
type Ceremony={challenge:string;purpose:string;user_id:string|null;session_hash:string|null;origin:string;rp_id:string;expires_at:number};
type Key={id:string;user_id:string;rp_id:string;public_key:string;counter:number;transports:string;name:string;created_at:string;last_used_at:string|null};
function issue(req:Request,challenge:string,purpose:string,userId?:string){
 const {origin,rpID}=site(req),binding=randomBytes(32).toString("base64url"),database=db();
 database.prepare("DELETE FROM passkey_ceremonies WHERE expires_at<=?").run(Date.now());
 const prior=cookie(req,COOKIE);if(prior)database.prepare("DELETE FROM passkey_ceremonies WHERE binding=?").run(hash(prior));
 database.prepare("INSERT INTO passkey_ceremonies VALUES(?,?,?,?,?,?,?,?)").run(hash(binding),challenge,purpose,userId||null,userId?hash(cookie(req,CHAT_COOKIE)):null,origin,rpID,Date.now()+TTL);
 return binding;
}
function consume(req:Request,purpose:string,userId?:string){
 const authority=site(req),binding=cookie(req,COOKIE);
 if(!/^[A-Za-z0-9_-]{43}$/.test(binding))throw new Error("Passkey request expired. Please try again.");
 const c=db().prepare("DELETE FROM passkey_ceremonies WHERE binding=? RETURNING *").get(hash(binding)) as Ceremony|undefined;
 if(!c||c.expires_at<=Date.now()||c.purpose!==purpose||c.origin!==authority.origin||c.rp_id!==authority.rpID||c.user_id!==(userId||null)||(userId&&c.session_hash!==hash(cookie(req,CHAT_COOKIE))))throw new Error("Passkey request expired. Please try again.");
 return c;
}
function response(req:Request,value:unknown,binding?:string){
 const r=NextResponse.json(value,{headers:{"Cache-Control":"no-store"}});
 if(binding!==undefined)r.cookies.set(COOKIE,binding,{httpOnly:true,sameSite:"strict",secure:requestIsSecure(req),path:"/api/passkeys",maxAge:binding?TTL/1000:0});
 return r;
}
export async function passkeyRequest(req:Request,action:string){
 try{
  site(req);
  const limit=consumeRateLimit("passkeys:"+requestClientAddress(req),60,15*60_000);
  const global=consumeRateLimit("passkeys:global",600,15*60_000);
  if(!limit.allowed||!global.allowed)return NextResponse.json({error:"Too many passkey requests. Try again later."},{status:429,headers:{"Retry-After":String(Math.max(limit.retryAfterSeconds,global.retryAfterSeconds))}});
  const user=await getAuthenticatedUser(req);
  if(!action.startsWith("authenticate/")&&!user)return NextResponse.json({error:"Sign in first."},{status:401});
  const {rpID,origin}=site(req),database=db();
  let body:Record<string,unknown>={};
  if(req.headers.get("content-type")?.includes("application/json")){
   const raw=await req.text();if(raw.length>32_768)throw new Error("Passkey response is too large.");
   body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("Invalid request.");
  }
  if(action==="list")return response(req,{passkeys:database.prepare("SELECT id,name,created_at AS createdAt,last_used_at AS lastUsedAt FROM account_passkeys WHERE user_id=? AND rp_id=? ORDER BY created_at").all(user!.id,rpID)});
  if(action==="remove"){
   if(typeof body.id!=="string"||body.id.length>2048)throw new Error("Invalid passkey.");
   database.prepare("DELETE FROM account_passkeys WHERE user_id=? AND rp_id=? AND id=?").run(user!.id,rpID,body.id);
   return response(req,{ok:true});
  }
  if(action==="register/options"){
   const keys=database.prepare("SELECT id FROM account_passkeys WHERE user_id=? AND rp_id=?").all(user!.id,rpID) as {id:string}[];
   if(keys.length>=20)throw new Error("Remove an old passkey before adding another.");
   const options=await generateRegistrationOptions({rpName:"Metis",rpID,userID:new Uint8Array([...new TextEncoder().encode(user!.id)]),userName:user!.username,attestationType:"none",excludeCredentials:keys,authenticatorSelection:{residentKey:"required",userVerification:"required"}});
   return response(req,options,issue(req,options.challenge,"register",user!.id));
  }
  if(action==="register/verify"){
   const ceremony=consume(req,"register",user!.id);
   const verified=await verifyRegistrationResponse({response:body.credential as RegistrationResponseJSON,expectedChallenge:ceremony.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true});
   if(!verified.verified)throw new Error("Could not verify this passkey.");
   const credential=verified.registrationInfo.credential;
   const name=typeof body.name==="string"?body.name.trim().slice(0,80):"";
   database.prepare("INSERT INTO account_passkeys VALUES(?,?,?,?,?,?,?,?,NULL)").run(credential.id,user!.id,rpID,Buffer.from(credential.publicKey).toString("base64url"),credential.counter,JSON.stringify(credential.transports||[]),name||"Passkey",new Date().toISOString());
   return response(req,{ok:true},"");
  }
  if(action==="authenticate/options"){
   const options=await generateAuthenticationOptions({rpID,userVerification:"required"});
   return response(req,options,issue(req,options.challenge,"authenticate"));
  }
  if(action==="authenticate/verify"){
   const ceremony=consume(req,"authenticate"),credential=body.credential as AuthenticationResponseJSON;
   if(!credential||typeof credential.id!=="string"||credential.id.length>2048)throw new Error("Could not verify this passkey.");
   const key=database.prepare("SELECT * FROM account_passkeys WHERE id=? AND rp_id=?").get(credential.id,rpID) as Key|undefined;
   if(!key||credential.response?.userHandle!==Buffer.from(key.user_id).toString("base64url"))throw new Error("Could not verify this passkey.");
   const verified=await verifyAuthenticationResponse({response:credential,expectedChallenge:ceremony.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:key.id,publicKey:Buffer.from(key.public_key,"base64url"),counter:key.counter,transports:JSON.parse(key.transports)}});
   if(!verified.verified)throw new Error("Could not verify this passkey.");
   const updated=database.prepare("UPDATE account_passkeys SET counter=?,last_used_at=? WHERE id=? AND user_id=? AND counter=?").run(verified.authenticationInfo.newCounter,new Date().toISOString(),key.id,key.user_id,key.counter);
   if(Number(updated.changes)!==1)throw new Error("Passkey changed. Please try again.");
   const session=createUserSession(key.user_id);revokeRequestSession(req);
   const res=response(req,{ok:true},"");res.cookies.set(CHAT_COOKIE,session.token,{httpOnly:true,sameSite:"lax",secure:requestIsSecure(req),path:"/",maxAge:session.maxAge});return res;
  }
  return NextResponse.json({error:"Not found."},{status:404});
 }catch(error){
  const known=error instanceof Error&&["Invalid origin.","Passkeys require HTTPS.","Passkey request expired. Please try again.","Remove an old passkey before adding another."].includes(error.message);
  return NextResponse.json({error:known?(error as Error).message:"Could not complete the passkey request. Please try again."},{status:400,headers:{"Cache-Control":"no-store"}});
 }
}
