import test,{type TestContext} from "node:test";
import assert from "node:assert/strict";
import {NotebookPresenceConnection} from "../lib/notebook-presence-connection";
import {notebookScrollPosition,notebookView} from "../lib/notebook-presence";

class Socket {
 static OPEN=1;
 static instances:Socket[]=[];
 readyState=0;closed=false;sent:string[]=[];
 onmessage:((event:{data:string})=>void)|null=null;
 onclose:((event:{code:number})=>void)|null=null;
 onerror:(()=>void)|null=null;
 constructor(public url:string){Socket.instances.push(this);}
 send(value:string){this.sent.push(value);}
 close(){this.closed=true;this.readyState=3;}
 packet(value:unknown){this.readyState=1;this.onmessage?.({data:JSON.stringify(value)});}
 disconnect(code=1006){this.readyState=3;this.onclose?.({code});}
}
const snapshot=(id="owner")=>({type:"presence",self:{id},peers:[]});
function fixture(t:TestContext){
 t.mock.timers.enable({apis:["setTimeout"]});
 const original=Object.getOwnPropertyDescriptor(globalThis,"WebSocket")!;
 Object.defineProperty(globalThis,"WebSocket",{value:Socket,configurable:true,writable:true});
 t.after(()=>Object.defineProperty(globalThis,"WebSocket",original));
 Socket.instances=[];
 const states:boolean[]=[],codes:number[]=[],packets:unknown[]=[];
 const connection=new NotebookPresenceConnection({ownerId:"owner",url:"ws://metis-lan.test",onConnected:()=>states.push(true),onDisconnected:code=>{states.push(false);codes.push(code);},onPacket:packet=>packets.push(packet)});
 t.after(()=>connection.destroy());
 connection.start();
 return {connection,states,codes,packets,last:()=>Socket.instances.at(-1)!};
}
test("a socket upgrade is not live until an account-bound presence handshake arrives",t=>{
 const f=fixture(t),ws=f.last();ws.readyState=1;
 assert.equal(ws.url,"ws://metis-lan.test/ws/notes?presence=1");
 f.connection.send({type:"update"});assert.equal(ws.sent.length,0);
 ws.packet(snapshot("different-account"));assert.equal(f.connection.connected,false);
 t.mock.timers.tick(10000);assert.equal(ws.closed,true);assert.deepEqual(f.codes,[1006]);
 t.mock.timers.tick(500);f.last().packet(snapshot());
 assert.equal(f.connection.connected,true);assert.deepEqual(f.states,[false,true]);
 f.connection.send({type:"update",noteId:"current",view:{scroll:0}});assert.equal(f.last().sent.length,1);
});
test("transient loss reconnects, ignores late packets, and receives fresh participants",t=>{
 const f=fixture(t),old=f.last();old.packet(snapshot());old.disconnect();
 t.mock.timers.tick(500);const next=f.last();assert.notEqual(next,old);
 old.packet(snapshot());assert.equal(f.connection.connected,false);
 next.packet(snapshot());assert.equal(f.connection.connected,true);
 old.disconnect(4403);assert.equal(f.connection.connected,true);
 assert.deepEqual(f.states,[true,false,true]);
});
test("a half-open connection recovers after missing server snapshots",t=>{
 const f=fixture(t);f.last().packet(snapshot());
 t.mock.timers.tick(15000);f.last().packet(snapshot());
 t.mock.timers.tick(15000);assert.equal(f.connection.connected,true);
 t.mock.timers.tick(5000);assert.equal(f.connection.connected,false);
 t.mock.timers.tick(500);assert.equal(Socket.instances.length,2);
});
test("rate-limited sessions retry slowly; authentication waits for explicit Retry",t=>{
 const f=fixture(t);f.last().disconnect(4429);
 t.mock.timers.tick(9999);assert.equal(Socket.instances.length,1);
 t.mock.timers.tick(1);assert.equal(Socket.instances.length,2);
 f.last().disconnect(4403);t.mock.timers.tick(60000);f.connection.wake();
 assert.equal(Socket.instances.length,2);assert.equal(f.connection.connected,false);
});
test("returning online wakes a pending connection; disposal cancels all retry paths",t=>{
 const f=fixture(t);const old=f.last();old.disconnect();f.connection.wake();
 assert.equal(Socket.instances.length,2);
 f.connection.destroy();old.packet(snapshot());f.last().disconnect();
 t.mock.timers.tick(60000);f.connection.wake();assert.equal(Socket.instances.length,2);
 assert.equal(f.connection.connected,false);
});
test("repeated failed handshakes retain backoff instead of resetting on upgrade",t=>{
 const f=fixture(t);
 t.mock.timers.tick(10000);t.mock.timers.tick(500);assert.equal(Socket.instances.length,2);
 t.mock.timers.tick(10000);t.mock.timers.tick(500);assert.equal(Socket.instances.length,2);
 t.mock.timers.tick(500);assert.equal(Socket.instances.length,3);
});
test("elastic scrolling and zero-size pages always produce accepted presence packets",()=>{
 for(const [top,height,client,expected]of [[-80,1200,200,0],[1080,1200,200,1],[500,1200,200,.5],[10,0,0,0],[0,100,200,0],[NaN,200,100,0],[Infinity,200,100,0]]){
  const scroll=notebookScrollPosition({scrollTop:top,scrollHeight:height,clientHeight:client});
  assert.equal(scroll,expected);assert.deepEqual(notebookView({scroll}),{scroll});
 }
 assert.equal(notebookScrollPosition(null),0);
});
