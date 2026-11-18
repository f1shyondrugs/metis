import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

const dir = mkdtempSync(path.join(os.tmpdir(), "metis-notifications-"));
Object.assign(process.env,{CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"test.sqlite"),AI_CHAT_ROOT:dir,AGENT_CWD:dir,AI_CHAT_PUBLIC_URL:"https://notices.example.test:8443/server/"});
delete process.env.AI_CHAT_TEST_BYPASS_LEASE;
process.env.MCP_BEARER_TOKEN = "isolated-test-token";

test("notification backend: owner boundaries, durable replay, ACK and API authentication", async t => {
  const store = await import("../lib/notification-store");
  const remote = await import("../lib/notification-remote");
  const observer = await import("../lib/notification-observer");
  const db = (await import("../lib/sqlite")).getDatabase();
  const now = new Date().toISOString();
  for (const owner of ["alice","bob"]) {
    db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)").run(owner,owner,"not-a-real-password",now);
    db.prepare("INSERT INTO chats(id,owner_id,data,created_at,updated_at) VALUES (?,?,?,?,?)").run(owner+"-chat",owner,JSON.stringify({id:owner+"-chat",title:owner==="alice"?"Release notes":"Private Bob chat"}),now,now);
    db.prepare("INSERT INTO jobs(id,chat_id,user_id,data,status,updated_at) VALUES (?,?,?,?,?,?)").run(owner+"-job",owner+"-chat",owner,JSON.stringify({id:owner+"-job",userId:owner,chatId:owner+"-chat"}),"running",now);
    db.prepare("INSERT INTO remote_clients(id,owner_id,name,created_at,updated_at) VALUES (?,?,?,?,?)").run(owner+"-pc",owner,owner+" PC",now,now);
    const token = owner+"-session";
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)").run(createHash("sha256").update(token).digest("hex"),owner,new Date(Date.now()+60000).toISOString());
  }
  // Existing history must not be published on first installation.
  db.prepare("INSERT INTO run_events(job_id,chat_id,user_id,event,data,created_at) VALUES (?,?,?,?,?,?)").run("alice-job","alice-chat","alice","done","{}",now);
  store.notificationDatabase();
  assert.equal(observer.observeNotificationEvents(),0);
  assert.equal(store.getNotificationFeed("alice",0).notifications.length,0);
  const event = (owner:string,kind:string,data:unknown={}) => db.prepare("INSERT INTO run_events(job_id,chat_id,user_id,event,data,created_at) VALUES (?,?,?,?,?,?)")
    .run(owner+"-job",owner+"-chat",owner,kind,JSON.stringify(data),now);
  await t.test("preferences reject foreign and revoked clients and default safely", () => {
    assert.deepEqual(store.getNotificationPrefs("alice"),{toastEnabled:true,browserEnabled:false,remoteEnabled:true,agentFinishedEnabled:true,showChatTitle:false,showServerDomain:false,remoteClientIds:["alice-pc"]});
    assert.throws(()=>store.setNotificationPrefs("alice",{remoteClientIds:["bob-pc"]}));
    assert.throws(()=>store.setNotificationPrefs("alice",{toastEnabled:"yes"}));
    assert.throws(()=>store.setNotificationPrefs("alice",{execute_command:"anything"}));
    store.setNotificationPrefs("alice",{remoteClientIds:["alice-pc","alice-pc"],browserEnabled:true});
    assert.deepEqual(store.getNotificationPrefs("alice").remoteClientIds,["alice-pc"]);
    db.prepare("UPDATE remote_clients SET revoked_at=? WHERE id='alice-pc'").run(now);
    assert.throws(()=>store.setNotificationPrefs("alice",{remoteClientIds:["alice-pc"]}));
    db.prepare("UPDATE remote_clients SET revoked_at=NULL WHERE id='alice-pc'").run();
  });
  await t.test("custom notifications are owner isolated, durable, paginated and chat validated", async () => {
    assert.throws(()=>store.createNotification("alice",{title:"x",chatId:"bob-chat"}));
    assert.throws(()=>store.createNotification("alice",{title:"x",url:"https://evil.invalid"}));
    const n=store.createNotification("alice",{title:"custom",body:"test",chatId:"alice-chat"},"custom-source");
    assert.equal(store.createNotification("alice",{title:"custom"},"custom-source").id,n.id);
    assert.equal(store.getNotificationFeed("alice").notifications.length,0);
    assert.equal(store.getNotificationFeed("alice",0).notifications.length,1);
    assert.equal(store.getNotificationFeed("bob",0).notifications.length,0);
    const {consumeNotificationFeed} = await import("../lib/notification-feed");
    const response = {...store.getNotificationFeed("alice",0),clients:[]};
    const firstConsume = consumeNotificationFeed(response,0);
    assert.equal(firstConsume.notifications.length,1);
    assert.equal(consumeNotificationFeed(response,firstConsume.cursor).notifications.length,0);
    for(let i=0;i<101;i++)store.createNotification("bob",{title:"test"});
    const first=store.getNotificationFeed("bob",0);
    assert.equal(first.notifications.length,100); assert.equal(first.hasMore,true);
    assert.equal(store.getNotificationFeed("bob",first.cursor).notifications.length,1);
  });
  await t.test("observer drains bounded run events without browser; replay dedupes and redacts payloads", () => {
    event("alice","text",{text:"private output"});
    event("alice","done",{text:"private output"});
    event("alice","done",{text:"duplicate"});
    event("alice","question",{questionId:"q1",questions:[{question:"private question"}]});
    event("alice","question",{questionId:"q1"});
    event("alice","error",null);
    observer.observeNotificationEvents();
    const feed=store.getNotificationFeed("alice",0);
    assert.equal(feed.notifications.length,4);
    assert.doesNotMatch(JSON.stringify(feed),/private output|private question/);
    db.prepare("UPDATE notification_observer SET cursor=0").run();
    observer.observeNotificationEvents();
    assert.equal(store.getNotificationFeed("alice",0).notifications.length,4);
    // A mismatched event owner must not publish into either account.
    db.prepare("INSERT INTO run_events(job_id,chat_id,user_id,event,data,created_at) VALUES (?,?,?,?,?,?)")
      .run("alice-job","alice-chat","bob","done","{}",now);
    observer.observeNotificationEvents();
    assert.equal(store.getNotificationFeed("bob",0).notifications.length,100);
  });
  await t.test("waiting, cancelled and interrupted runs never emit completion; plans and reset alerts dedupe", () => {
    const before = store.getNotificationFeed("alice", 0).notifications.length;
    event("alice", "done", {status:"cancelled"});
    event("alice", "done", {status:"interrupted"});
    event("alice", "done", {status:"waiting_provider_limit"});
    event("alice", "status", {status:"waiting_provider_limit",resetAt:"unknown"});
    observer.observeNotificationEvents();
    assert.equal(store.getNotificationFeed("alice",0).notifications.length,before);
    const resetAt = new Date(Date.now()+5*3600000).toISOString();
    for(let i=0;i<2;i++) {
      event("alice","status",{status:"waiting_provider_limit",resetAt});
      event("alice","workspace",{workspace:{type:"plan",id:"plan-test",content:"private plan"}});
    }
    observer.observeNotificationEvents();
    const added=store.getNotificationFeed("alice",0).notifications.slice(before);
    assert.deepEqual(added.map(n=>n.title),["Provider limit reached","Plan ready"]);
    assert.doesNotMatch(JSON.stringify(added),/private plan/);
  });
  class FakeSocket extends EventEmitter {
    readyState=1;
    sent: Array<Record<string,unknown>>=[];
    send(raw:string){this.sent.push(JSON.parse(raw));}
    message(data:unknown){this.emit("message",JSON.stringify(data));}
  }
  await t.test("native capability, owner, matching ACK, timeout and replaced sessions", async () => {
    const socket=new FakeSocket();
    remote.bindNotificationSession(socket,"alice-pc","alice");
    const n=store.getNotificationFeed("alice",0).notifications[0];
    assert.equal(await remote.sendRemoteNotification("alice-pc","alice",n,10),false);
    socket.message({type:"heartbeat",nativeNotifications:true});
    assert.equal(remote.notificationCapability("alice-pc","bob"),false);
    assert.equal(await remote.sendRemoteNotification("alice-pc","bob",n,10),false);
    const result=remote.sendRemoteNotification("alice-pc","alice",n,50);
    const request=socket.sent.at(-1)!;
    socket.message({type:"notification_ack",requestId:request.requestId,notificationId:"wrong",ok:true});
    socket.message({type:"response",requestId:request.requestId,ok:true});
    socket.message({type:"notification_ack",requestId:request.requestId,notificationId:n.id,ok:true});
    assert.equal(await result,true);
    assert.equal(await remote.sendRemoteNotification("alice-pc","alice",n,5),false);
    const stale=remote.sendRemoteNotification("alice-pc","alice",n,50);
    const fresh=new FakeSocket();
    remote.bindNotificationSession(fresh,"alice-pc","alice");
    assert.equal(await stale,false);
    socket.message({type:"heartbeat",nativeNotifications:true});
    assert.equal(remote.notificationCapability("alice-pc","alice"),false);
    fresh.message({type:"heartbeat",nativeNotifications:true});
    socket.emit("close");
    assert.equal(remote.notificationCapability("alice-pc","alice"),true);
    db.prepare("UPDATE remote_clients SET revoked_at=? WHERE id='alice-pc'").run(now);
    assert.equal(remote.notificationCapability("alice-pc","alice"),false);
    db.prepare("UPDATE remote_clients SET revoked_at=NULL WHERE id='alice-pc'").run();
    fresh.emit("close");
  });
  await t.test("outbox retries negative ACK, records positive ACK and honors disabled selection", async () => {
    // Keep this retry fixture below one batch; default enrollment is tested separately.
    store.setNotificationPrefs("bob",{remoteEnabled:false});
    let sends=0;
    await observer.deliverPendingNotifications(async()=>{sends++;return false;});
    assert.ok(sends>0);
    const negative=sends;
    await observer.deliverPendingNotifications(async()=>{sends++;return true;});
    assert.equal(sends,negative);
    db.prepare("UPDATE notification_deliveries SET retry_at=0").run();
    await observer.deliverPendingNotifications(async()=>{sends++;return true;});
    const positive=sends;
    await observer.deliverPendingNotifications(async()=>{sends++;return true;});
    assert.equal(sends,positive);
    store.createNotification("alice",{title:"disabled"});
    store.setNotificationPrefs("alice",{remoteClientIds:[]});
    await observer.deliverPendingNotifications(async()=>{assert.fail("Disabled client received data");return true;});
    // Records survive; disabling channels does not erase the browser feed.
    assert.equal(store.getNotificationFeed("alice",0).notifications.at(-1)?.title,"disabled");
  });
  await t.test("master and completion switches stop queued alerts, retain device choices and never replay muted history",async()=>{
    store.setNotificationPrefs("alice",{remoteEnabled:true,agentFinishedEnabled:true,remoteClient:{id:"alice-pc",enabled:true}});
    const finished=store.createNotification("alice",{title:"completed for settings"}, "run:alice:done:settings-job");
    const custom=store.createNotification("alice",{title:"custom for settings"});
    assert.equal(store.notificationDeliverySummary("alice",finished.id).queuedDevices,1);
    store.setNotificationPrefs("alice",{agentFinishedEnabled:false});
    assert.equal(store.notificationDeliverySummary("alice",finished.id).status,"disabled");
    assert.equal(store.notificationDeliverySummary("alice",custom.id).status,"queued");
    const muted=store.createNotification("alice",{title:"muted completion"},"run:alice:done:muted-job");
    assert.equal(store.notificationDeliverySummary("alice",muted.id).queuedDevices,0);
    store.setNotificationPrefs("alice",{remoteEnabled:false});
    assert.deepEqual(store.getNotificationPrefs("alice").remoteClientIds,["alice-pc"]);
    assert.equal(store.notificationDeliverySummary("alice",custom.id).queuedDevices,0);
    await observer.deliverPendingNotifications(async()=>{assert.fail("Globally muted notification sent");return true});
    const offline=store.createNotification("alice",{title:"disabled custom"});
    assert.equal(store.notificationDeliverySummary("alice",offline.id).status,"disabled");
    store.setNotificationPrefs("alice",{remoteEnabled:true,agentFinishedEnabled:true});
    store.createNotification("alice",{title:"muted completion"},"run:alice:done:muted-job");
    assert.equal(store.notificationDeliverySummary("alice",muted.id).queuedDevices,0);
    const next=store.createNotification("alice",{title:"fresh"});
    assert.equal(store.notificationDeliverySummary("alice",next.id).status,"queued");
    store.setNotificationPrefs("alice",{remoteClient:{id:"alice-pc",enabled:false}});
    assert.equal(store.notificationDeliverySummary("alice",next.id).status,"no_devices");
    assert.equal(store.notificationDeliverySummary("alice",next.id).queuedDevices,0);
    assert.throws(()=>store.setNotificationPrefs("alice",{remoteClient:{id:"bob-pc",enabled:true}}));
    assert.throws(()=>store.setNotificationPrefs("alice",{remoteClient:{id:"alice-pc",enabled:true},remoteClientIds:[]}));
    store.setNotificationPrefs("alice",{remoteClient:{id:"alice-pc",enabled:true}});
    store.setNotificationPrefs("alice",{toastEnabled:false});
    assert.deepEqual(store.getNotificationPrefs("alice").remoteClientIds,["alice-pc"]);
    assert.equal(store.getNotificationPrefs("alice").remoteEnabled,true);
    store.setNotificationPrefs("alice",{remoteEnabled:false});
  });
  await t.test("individual device patches compose and global switches never erase choices", () => {
    db.prepare("INSERT INTO remote_clients(id,owner_id,name,created_at,updated_at) VALUES (?,?,?,?,?)").run("alice-laptop","alice","Laptop",now,now);
    store.setNotificationPrefs("alice",{remoteEnabled:true,remoteClient:{id:"alice-laptop",enabled:true}});
    assert.deepEqual(store.getNotificationPrefs("alice").remoteClientIds,["alice-pc","alice-laptop"]);
    store.setNotificationPrefs("alice",{remoteClient:{id:"alice-pc",enabled:false}});
    assert.deepEqual(store.getNotificationPrefs("alice").remoteClientIds,["alice-laptop"]);
    const n=store.createNotification("alice",{title:"Laptop only"});
    assert.equal(store.notificationDeliverySummary("alice",n.id).queuedDevices,1);
    store.setNotificationPrefs("alice",{remoteEnabled:false});
    assert.equal(store.notificationDeliverySummary("alice",n.id).queuedDevices,0);
    store.setNotificationPrefs("alice",{remoteEnabled:true});
    assert.equal(store.notificationDeliverySummary("alice",n.id).queuedDevices,0);
    store.setNotificationPrefs("alice",{remoteClient:{id:"alice-pc",enabled:true}});
    store.setNotificationPrefs("alice",{remoteClient:{id:"alice-laptop",enabled:false}});
    db.prepare("DELETE FROM remote_clients WHERE id='alice-laptop'").run();
    store.setNotificationPrefs("alice",{remoteEnabled:false});
  });
  await t.test("authenticated feed/prefs/custom route and strict owner selection", async () => {
    const api=await import("../app/api/notifications/route");
    const req=(method:string,body?:unknown,owner="alice",query="")=>new Request("http://isolated.invalid/api/notifications"+query,{
      method,headers:{"Cookie":"ai_chat_auth="+owner+"-session","Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
    assert.equal((await api.GET(new Request("http://isolated.invalid/api/notifications"))).status,401);
    assert.equal((await api.POST(new Request("http://isolated.invalid/api/notifications",{method:"POST",body:"{}"}))).status,401);
    assert.equal((await api.PATCH(new Request("http://isolated.invalid/api/notifications",{method:"PATCH",body:"{}"}))).status,401);
    assert.equal((await api.GET(req("GET",undefined,"alice","?after=-1"))).status,400);
    assert.equal((await api.PATCH(req("PATCH",{remoteClientIds:["bob-pc"]}))).status,400);
    assert.equal((await api.POST(req("POST",{title:"test",chatId:"bob-chat"}))).status,400);
    assert.equal((await api.POST(req("POST",{title:"route test"}))).status,201);
    const res=await api.GET(req("GET"));
    assert.equal(res.headers.get("cache-control"),"no-store");
    assert.equal((await res.json()).notifications.length,0);
    const feed=await (await api.GET(req("GET",undefined,"alice","?after=0"))).json();
    assert.ok(feed.notifications.some((n:{title:string})=>n.title==="route test"));
    assert.ok(feed.clients.every((n:{id:string})=>n.id==="alice-pc"));
  });
  await t.test("chat details are independent, scoped and added only at display time", async () => {
    const cursor = store.getNotificationFeed("alice").cursor;
    const question = store.createNotification("alice", {title:"Answer needed", body:"Please answer in the chat.", chatId:"alice-chat"});
    const finished = store.createNotification("alice", {title:"Run completed", body:"Open the result.", chatId:"alice-chat"});
    const get = () => store.getNotificationFeed("alice",cursor).notifications;
    assert.deepEqual(get(), [question, finished]);
    assert.throws(()=>store.setNotificationPrefs("alice",{showChatTitle:"yes"}));
    store.setNotificationPrefs("alice",{showChatTitle:true});
    assert.equal(get()[0].body,"Release notes\nPlease answer in the chat.");
    assert.equal(get()[1].body,"Release notes\nOpen the result.");
    store.setNotificationPrefs("alice",{showChatTitle:false,showServerDomain:true});
    assert.equal(get()[0].body,"notices.example.test:8443\nPlease answer in the chat.");
    store.setNotificationPrefs("alice",{showChatTitle:true});
    const opts = store.getNotificationPrefs("alice");
    assert.equal(opts.showServerDomain,true);
    assert.equal(store.getNotificationPrefs("bob").showChatTitle,false);
    assert.equal(get()[0].body,"Release notes · notices.example.test:8443\nPlease answer in the chat.");
    assert.deepEqual(db.prepare("SELECT body FROM notification_records WHERE id=?").get(question.id),Object.assign(Object.create(null), {body:question.body}));
    assert.equal(store.notificationForDisplay("bob",question,opts),question);
    assert.equal(store.notificationForDisplay("alice",{...question,chatId:null},opts).body,question.body);
    db.prepare("INSERT INTO chats(id,owner_id,data,created_at,updated_at) VALUES (?,?,?,?,?)").run("alice-incognito","alice",JSON.stringify({id:"alice-incognito",title:"Hidden title",incognito:true}),now,now);
    assert.equal(store.notificationForDisplay("alice",{...question,chatId:"alice-incognito"},opts).body,question.body);
    const long = store.notificationForDisplay("alice",{...question,body:"😀".repeat(1000)},opts);
    assert.ok(long.body.length <= 2000);
    assert.ok(long.body.endsWith("…"));
    assert.doesNotMatch(long.body, /[\ud800-\udbff]…$/);
    const socket = new FakeSocket();
    remote.bindNotificationSession(socket,"alice-pc","alice");
    socket.message({type:"heartbeat",nativeNotifications:true});
    store.setNotificationPrefs("alice",{remoteEnabled:true,remoteClientIds:["alice-pc"]});
    const deliver = async (body:string) => {
      const result = remote.sendRemoteNotification("alice-pc","alice",question,50);
      const packet = socket.sent.at(-1)!;
      assert.equal((packet.notification as typeof question).body,body);
      socket.message({type:"notification_ack",requestId:packet.requestId,notificationId:question.id,ok:true});
      assert.equal(await result,true);
    };
    await deliver(get()[0].body);
    // An alert created before the preference was changed respects the current opt-outs.
    store.setNotificationPrefs("alice",{showChatTitle:false,showServerDomain:false});
    await deliver(question.body);
    socket.emit("close");
  });
  await t.test("MCP route requires token, active lease, owner and matching run/chat", async () => {
    const api=await import("../app/api/internal/mcp-notifications/route");
    const req=(extra:Record<string,string>={})=>new Request("http://isolated.invalid/api/internal/mcp-notifications",{method:"POST",headers:{
      authorization:"Bearer isolated-test-token","x-ai-chat-job-id":"alice-job","x-ai-chat-user-id":"alice","x-ai-chat-id":"alice-chat",
      "x-ai-chat-worker-id":"worker","x-ai-chat-lease-token":"lease",...extra},body:JSON.stringify({title:"internal test"})});
    assert.equal((await api.POST(req())).status,401);
    db.prepare("INSERT INTO job_leases(job_id,worker_id,lease_token,expires_at,updated_at) VALUES (?,?,?,?,?)").run("alice-job","worker","lease",new Date(Date.now()+60000).toISOString(),now);
    assert.equal((await api.POST(req({authorization:"Bearer wrong"}))).status,401);
    assert.equal((await api.POST(req({"x-ai-chat-lease-token":"wrong"}))).status,401);
    assert.equal((await api.POST(req({"x-ai-chat-user-id":"bob","x-ai-chat-id":"bob-chat"}))).status,401);
    assert.equal((await api.POST(req())).status,201);
    db.prepare("UPDATE job_leases SET expires_at=?").run(new Date(Date.now()-1000).toISOString());
    assert.equal((await api.POST(req())).status,401);
  });
});
