import test,{after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomBytes} from "node:crypto";
import http from "node:http";
import {EventEmitter} from "node:events";

const dir=mkdtempSync(path.join(os.tmpdir(),"metis-vault-management-"));
Object.assign(process.env,{AI_CHAT_ROOT:dir,CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"chat.sqlite"),AGENT_CWD:dir,METIS_PROTECTED_LOGIN_MODE:"trusted-root",METIS_NATIVE_ISOLATION:"0"});
const imports=Promise.all([import("../services/browser-login/core"),import("../lib/auth"),import("../app/api/browser/saved-logins/route"),import("../lib/protected-login-errors")]);
after(()=>rmSync(dir,{recursive:true,force:true}));
test("manual additions use the existing owner/origin-bound encrypted vault without overwriting entries",async()=>{
 const [{SavedBrowserLogins},,,{ProtectedLoginError}]=await imports;
 const file=path.join(dir,"manual.sqlite"),key=randomBytes(32),core=new SavedBrowserLogins(key,file);
 const call=(owner:string,operation:string,input:Record<string,unknown>,management=true)=>core.dispatch({owner,operation,input},management);
 try{
  const secret="SYNTHETIC-MANUAL-SECRET-9842",values={origin:"https://portal.test/sign-in?public=1",password:secret,username:"SYNTHETIC-IDENTITY"};
  assert.equal((await call("alice","create",values)).status,"created");
  assert.equal(values.password,"","temporary request values are cleared");
  assert(!JSON.stringify(await call("alice","list",{})).includes(secret));
  assert.deepEqual((await call("bob","list",{})).credentials,[]);
  await assert.rejects(call("alice","create",{origin:"https://portal.test/other",password:"REPLACEMENT"}),error=>error instanceof ProtectedLoginError&&error.code==="credential_exists");
  for(const origin of ["http://portal.test","https://user:pw@portal.test","https://portal.test:444"])await assert.rejects(call("alice","create",{origin,password:"TEST"}));
  await assert.rejects(call("alice","create",{origin:"https://other.test",password:"TEST"},false));
  await assert.rejects(call("alice","create",{origin:"https://other.test",kind:"console",password:"TEST"}));
  assert(!readFileSync(file).includes(Buffer.from(secret)));
 }finally{await core.close();}
 const reopened=new SavedBrowserLogins(key,file);
 try{assert.deepEqual((await reopened.dispatch({owner:"alice",operation:"list"},true)).credentials,[{origin:"https://portal.test"}]);}finally{await reopened.close();}
});
test("the owner API enforces cookies, same-origin writes, strict payloads and safe conflict messages",async t=>{
 const [{SavedBrowserLogins},auth,route,{ProtectedLoginError,protectedLoginFailure}]=await imports;
 const core=new SavedBrowserLogins(randomBytes(32),path.join(dir,"api-vault.sqlite"));
 t.after(()=>core.close());
 const a=auth.createUser("vault-owner","TEST-OWNER-LOGIN"),b=auth.createUser("vault-other","TEST-OTHER-LOGIN");
 const cookieA="ai_chat_auth="+auth.authenticateUser(a.username,"TEST-OWNER-LOGIN")!.token;
 const cookieB="ai_chat_auth="+auth.authenticateUser(b.username,"TEST-OTHER-LOGIN")!.token;
 const calls:Array<{owner:string;input:Record<string,unknown>}>=[];
 t.mock.method(http,"request",(_options:unknown,callback:(response:EventEmitter&{statusCode?:number})=>void)=>{
  const request=new EventEmitter() as EventEmitter&{end:(body:string)=>void};
  request.end=body=>{void(async()=>{
   const payload=JSON.parse(body);calls.push({owner:payload.owner,input:{...payload.input}});
   let responseBody:unknown,status=200;
   try{responseBody=await core.dispatch(payload,payload.management===true);}
   catch(error){responseBody=protectedLoginFailure(error instanceof ProtectedLoginError?error:undefined);status=400;}
   const response=Object.assign(new EventEmitter(),{statusCode:status});callback(response);
   response.emit("data",Buffer.from(JSON.stringify(responseBody)));response.emit("end");
  })();};
  return request;
 });
 const input={action:"create",origin:"https://portal.test/login",password:"SYNTHETIC-API-SECRET"};
 const req=(body:unknown,cookie=cookieA,origin="https://metis.test")=>new Request("https://metis.test/api/browser/saved-logins",{method:"POST",headers:{cookie,origin,host:"metis.test","content-type":"application/json"},body:JSON.stringify(body)});
 assert.equal((await route.POST(req(input,""))).status,401);
 assert.equal((await route.POST(req(input,cookieA,"https://other.test"))).status,403);
 assert.equal((await route.POST(req({...input,owner:b.id}))).status,400);
 const saved=await route.POST(req(input));assert.equal(saved.status,200);assert.equal(saved.headers.get("cache-control"),"no-store");
 assert(!JSON.stringify(await saved.json()).includes(input.password));assert.equal(calls.at(-1)!.owner,a.id);
 const duplicate=await route.POST(req(input));assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).code,"credential_exists");
 assert.equal((await route.POST(req(input,cookieB))).status,200,"same website in another owner vault stays independent");
 const listed=await route.GET(new Request("https://metis.test/api/browser/saved-logins",{headers:{cookie:cookieA}}));
 assert.equal(listed.status,200);assert(!JSON.stringify(await listed.json()).includes(input.password));
});
