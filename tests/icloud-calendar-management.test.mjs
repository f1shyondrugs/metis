import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {CalendarManagement,registerManagementTools} from '../integrations/icloud-calendar/management.mjs';
const ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:school-test\r\nDTSTART;VALUE=DATE:20261113\r\nDTEND;VALUE=DATE:20261114\r\nSUMMARY:Exam\r\nRRULE:FREQ=YEARLY\r\nBEGIN:VALARM\r\nTRIGGER:-P7D\r\nACTION:DISPLAY\r\nDESCRIPTION:Week reminder\r\nEND:VALARM\r\nBEGIN:VALARM\r\nTRIGGER:-P2D\r\nACTION:DISPLAY\r\nDESCRIPTION:Two day reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
function fixture(){
 const calendars=[{id:'/user/calendars/source/',name:'Privat',readOnly:false,color:'#00FF00FF'},{id:'/user/calendars/target/',name:'Klassenarbeiten',readOnly:false,color:'#FF9500FF'}];
 const objects=new Map([['/user/calendars/source/school.ics',{data:ics,etag:'"v1"'}]]);
 const requests=new Map(),writes=[];
 const journal={fingerprint:value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),replay(id,op,fp){const row=requests.get(id);if(row){assert.equal(row.op,op);assert.equal(row.fp,fp);return row.result;}},async record(id,op,fp,result){requests.set(id,{op,fp,result});}};
 const client={home:'/user/calendars/',origin:'https://p01-caldav.icloud.com',async discover(){},safePath:value=>new URL(value,this?.origin??'https://p01-caldav.icloud.com').pathname,originForPath:()=> 'https://p01-caldav.icloud.com',
  async request(_path,method,body,headers){assert.equal(method,'PROPFIND');assert(body.includes('calendar-color'));assert.equal(headers.Depth,'1');return {body:JSON.stringify({multistatus:{response:calendars.map(c=>({href:c.id,propstat:{status:'HTTP/1.1 200 OK',prop:{'calendar-color':c.color}}}))}})};},
  async get(href){const found=objects.get(href);if(!found)throw Object.assign(Error('not found'),{code:'EVENT_NOT_FOUND'});return {...found,href};},
  async visibleGet(href){return this.get(href);},
  validateResponse(response){if(response.status>=400)throw Object.assign(Error('rejected'),{code:response.status===412?'ETAG_CONFLICT':'PERMISSION_DENIED'});},
  async fetchWithRedirects(href,method,body,headers){
   writes.push({href,method,body,headers});
   if(method==='MKCALENDAR'){calendars.push({id:href,name:'Klassenarbeiten & Prüfungen',readOnly:false,color:'#FF9500FF'});return {status:201,ok:true,text:async()=>''};}
   assert.equal(method,'MOVE');assert.equal(headers.Overwrite,'F');
   const dest=new URL(headers.Destination).pathname;
   if(objects.has(dest))return {status:412,ok:false,text:async()=>''};
   objects.set(dest,objects.get(href));objects.delete(href);
   return {status:201,ok:true,text:async()=>''};
  }};
 const service={listCalendars:async()=>calendars.map(({id,name,readOnly})=>({id,name,readOnly})),limiter:{take(){}},writeLimit:20};
 const management=new CalendarManagement(client,service,journal,{parse:JSON.parse});
 return {management,client,objects,calendars,writes};
}
const move={event_href:'/user/calendars/source/school.ics',destination_calendar_id:'/user/calendars/target/',expected_etag:'"v1"',expected_uid:'school-test',request_id:'exam-move-request-1'};
test('calendar creation escapes XML, normalizes color and serializes idempotent duplicates',async()=>{
 const {management,writes}=fixture();
 const input={name:'Klassenarbeiten & Prüfungen',color:'#ff9500',request_id:'create-calendar-test'};
 const [a,b]=await Promise.all([management.create(input),management.create(input)]);
 assert.deepEqual(a,b);assert.equal(writes.length,1);assert.equal(writes[0].method,'MKCALENDAR');
 assert(writes[0].body.includes('Klassenarbeiten &amp; Prüfungen'));assert.equal(a.calendar.color,'#FF9500FF');
 await assert.rejects(()=>management.create({...input,request_id:'another-request-id'}),error=>error.code==='ALREADY_EXISTS');
 assert.equal(writes.length,1);
});
test('atomic MOVE preserves complete ICS including alarms, UID and recurrence',async()=>{
 const {management,writes,objects}=fixture();
 const result=await management.move(move);
 assert.equal(result.moved,true);assert.equal(result.preserved_entire_ics,true);
 assert.equal(objects.get('/user/calendars/target/school.ics').data,ics);assert(!objects.has(move.event_href));
 assert.equal(writes.length,1);assert.equal(writes[0].headers['If-Match'],'"v1"');
 assert.deepEqual(await management.move(move),result);assert.equal(writes.length,1);
});
test('stale ETags, wrong UID, traversal and foreign calendars fail before mutation',async()=>{
 for(const patch of [{expected_etag:'"stale"'},{expected_uid:'other-uid'},{event_href:'/user/calendars/source/../school.ics'},{event_href:'//outside.example/school.ics'},{event_href:'/user/calendars/source/%2e%2e/school.ics'},{destination_calendar_id:'/other/calendars/'},{destination_calendar_id:'/user/calendars/source/'},{expected_etag:'bad\r\nInjected: header'}]){
  const {management,writes}=fixture();await assert.rejects(()=>management.move({...move,...patch}));assert.equal(writes.length,0);
 }
});
test('a destination collision never overwrites or deletes the original',async()=>{
 const {management,objects,writes}=fixture();objects.set('/user/calendars/target/school.ics',{data:'different event',etag:'"target"'});
 await assert.rejects(()=>management.move(move));assert.equal(objects.get(move.event_href).data,ics);
 assert.equal(objects.get('/user/calendars/target/school.ics').data,'different event');assert.equal(writes.length,1);
});
test('uncertain successful MOVE is reconciled once, without a second mutation',async()=>{
 const {management,client,writes}=fixture(),send=client.fetchWithRedirects.bind(client);
 client.fetchWithRedirects=async(...args)=>{await send(...args);throw Error('synthetic upstream failure');};
 assert.equal((await management.move(move)).moved,true);assert.equal(writes.length,1);
});
test('verification failure does not dispatch any recovery write',async()=>{
 const {management,client,objects,writes}=fixture(),send=client.fetchWithRedirects.bind(client);
 client.fetchWithRedirects=async(...args)=>{const result=await send(...args);objects.set('/user/calendars/target/school.ics',{data:ics.replace('-P7D','-P6D'),etag:'"changed"'});return result;};
 await assert.rejects(()=>management.move(move),error=>error.code==='VERIFY_FAILED');assert.equal(writes.length,1);
});
test('invalid names, colors and request IDs never send a request',async()=>{
 for(const input of [{name:'',color:'#FF9500FF',request_id:'valid-request'},{name:'Name\nInjected',color:'#FF9500',request_id:'valid-request'},{name:'Name',color:'red',request_id:'valid-request'},{name:'Name',color:'#FF9500',request_id:'bad'}]){
  const {management,writes}=fixture();await assert.rejects(()=>management.create(input));assert.equal(writes.length,0);
 }
});
test('new tool failures return safe codes, never raw upstream messages',async()=>{
 const chain={min(){return this;},max(){return this;},regex(){return this;}},z={string:()=>Object.create(chain)},registered=new Map();
 registerManagementTools({registerTool(name,definition,run){registered.set(name,{definition,run});}},{create:async()=>{throw Error('SYNTHETIC-SECRET-NEVER-RETURN');}},z);
 assert.deepEqual([...registered.keys()],['get_calendar_properties','create_calendar','move_event']);
 const result=await registered.get('create_calendar').run({});
 assert(result.isError);assert(!JSON.stringify(result).includes('SYNTHETIC-SECRET'));
});
