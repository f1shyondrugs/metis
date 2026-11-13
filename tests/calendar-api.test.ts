/* eslint-disable @typescript-eslint/no-require-imports -- Cold test modules load only after the isolated database environment is configured. */
import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";import os from "node:os";import path from "node:path";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"metis-calendar-api-"));
Object.assign(process.env,{AI_CHAT_ROOT:dir,CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"chat.sqlite"),AI_CHAT_SECRETS_KEY:Buffer.alloc(32,9).toString("hex"),MCP_BEARER_TOKEN:"SYNTHETIC-CALENDAR-BEARER"});
const auth=require("../lib/auth") as typeof import("../lib/auth"),store=require("../lib/calendar/store") as typeof import("../lib/calendar/store"),api=require("../app/api/calendar/route") as typeof import("../app/api/calendar/route");
const owner=auth.createUser("calendar-api-owner","SYNTHETIC-API-ONLY"),other=auth.createUser("calendar-api-other","SYNTHETIC-OTHER-ONLY");
const token=auth.authenticateUser("calendar-api-owner","SYNTHETIC-API-ONLY")!.token,otherToken=auth.authenticateUser("calendar-api-other","SYNTHETIC-OTHER-ONLY")!.token;
const group=store.ensureCalendar(owner.id);
function req(body?:unknown,session=token,origin="http://localhost"){return new Request("http://localhost/api/calendar",{method:body?"POST":"GET",headers:{"Content-Type":"application/json",...(session?{cookie:"ai_chat_auth="+session}:{}),origin},...(body?{body:JSON.stringify(body)}:{})});}
test("calendar API enforces sessions and request origins",async()=>{
 assert.equal((await api.GET(req(undefined,""))).status,401);assert.equal((await api.POST(req({action:"sync"},""))).status,401);
 assert.equal((await api.POST(req({action:"sync"},token,"https://foreign.invalid"))).status,403);
 const data=await (await api.GET(req())).json();assert.ok(data.calendars.some((c:{id:string})=>c.id===group.id));assert.ok(!JSON.stringify(data).includes("SYNTHETIC-CALENDAR-BEARER"));
});
test("calendar API uses canonical event writes, private results and owner-scoped reads",async()=>{
 const r=await api.POST(req({action:"save",event:{calendarId:group.id,title:"API event",start:"2026-11-13T09:00:00Z",end:"2026-11-13T10:00:00Z",idempotencyKey:"api-one"}}));assert.equal(r.status,201);assert.equal(r.headers.get("cache-control"),"private, no-store");const {event}=await r.json();assert.ok(!("ics" in event));
 const foreign=new Request("http://localhost/api/calendar?id="+event.id,{headers:{cookie:"ai_chat_auth="+otherToken}});assert.equal((await api.GET(foreign)).status,404);
 assert.equal((await api.POST(req({action:"delete",id:event.id,version:999}))).status,409);
 assert.equal((await api.POST(req({action:"save",event:{calendarId:group.id,title:"Bad",start:"invalid",end:"invalid"}}))).status,400);
});
test("Google OAuth state is account bound, one use, PKCE and metadata-only",async()=>{
 const oauth=require("../lib/calendar/oauth") as typeof import("../lib/calendar/oauth");
 assert.throws(()=>oauth.configureCalendarOAuth(owner.id,"not-google","SYNTHETIC-SECRET"),/valid Google/);
 oauth.configureCalendarOAuth(owner.id,"synthetic.apps.googleusercontent.com","SYNTHETIC-CLIENT-SECRET");
 const setup=oauth.calendarOAuthSetup(owner.id);assert.equal(setup.configured,true);assert.equal(oauth.calendarOAuthSetup(other.id).configured,false);
 const {url}=await oauth.startCalendarOAuth(owner.id),u=new URL(url);assert.equal(u.hostname,"accounts.google.com");assert.equal(u.searchParams.get("code_challenge_method"),"S256");assert.equal(u.searchParams.get("access_type"),"offline");assert.ok(u.searchParams.get("state"));
 const state=u.searchParams.get("state")!;await assert.rejects(oauth.finishCalendarOAuth(other.id,state,"synthetic-code"),/another account/);
 assert.ok(!JSON.stringify(await(await api.GET(req())).json()).includes("SYNTHETIC-CLIENT-SECRET"));
 // Expire the state rather than calling Google's token endpoint during a test.
 store.calendarDb().prepare("UPDATE calendar_oauth SET expires=0").run();await assert.rejects(oauth.finishCalendarOAuth(owner.id,state,"synthetic-code"),/expired/);
});
test("native migration refuses arbitrary legacy Google credential files",async()=>{
 const migration=require("../lib/calendar/migration") as typeof import("../lib/calendar/migration");
 await assert.rejects(migration.importLegacyCalendarConnection(owner.id,"google"),/Legacy token files are not imported/);
});
test("bounded JSON requests reject streamed oversized bodies without Content-Length",async()=>{
 const request=new Request("http://localhost/api/calendar",{method:"POST",headers:{cookie:"ai_chat_auth="+token,origin:"http://localhost"},body:JSON.stringify({action:"save",padding:"x".repeat(65000)})});
 assert.equal((await api.POST(request)).status,413);
});
test("native calendar agent tools enforce active leases, account binding and Incognito",async(t)=>{
 const [chats,jobs,route,gateway]=await Promise.all([import("../lib/db-store"),import("../lib/db-jobs"),import("../app/api/internal/mcp-calendar/route"),import("../lib/mcp-core/gateway-core.mjs")]);
 const chat=chats.createChat("Calendar tool test",undefined,owner.id),job=jobs.enqueueJob({chatId:chat.id,userId:owner.id,message:"Calendar test"}),claimed=jobs.claimNextJob({workerId:"calendar-test-worker"})!;assert.equal(claimed.id,job.id);
 const headers={Authorization:"Bearer SYNTHETIC-CALENDAR-BEARER","Content-Type":"application/json","x-ai-chat-user-id":owner.id,"x-ai-chat-id":chat.id,"x-ai-chat-job-id":job.id,"x-ai-chat-worker-id":claimed.leaseOwner!,"x-ai-chat-lease-token":claimed.leaseToken!};
 const direct=(body:unknown,patch:Record<string,string>={})=>route.POST(new Request("http://localhost/api/internal/mcp-calendar",{method:"POST",headers:{...headers,...patch},body:JSON.stringify(body)}));
 assert.equal((await direct({action:"calendars"},{Authorization:"Bearer wrong"})).status,401);
 assert.equal((await direct({action:"calendars"},{"x-ai-chat-lease-token":""})).status,401);
 assert.equal((await direct({action:"calendars"},{"x-ai-chat-user-id":other.id})).status,403);
 assert.equal((await direct({action:"calendars"},{"x-ai-chat-incognito":"1"})).status,403);
 const context={userId:owner.id,chatId:chat.id,jobId:job.id,workerId:claimed.leaseOwner!,leaseToken:claimed.leaseToken!,source:"agent",runtimeMode:"full-access"};
 t.mock.method(globalThis,"fetch",async(input:string|URL|Request,init?:RequestInit)=>{const r=new Request(input,init);return new URL(r.url).pathname==="/api/internal/mcp-calendar"?route.POST(r):Response.json({waitingForUser:false,required:false});});
 const call=(name:string,args:Record<string,unknown>,override={})=>gateway.dispatchGatewayTool(name,args,{auditCall:false,context:{...context,...override}});
 const parse=(r:{isError?:boolean;content?:Array<{type:string;text?:string}>})=>{assert.equal(r.isError===true,false,JSON.stringify(r));return JSON.parse(r.content?.find(x=>x.type==="text")?.text||"{}");};
 for(const name of ["calendar_list_calendars","calendar_list_events","calendar_get_event","calendar_create_event","calendar_update_event","calendar_delete_event"])assert.ok(gateway.tools.some((t:{name:string})=>t.name===name));
 const payload={calendarId:group.id,title:"Agent event",start:"2026-11-13T14:00:00Z",end:"2026-11-13T15:00:00Z",idempotencyKey:"agent-event"};
 const e=parse(await call("calendar_create_event",payload)).event;assert.ok(!("ics" in e));
 assert.equal(parse(await call("calendar_create_event",payload)).event.id,e.id);
 assert.equal(parse(await call("calendar_get_event",{id:e.id})).event.title,"Agent event");
 assert.equal((await call("calendar_get_event",{id:e.id},{incognito:true})).isError,true);
 assert.equal((await call("calendar_get_event",{id:e.id},{leaseToken:"wrong"})).isError,true);
 assert.equal(parse(await call("calendar_delete_event",{id:e.id,version:e.version})).deleted,true);
});
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
