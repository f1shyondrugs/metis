import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const directory = mkdtempSync(path.join(os.tmpdir(), "metis-remote-appearance-"));
Object.assign(process.env, { NODE_ENV:"test", CHAT_DATA_DIR:directory, CHAT_DB_PATH:path.join(directory,"chat.sqlite"), AI_CHAT_ROOT:directory, AGENT_CWD:directory });
const loaded = Promise.all([
  import("../lib/auth"), import("../lib/remote-clients"), import("../lib/appearance-settings"),
  import("../lib/appearance-storage"), import("../lib/remote-client-gateway"), import("../lib/remote-client-appearance"),
]);
test.after(() => rmSync(directory,{recursive:true,force:true}));

test("device themes use the authenticated owner, support custom aliases, and send only revisions that changed", async () => {
  const [auth, clients, settings, storage, gateway, appearance] = await loaded;
  const owner = auth.createUser("theme-owner","synthetic-password");
  const other = auth.createUser("other-theme-owner","synthetic-password");
  const client = clients.registerRemoteClient(clients.createEnrollmentToken(owner.id,undefined,"user").token,{name:"Theme fixture",permissionMode:"user"})!.client!;
  const state = {...storage.createDefaultAppearanceState(), selected:"nord"};
  assert.equal(settings.saveAppearanceSettings(owner.id,state,0).ok,true);
  assert.equal(appearance.getRemoteClientAppearance(owner.id).variables["--primary"],"#88c0d0");
  const custom = storage.createCustomTheme(storage.createDefaultAppearanceState(),{
    format:"metis-theme",version:1,name:"Private custom",mode:"light",
    variables:{"--primary":"var(--brand)", "--brand":"#685139"},
  },"custom-remote");
  settings.saveAppearanceSettings(other.id,custom,0);
  const sent: Array<{ appearance?: ReturnType<typeof appearance.getRemoteClientAppearance> & { customThemes?: unknown } }> = [];
  const emitter = new EventEmitter();
  const socket = Object.assign(emitter,{readyState:1,send:(data:string)=>{ sent.push(JSON.parse(data)); },close:()=>{ emitter.emit("close"); }});
  gateway.attachRemoteClient(socket,client.id,owner.id);
  const heartbeat = (extra={}) => socket.emit("message",JSON.stringify({type:"heartbeat",...extra}));
  try {
    heartbeat();
    assert.equal(sent.at(-1)!.appearance,undefined,"Legacy clients retain the old heartbeat shape");
    heartbeat({appearance:true,ownerId:other.id});
    assert.equal(sent.at(-1)!.appearance.variables["--primary"],"#88c0d0");
    assert.equal(JSON.stringify(sent.at(-1)).includes("Private custom"),false);
    heartbeat({appearance:true});
    assert.equal(sent.at(-1)!.appearance,undefined);
    settings.saveAppearanceSettings(owner.id,custom,1);
    heartbeat({appearance:true});
    assert.equal(sent.at(-1)!.appearance.mode,"light");
    assert.equal(sent.at(-1)!.appearance.variables["--brand"],"#685139");
    assert.equal(sent.at(-1)!.appearance.variables["--primary"],"var(--brand)");
    assert.equal(sent.at(-1)!.appearance.customThemes,undefined);
  } finally {socket.close();}
});
