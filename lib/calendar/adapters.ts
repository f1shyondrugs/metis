import {createDAVClient,syncCollection,calendarMultiGet,makeCalendar} from "tsdav";
import {xml2js} from "xml-js";
import {OAuth2Client} from "google-auth-library";
import {createHash,randomUUID} from "node:crypto";
import {CalendarError,type CalendarAdapter,type CalendarProvider,type RemoteCalendar,type RemoteObject} from "./types";
import {calendarSecrets,refreshCalendarCredentials} from "./connections";
import {normalizedEventHash} from "./ical";
const MAX_BODY=16*1024*1024;
export function allowedCalendarUrl(provider:CalendarProvider,value:string){
 const u=new URL(value);if(u.protocol!=="https:"||u.port||u.username||u.password||u.hash)throw new CalendarError("Invalid calendar server.",400);
 const valid=provider==="icloud"?(u.hostname==="caldav.icloud.com"||/^p[0-9]+-caldav\.icloud\.com$/.test(u.hostname)):["apidata.googleusercontent.com","www.googleapis.com"].includes(u.hostname);
 if(!valid)throw new CalendarError("Untrusted calendar server.",400);
 return u;
}
export function remoteObjectUrl(provider:CalendarProvider,calendar:RemoteCalendar,id:string){
 const base=allowedCalendarUrl(provider,calendar.url),u=allowedCalendarUrl(provider,new URL(id,base).href);
 if(u.origin!==base.origin||!u.pathname.startsWith(base.pathname.replace(/\/?$/,"/"))||u.search)throw new CalendarError("Calendar item is outside this calendar.",400);
 return u.href;
}
function textValue(v:unknown):string{if(typeof v==="string")return v;if(v&&typeof v==="object"){const o=v as Record<string,unknown>;return textValue(o._text??o._cdata??"");}return "";}
function safeError(status:number){return status===401?new CalendarError("Reconnect this calendar account.",401,"reconnect"):status===403?new CalendarError("This account cannot access the calendar. Check its sharing permissions and enabled Google Calendar/CalDAV APIs.",403,"permission"):status===429?new CalendarError("Calendar rate limit reached. Sync will retry later.",429,"rate_limit"):new CalendarError("Calendar service is temporarily unavailable.",502,"remote");}
export async function createCalendarAdapter(owner:string,id:string):Promise<CalendarAdapter>{
 const {row,secrets}=calendarSecrets(owner,id),provider=row.provider;
 let authorization="";
 if(provider==="icloud")authorization="Basic "+Buffer.from(secrets.username+":"+secrets.password).toString("base64");
 else{
  const oauth=new OAuth2Client(secrets.clientId,secrets.clientSecret);oauth.setCredentials({refresh_token:secrets.refreshToken,access_token:secrets.accessToken,expiry_date:secrets.expiry});
  try{const t=await oauth.getAccessToken();if(!t.token)throw Error();authorization="Bearer "+t.token;
   if(oauth.credentials.access_token!==secrets.accessToken)refreshCalendarCredentials(owner,id,row.version,{...secrets,accessToken:t.token,expiry:oauth.credentials.expiry_date||undefined});
  }catch{throw new CalendarError("Reconnect Google Calendar.",401,"reconnect");}
 }
 let reportBody="";
 const remoteFetch:typeof fetch=async(input,init)=>{
  let url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
  for(let redirects=0;redirects<4;redirects++){
   allowedCalendarUrl(provider,url);
   const headers=new Headers(init?.headers);headers.set("Authorization",authorization);
   const response=await fetch(url,{...init,headers,redirect:"manual",signal:AbortSignal.timeout(30000)});
   if([301,302,307,308].includes(response.status)){const location=response.headers.get("location");if(!location)throw new CalendarError("Invalid calendar redirect.",502);url=new URL(location,url).href;continue;}
   if(response.status===401||response.status===429)throw safeError(response.status);
   if(response.status===403&&String(init?.method).toUpperCase()!=="REPORT")throw safeError(403);
   const parts:Uint8Array[]=[];let size=0;const reader=response.body?.getReader();if(reader){try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>MAX_BODY){await reader.cancel();throw new CalendarError("Calendar response exceeds the import limit.",413);}parts.push(r.value);}}finally{reader.releaseLock();}}const data=Buffer.concat(parts);
   if(response.status===207&&String(init?.method).toUpperCase()==="REPORT")reportBody=data.toString("utf8");
   if(response.status===403){if(data.toString("utf8").includes("valid-sync-token"))throw new CalendarError("Calendar sync token expired.",409,"token_expired");throw safeError(403);}
   const result=new Response([204,205,304].includes(response.status)?null:data,{status:response.status,statusText:response.statusText,headers:response.headers});Object.defineProperty(result,"url",{value:url});return result;
  }
  throw new CalendarError("Too many calendar redirects.",502);
 };
 const client=provider==="icloud"?await createDAVClient({serverUrl:"https://caldav.icloud.com",credentials:{username:secrets.username,password:secrets.password},authMethod:"Basic",defaultAccountType:"caldav",fetch:remoteFetch}):null;
 let knownCalendars:RemoteCalendar[]=[];
 async function calendars():Promise<RemoteCalendar[]>{
  if(client){
   const rows=await client.fetchCalendars({props:{"d:displayname":{},"d:resourcetype":{},"c:supported-calendar-component-set":{},"cs:getctag":{},"d:sync-token":{},"ca:calendar-color":{},"d:current-user-privilege-set":{}},projectedProps:{currentUserPrivilegeSet:true}});
   if(rows.length>200)throw new CalendarError("Too many remote calendars.",413);
   return knownCalendars=rows.filter(c=>c.components?.includes("VEVENT")).map(c=>{const privilege=JSON.stringify(c.projectedProps?.currentUserPrivilegeSet||{});return {id:c.url,url:allowedCalendarUrl(provider,c.url).href,name:String(c.displayName||"Calendar"),color:(c.calendarColor||"#818cf8").slice(0,7),writable:/"write"|"write-content"|"all"/.test(privilege)};});
  }
  const all:RemoteCalendar[]=[];let page="";
  do{const u=new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");u.searchParams.set("maxResults","250");if(page)u.searchParams.set("pageToken",page);const r=await remoteFetch(u);if(!r.ok)throw safeError(r.status);const data=await r.json();
   for(const c of data.items||[])all.push({id:c.id,name:c.summaryOverride||c.summary||"Calendar",color:c.backgroundColor||"#818cf8",writable:["owner","writer"].includes(c.accessRole),url:"https://apidata.googleusercontent.com/caldav/v2/"+encodeURIComponent(c.id)+"/events/"});
   page=data.nextPageToken||"";if(all.length>200)throw new CalendarError("Too many remote calendars.",413);
  }while(page);
  knownCalendars=all;return all;
 }
 async function getObject(calendar:RemoteCalendar,id:string):Promise<RemoteObject>{
  const url=remoteObjectUrl(provider,calendar,id),r=await remoteFetch(url);
  if(r.status===404||r.status===410)return {id:url,etag:"",deleted:true};
  if(!r.ok)throw safeError(r.status);
  const ics=await r.text(),etag=r.headers.get("etag")||"";if(!etag)throw new CalendarError("Calendar server did not provide a version.",502);
  return {id:url,ics,etag};
 }
 return{
  calendars,
  async createCalendar(name,color){
   if(provider==="google"){const r=await remoteFetch("https://www.googleapis.com/calendar/v3/calendars",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({summary:name})});if(!r.ok)throw safeError(r.status);const c=await r.json();return {id:c.id,url:"https://apidata.googleusercontent.com/caldav/v2/"+encodeURIComponent(c.id)+"/events/",name,color,writable:true};}
   const known=knownCalendars;const parent=known[0]&&new URL("../",known[0].url).href;if(!parent)throw new CalendarError("No writable iCloud calendar home was found.",403);
   const url=new URL(randomUUID()+"/",parent).href;
   const result=await makeCalendar({url,props:{"d:displayname":name,"c:supported-calendar-component-set":{"c:comp":{_attributes:{name:"VEVENT"}}},"ca:calendar-color":color+"FF"},fetch:remoteFetch});
   if(result.some(r=>!r.ok))throw new CalendarError("Could not create the iCloud calendar.",502);
   return {id:url,url,name,color,writable:true};
  },
  async pull(calendar,token){
   reportBody="";const response=await syncCollection({url:allowedCalendarUrl(provider,calendar.url).href,syncLevel:1,syncToken:token||"",props:{"d:getetag":{},"c:calendar-data":{}},fetch:remoteFetch});
   if(response.some(r=>[403,409,410].includes(r.status)))throw new CalendarError("Calendar sync token expired.",409,"token_expired");
   if(response.some(r=>!r.ok&&r.status!==404))throw new CalendarError("Calendar sync was incomplete. No deletions were applied.",502);
   let nextToken=textValue(response[0]?.raw?.multistatus?.syncToken);if(!nextToken&&reportBody){const xml=xml2js(reportBody,{compact:true,ignoreDoctype:true}) as Record<string,unknown>;const root=Object.entries(xml).find(([key])=>key.split(":").pop()==="multistatus")?.[1] as Record<string,unknown>|undefined;nextToken=textValue(Object.entries(root||{}).find(([key])=>key.split(":").pop()==="sync-token")?.[1]);}reportBody="";if(!nextToken)throw new CalendarError("Calendar server did not return a sync token. No changes were applied.",502);
   const rows=response.filter(r=>r.href&&new URL(r.href,calendar.url).href!==calendar.url);
   if(rows.length>10000)throw new CalendarError("Calendar import limit reached. No partial sync was applied.",413);
   const objects:RemoteObject[]=[],missing:string[]=[];
   for(const r of rows){const url=remoteObjectUrl(provider,calendar,r.href!);if(r.status===404){objects.push({id:url,etag:"",deleted:true});continue;}const data=textValue(r.props?.calendarData),etag=textValue(r.props?.getetag);if(data&&etag)objects.push({id:url,etag,ics:data});else missing.push(url);}
   for(let i=0;i<missing.length;i+=100){const found=await calendarMultiGet({url:calendar.url,objectUrls:missing.slice(i,i+100).map(url=>new URL(url).pathname),props:{"d:getetag":{},"c:calendar-data":{}},depth:"1",fetch:remoteFetch});for(const r of found){if(!r.ok)throw new CalendarError("Calendar changed during import. Retry sync.",409);const ics=textValue(r.props?.calendarData),etag=textValue(r.props?.getetag);if(!ics||!etag||!r.href)throw new CalendarError("Incomplete calendar item.",502);objects.push({id:remoteObjectUrl(provider,calendar,r.href),etag,ics});}if(found.length!==missing.slice(i,i+100).length)throw new CalendarError("Incomplete calendar import.",502);}
   return {objects,token:nextToken,full:!token};
  },
  async put(calendar,id,ics,etag){
   if(!calendar.writable)throw new CalendarError("This calendar is read-only.",403);
   const url=remoteObjectUrl(provider,calendar,id||createHash("sha256").update(ics).digest("hex")+".ics"),current=await getObject(calendar,url);
   if(!current.deleted&&normalizedEventHash(current.ics!)===normalizedEventHash(ics))return current;
   if((etag&&current.etag!==etag)||(!etag&&!current.deleted))throw new CalendarError("Remote event changed. Resolve the conflict before syncing.",409,"conflict");
   const r=await remoteFetch(url,{method:"PUT",headers:{"Content-Type":"text/calendar; charset=utf-8",...(etag?{"If-Match":etag}:provider==="icloud"?{"If-None-Match":"*"}:{})},body:ics});
   if(r.status===412)throw new CalendarError("Remote event changed.",409,"conflict");if(!r.ok)throw safeError(r.status);
   const saved=await getObject(calendar,url);if(saved.deleted||normalizedEventHash(saved.ics!)!==normalizedEventHash(ics))throw new CalendarError("The provider could not preserve this event. Its original is retained.",409,"unsupported");
   return saved;
  },
  async remove(calendar,id,etag){
   if(!calendar.writable)throw new CalendarError("This calendar is read-only.",403);
   const current=await getObject(calendar,id);if(current.deleted)return;
   if(current.etag!==etag)throw new CalendarError("Remote event changed before deletion.",409,"conflict");
   const r=await remoteFetch(remoteObjectUrl(provider,calendar,id),{method:"DELETE",headers:{"If-Match":etag}});
   if(r.status===412)throw new CalendarError("Remote event changed before deletion.",409,"conflict");if(!r.ok&&r.status!==404)throw safeError(r.status);
  }
 };
}
