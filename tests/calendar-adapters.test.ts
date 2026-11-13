/* eslint-disable @typescript-eslint/no-require-imports -- Cold test modules load only after the isolated database environment is configured. */
import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";import os from "node:os";import path from "node:path";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"metis-calendar-dav-"));
Object.assign(process.env,{AI_CHAT_ROOT:dir,CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"chat.sqlite"),AI_CHAT_SECRETS_KEY:Buffer.alloc(32,4).toString("hex")});
const auth=require("../lib/auth") as typeof import("../lib/auth"),connections=require("../lib/calendar/connections") as typeof import("../lib/calendar/connections"),adapterModule=require("../lib/calendar/adapters") as typeof import("../lib/calendar/adapters"),ical=require("../lib/calendar/ical") as typeof import("../lib/calendar/ical");
const owner=auth.createUser("dav-owner","SYNTHETIC-DAV-ONLY").id;
const c=connections.saveCalendarCredentials(owner,"google",{clientId:"synthetic",clientSecret:"SYNTHETIC",refreshToken:"SYNTHETIC",accessToken:"SYNTHETIC",expiry:Date.now()+86400000});
const remoteCalendar={id:"synthetic@example.test",name:"Privat",color:"#aabbcc",writable:true,url:"https://apidata.googleusercontent.com/caldav/v2/synthetic%40example.test/events/"};
const nativeFetch=global.fetch;let current:{ics:string;etag:string}|undefined,puts=0,reports=0,deny=false,expired=false,loseOnce=false,conflict=false;
const raw=ical.writeEvent({calendarId:"unused",title:"DAV item",start:"2026-11-13T09:00:00Z",end:"2026-11-13T10:00:00Z",timeZone:"UTC"},"dav-item@synthetic");
global.fetch=async(input,init)=>{
 const url=String(input),method=String(init?.method||"GET").toUpperCase();
 assert.ok(url.startsWith("https://apidata.googleusercontent.com/")||url.startsWith("https://www.googleapis.com/"),"no untrusted network");
 if(deny)return new Response("Never expose provider response or tokens",{status:403});
 if(url.includes("/users/me/calendarList"))return Response.json({items:[{id:remoteCalendar.id,summary:"Privat",backgroundColor:"#aabbcc",accessRole:"owner"}]});
 if(method==="REPORT"){
  reports++;if(expired){expired=false;return new Response('<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>',{status:403});}
  const item=current?'<d:response><d:href>'+remoteCalendar.url+'item.ics</d:href><d:propstat><d:prop><d:getetag>'+current.etag+'</d:getetag><c:calendar-data><![CDATA['+current.ics+']]></c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>':"";
  return new Response('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'+item+'<d:sync-token>token-'+reports+'</d:sync-token></d:multistatus>',{status:207,headers:{"Content-Type":"application/xml"}});
 }
 if(method==="PUT"){puts++;if(conflict)return new Response(null,{status:412});current={ics:String(init?.body),etag:'"v'+puts+'"'};if(loseOnce){loseOnce=false;throw Error("Synthetic lost write reply");}return new Response(null,{status:201});}
 if(method==="DELETE"){current=undefined;return new Response(null,{status:204});}
 if(method==="GET")return current?new Response(current.ics,{headers:{etag:current.etag}}):new Response(null,{status:404});
 throw Error("Unexpected request "+method);
};
test("native URL policy rejects credential forwarding, arbitrary hosts and cross-calendar objects",()=>{
 for(const u of ["http://127.0.0.1/a","https://evil.invalid/a","https://apidata.googleusercontent.com@evil.invalid/a","https://www.googleapis.com:444/a"])assert.throws(()=>adapterModule.allowedCalendarUrl("google",u));
 assert.throws(()=>adapterModule.remoteObjectUrl("google",remoteCalendar,"../other/item.ics"),/outside/);
 assert.throws(()=>adapterModule.allowedCalendarUrl("icloud","https://www.googleapis.com/a"));
});
test("Google adapter performs native CalDAV incremental sync and conditional writes",async()=>{
 const adapter=await adapterModule.createCalendarAdapter(owner,c.id);const calendars=await adapter.calendars();assert.equal(calendars[0].writable,true);
 const first=await adapter.pull(remoteCalendar,"");assert.equal(first.full,true);assert.ok(first.token);assert.equal(first.objects.length,0);
 const saved=await adapter.put(remoteCalendar,remoteCalendar.url+"item.ics",raw);assert.ok(saved.etag);assert.equal(puts,1);
 const next=await adapter.pull(remoteCalendar,first.token);assert.equal(next.full,false);assert.equal(next.objects.length,1);
 await adapter.put(remoteCalendar,saved.id,raw,saved.etag);assert.equal(puts,1,"identical object does not echo");
 expired=true;await assert.rejects(adapter.pull(remoteCalendar,next.token),(e:unknown)=>(e as {code:string}).code==="token_expired");
 current={ics:ical.writeEvent({calendarId:"unused",title:"Concurrent remote edit",start:"2026-11-13T09:00:00Z",end:"2026-11-13T10:00:00Z"},"dav-item@synthetic"),etag:'"concurrent"'};
 await assert.rejects(adapter.put(remoteCalendar,saved.id,raw,saved.etag),/changed/);assert.equal(puts,1);conflict=true;await assert.rejects(adapter.put(remoteCalendar,saved.id,raw,current.etag),/changed/);conflict=false;
});
test("ambiguous create replies reconcile with GET rather than create duplicates",async()=>{
 current=undefined;const adapter=await adapterModule.createCalendarAdapter(owner,c.id);loseOnce=true;
 await assert.rejects(adapter.put(remoteCalendar,remoteCalendar.url+"item.ics",raw),/lost write reply/);const count=puts;
 await adapter.put(remoteCalendar,remoteCalendar.url+"item.ics",raw);assert.equal(puts,count);
});
test("provider rejection is safe and does not expose raw responses",async()=>{
 const adapter=await adapterModule.createCalendarAdapter(owner,c.id);deny=true;
 await assert.rejects(adapter.calendars(),e=>e instanceof Error&&!e.message.includes("Never expose")&&e.message.includes("permissions"));deny=false;
});
test("iCloud discovery, privileges and MKCALENDAR use valid DAV namespaces",async(t)=>{
 const apple=connections.saveCalendarCredentials(owner,"icloud",{username:"synthetic@example.test",password:"SYNTHETIC-APPLE"});
 const principal="https://p01-caldav.icloud.com/123/principal/",home="https://p01-caldav.icloud.com/123/calendars/",url=home+"private/";let created=false;
 const multi=(href:string,props:string)=>new Response('<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ca="http://apple.com/ns/ical/"><d:response><d:href>'+href+'</d:href><d:propstat><d:prop>'+props+'</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',{status:207,headers:{"Content-Type":"application/xml"}});
 t.mock.method(globalThis,"fetch",async(input:string|URL|Request,init?:RequestInit)=>{
  const u=String(input),body=String(init?.body||""),method=String(init?.method||"GET").toUpperCase();
  assert.ok(u.startsWith("https://caldav.icloud.com")||u.startsWith("https://p01-caldav.icloud.com/"));
  assert.ok(!body.includes("apple:calendar-color"),"never emit an undeclared XML prefix");
  if(method==="MKCALENDAR"){assert.ok(body.includes("xmlns:ca="));assert.ok(body.includes("ca:calendar-color"));assert.ok(body.includes("Counterpart"));created=true;return new Response(null,{status:201});}
  if(body.includes("current-user-principal"))return multi(u,'<d:current-user-principal><d:href>'+principal+'</d:href></d:current-user-principal>');
  if(body.includes("calendar-home-set"))return multi(principal,'<c:calendar-home-set><d:href>'+home+'</d:href></c:calendar-home-set>');
  if(body.includes("supported-report-set"))return multi(url,'<d:supported-report-set><d:supported-report><d:report><d:sync-collection/></d:report></d:supported-report></d:supported-report-set>');
  if(u===home)return multi(url,'<d:displayname>Privat</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><ca:calendar-color>#AABBCCFF</ca:calendar-color><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>');
  return new Response(null,{status:200});
 });
 const adapter=await adapterModule.createCalendarAdapter(owner,apple.id),calendars=await adapter.calendars();assert.equal(calendars.length,1);assert.equal(calendars[0].writable,true);assert.equal(calendars[0].color,"#AABBCC");
 await adapter.createCalendar("Counterpart","#123456");assert.equal(created,true);
});
test.after(()=>{global.fetch=nativeFetch;fs.rmSync(dir,{recursive:true,force:true});});
