import {createHash} from 'node:crypto';

export class ManagementError extends Error {
  constructor(code,message){super(message);this.code=code;}
}
const fail=(code,message)=>{throw new ManagementError(code,message);};
const xml=value=>String(value).replace(/[<>&"']/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[char]));
const many=value=>value===undefined?[]:Array.isArray(value)?value:[value];
const digest=value=>createHash('sha256').update(value.replace(/\r\n/g,'\n').trim()).digest('hex');
const color=value=>{if(!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value))fail('INVALID_INPUT','Use a hexadecimal calendar color.');return value.toUpperCase()+(value.length===7?'FF':'');};

export class CalendarManagement {
  constructor(client,service,journal,parser){Object.assign(this,{client,service,journal,parser});this.queue=Promise.resolve();}
  serial(run){const next=this.queue.then(run,run);this.queue=next.catch(()=>{});return next;}
  async idempotent(operation,id,input,run){
    if(!/^[A-Za-z0-9._:-]{8,128}$/.test(id))fail('INVALID_INPUT','Use a stable request ID.');
    return this.serial(async()=>{
      const fingerprint=this.journal.fingerprint(input),saved=this.journal.replay(id,operation,fingerprint);
      if(saved!==undefined)return saved;
      const result=await run();await this.journal.record(id,operation,fingerprint,result);return result;
    });
  }
  async properties(){
    const calendars=await this.service.listCalendars();
    await this.client.discover();
    const response=await this.client.request(this.client.home,'PROPFIND','<d:propfind xmlns:d="DAV:" xmlns:a="http://apple.com/ns/ical/"><d:prop><a:calendar-color/></d:prop></d:propfind>',{Depth:'1'});
    const colors=new Map();
    for(const item of many(this.parser.parse(response.body).multistatus?.response)){
      const props=many(item.propstat).filter(p=>/ 200(?: |$)/.test(String(p.status))).map(p=>p.prop??{});
      const value=props.map(p=>p['calendar-color']).find(v=>typeof v==='string');
      if(value)colors.set(this.client.safePath(String(item.href)),value.toUpperCase());
    }
    return calendars.map(item=>({...item,color:colors.get(item.id)??null}));
  }
  async create({name,color:requested,request_id}){
    if(typeof name!=='string'||!name.trim()||name.length>200||/[\x00-\x1f]/.test(name))fail('INVALID_INPUT','Use a nonempty calendar name.');
    const normalized=color(requested);
    return this.idempotent('create_calendar',request_id,{name,color:normalized},async()=>{
      const before=await this.properties();
      if(before.some(item=>item.name===name))fail('ALREADY_EXISTS','A calendar with this name already exists; select its ID instead.');
      const hex=createHash('sha256').update('metis-calendar:'+request_id).digest('hex').slice(0,32);
      const uuid=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
      const id=this.client.home.replace(/\/?$/,'/')+uuid+'/';
      const body='<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:set><d:prop><d:displayname>'+xml(name)+'</d:displayname><a:calendar-color>'+normalized+'</a:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>';
      this.service.limiter.take('write',this.service.writeLimit);
      // Mutations are dispatched once; reconcile uncertain responses without replay.
      let mutationError;
      try{
        const response=await this.client.fetchWithRedirects(id,'MKCALENDAR',body,{'Content-Type':'application/xml; charset=utf-8'});
        this.client.validateResponse(response);
        if(!response.ok)fail('CREATE_REJECTED','iCloud rejected calendar creation.');
        await response.text();
      }catch(error){mutationError=error;}
      const after=await this.properties(),created=after.find(item=>item.id===id&&item.name===name);
      if(!created)throw mutationError??new ManagementError('VERIFY_FAILED','Created calendar could not be verified.');
      if(!created.color||color(created.color)!==normalized)fail('COLOR_NOT_APPLIED','The calendar exists, but its requested color was not verified.');
      return {calendar:created,created:true};
    });
  }
  checkedPath(value){
    if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\r\n\\?#]/.test(value)||/%(?:2e|2f|5c|00)/i.test(value))fail('INVALID_INPUT','Use a listed CalDAV path.');
    const parsed=new URL(value,'https://caldav.icloud.com');
    if(parsed.pathname!==value)fail('INVALID_INPUT','CalDAV paths cannot contain traversal segments.');
    return value;
  }
  async move({event_href,destination_calendar_id,expected_etag,expected_uid,request_id}){
    this.checkedPath(event_href);this.checkedPath(destination_calendar_id);
    if(typeof expected_etag!=='string'||!expected_etag||/[\r\n]/.test(expected_etag)||typeof expected_uid!=='string'||!expected_uid||/[\r\n]/.test(expected_uid))fail('INVALID_INPUT','An event UID and current ETag are required.');
    return this.idempotent('move_event',request_id,{event_href,destination_calendar_id,expected_etag,expected_uid},async()=>{
      const calendars=await this.service.listCalendars();
      const sourceCalendar=calendars.find(item=>event_href.startsWith(item.id)&&!event_href.slice(item.id.length).includes('/'));
      const target=calendars.find(item=>item.id===destination_calendar_id);
      if(!sourceCalendar||!target||sourceCalendar.readOnly||target.readOnly)fail('PERMISSION_DENIED','Both calendars must be listed and writable.');
      if(sourceCalendar.id===target.id)fail('INVALID_INPUT','Choose a different destination calendar.');
      const current=await this.client.get(event_href);
      const uids=[...current.data.replace(/\r?\n[ \t]/g,'').matchAll(/^UID:(.+)\r?$/gm)].map(match=>match[1].trim());
      if(current.etag!==expected_etag||!uids.length||uids.some(uid=>uid!==expected_uid))fail('ETAG_CONFLICT','The source event changed; refresh it before moving.');
      const destination=target.id+event_href.slice(sourceCalendar.id.length);
      const sourceOrigin=this.client.originForPath(event_href),targetOrigin=this.client.originForPath(target.id);
      if(sourceOrigin!==targetOrigin)fail('UNSUPPORTED_OPERATION','Cross-origin calendar moves are not supported.');
      this.service.limiter.take('write',this.service.writeLimit);
      let mutationError;
      try{
        const response=await this.client.fetchWithRedirects(event_href,'MOVE',undefined,{'If-Match':expected_etag,Overwrite:'F',Destination:new URL(destination,targetOrigin).href});
        this.client.validateResponse(response);
        if(![201,204].includes(response.status))fail('MOVE_REJECTED','iCloud rejected the event move.');
        await response.text();
      }catch(error){mutationError=error;}
      let moved;
      try{moved=await this.client.visibleGet(destination);}catch{throw mutationError??new ManagementError('VERIFY_FAILED','The destination event could not be read.');}
      if(digest(moved.data)!==digest(current.data))fail('VERIFY_FAILED','The destination does not match the complete original event.');
      let sourceAbsent=false;
      try{await this.client.get(event_href);}catch(error){if(error.code==='EVENT_NOT_FOUND')sourceAbsent=true;else throw error;}
      if(!sourceAbsent)throw mutationError??new ManagementError('VERIFY_FAILED','The source still exists; no source was deleted by the connector.');
      return {moved:true,source_href:event_href,destination_href:destination,calendar_id:target.id,uid:expected_uid,etag:moved.etag,preserved_entire_ics:true};
    });
  }
}
export function registerManagementTools(server,management,z){
  const wrap=run=>async input=>{
    try{const result=await run(input);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}
    catch(error){const allowed=['INVALID_INPUT','ALREADY_EXISTS','CREATE_REJECTED','VERIFY_FAILED','COLOR_NOT_APPLIED','PERMISSION_DENIED','ETAG_CONFLICT','UNSUPPORTED_OPERATION','MOVE_REJECTED','EVENT_NOT_FOUND','AUTH_FAILED','TEMPORARY_UNAVAILABLE','RATE_LIMITED'];const code=allowed.includes(error.code)?error.code:'REQUEST_FAILED';return {isError:true,content:[{type:'text',text:JSON.stringify({error:{code,message:'Calendar management did not complete; inspect calendar state before retrying.'}})}]};}
  };
  const request=z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
  server.registerTool('get_calendar_properties',{description:'List calendar names, IDs, writable flags and Apple calendar colors.',inputSchema:{},annotations:{readOnlyHint:true}},wrap(()=>management.properties().then(calendars=>({calendars}))));
  server.registerTool('create_calendar',{description:'Create an iCloud calendar with a name and hexadecimal color. Uses an idempotent request ID and verifies the result; does not overwrite existing calendars.',inputSchema:{name:z.string().min(1).max(200),color:z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/),request_id:request},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},wrap(input=>management.create(input)));
  server.registerTool('move_event',{description:'Atomically move the entire original iCalendar resource to another writable calendar, preserving alarms, UID and recurrence. Requires current source ETag and UID. Never overwrites an existing destination. Reconciles uncertain responses instead of replaying MOVE.',inputSchema:{event_href:z.string().min(1),destination_calendar_id:z.string().min(1),expected_etag:z.string().min(1),expected_uid:z.string().min(1),request_id:request},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true}},wrap(input=>management.move(input)));
}
