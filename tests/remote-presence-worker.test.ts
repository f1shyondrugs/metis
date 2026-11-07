import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {EventEmitter} from "node:events";
import {DatabaseSync} from "node:sqlite";
import {setTimeout as delay} from "node:timers/promises";
const root=mkdtempSync(path.join(tmpdir(),"metis-presence-worker-"));
Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root,AI_CHAT_ROOT:root});
delete process.env.AI_CHAT_JOB_ID;delete process.env.AI_CHAT_WORKER_ID;delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
async function until(check:()=>boolean){const deadline=Date.now()+10000;while(!check()){assert.ok(Date.now()<deadline,"presence did not become durable");await delay(20);}}
test("real gateway heartbeats/auth stay responsive under writer lock and preserve scope, capabilities and revocation",async()=>{
 const [{getDatabase},clients,gateway,presence,notifications]=await Promise.all([import("../lib/sqlite"),import("../lib/remote-clients"),import("../lib/remote-client-gateway"),import("../lib/remote-presence"),import("../lib/notification-store")]);
 const db=getDatabase();notifications.notificationDatabase();
 const old="2000-01-01T00:00:00.000Z";
 for(const id of ["owner","other"])db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)").run(id,id,"unused",old);
 db.prepare("INSERT INTO remote_clients(id,owner_id,name,status,capabilities,created_at,updated_at,last_seen_at) VALUES ('device','owner','Fixture','offline','[]',?,?,?)").run(old,old,old);
 db.prepare("INSERT INTO remote_client_credentials(id,client_id,secret_hash,created_at) VALUES ('credential','device',?,?)").run(createHash("sha256").update("synthetic-credential").digest("hex"),old);
 class Socket extends EventEmitter{readyState=1;acks=0;send(value:string){if(JSON.parse(value).type==="heartbeat_ack")this.acks++;}close(){this.emit("close");}}
 const socket=new Socket();gateway.attachRemoteClient(socket,"device","owner");
 const lock=new DatabaseSync(process.env.CHAT_DB_PATH!);
 try{
  lock.exec("BEGIN IMMEDIATE");
  const began=performance.now();
  assert.deepEqual(clients.authenticateRemoteClient("device","synthetic-credential"),{clientId:"device",ownerId:"owner"});
  assert.equal(clients.authenticateRemoteClient("device","invalid"),null);
  socket.emit("message",JSON.stringify({type:"heartbeat",desktopGui:true}));
  assert.ok(performance.now()-began<300,"gateway waited for SQLite writer");
  assert.equal(socket.acks,1);
  assert.equal(clients.getRemoteClient("device","owner")!.status,"online");
  assert.ok(clients.getRemoteClient("device","owner")!.capabilities.includes("desktop_gui"));
  assert.equal(clients.getRemoteClient("device","other"),null);
  assert.equal(db.prepare("SELECT status FROM remote_clients WHERE id='device'").get()!.status,"offline");
  let ticks=0;const timer=setInterval(()=>ticks++,10);await delay(350);clearInterval(timer);
  assert.ok(ticks>=15,"parent timer stalled on heartbeat");
  // Coalesced heartbeats retain the newest capability rather than queueing every write.
  for(let i=0;i<100;i++)socket.emit("message",JSON.stringify({type:"heartbeat",desktopGui:i===99}));
  assert.equal(socket.acks,101);
  lock.exec("COMMIT");
  await until(()=>db.prepare("SELECT status FROM remote_clients WHERE id='device'").get()!.status==="online" &&
    String(db.prepare("SELECT capabilities FROM remote_clients WHERE id='device'").get()!.capabilities).includes("desktop_gui") &&
    !!db.prepare("SELECT last_used_at FROM remote_client_credentials WHERE id='credential'").get()!.last_used_at);
  // The first persisted heartbeat may already satisfy the values above. Wait
  // for the coalesced newest sequence ACK before testing stale-write rejection.
  await until(()=>!presence.getRemotePresence("device","owner"));
  const latest=String(db.prepare("SELECT last_seen_at FROM remote_clients WHERE id='device'").get()!.last_seen_at);
  presence.queueRemotePresence({clientId:"device",ownerId:"other",status:"offline",at:new Date().toISOString()});
  await until(()=>!presence.getRemotePresence("device","other"));
  assert.equal(db.prepare("SELECT status FROM remote_clients WHERE id='device'").get()!.status,"online");
  presence.queueRemotePresence({clientId:"device",ownerId:"owner",status:"offline",at:old});
  await until(()=>!presence.getRemotePresence("device","owner"));
  assert.equal(db.prepare("SELECT last_seen_at FROM remote_clients WHERE id='device'").get()!.last_seen_at,latest);
  db.prepare("UPDATE remote_clients SET status='revoked',revoked_at=? WHERE id='device'").run(new Date().toISOString());
  presence.queueRemotePresence({clientId:"device",ownerId:"owner",status:"online",at:new Date().toISOString()});
  assert.equal(clients.getRemoteClient("device","owner")!.status,"revoked");
  assert.equal(clients.authenticateRemoteClient("device","synthetic-credential"),null);
  await until(()=>!presence.getRemotePresence("device","owner"));
  assert.equal(db.prepare("SELECT status FROM remote_clients WHERE id='device'").get()!.status,"revoked");
 }finally{try{lock.exec("ROLLBACK");}catch{}lock.close();socket.close();await presence.stopRemotePresenceWriter();db.close();rmSync(root,{recursive:true,force:true});}
});
