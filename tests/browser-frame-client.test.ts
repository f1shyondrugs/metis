import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = ts.createSourceFile("app-shell.tsx", readFileSync("components/app-shell.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect: ts.Node | undefined;
function visit(node: ts.Node) {
 if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("/api/browser/stream?")) effect = node.arguments[0];
 ts.forEachChild(node, visit);
}
visit(source);
assert.ok(effect);
const js = ts.transpileModule("const effect="+effect.getText(source)+";", {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture() {
 const received: Array<{frame:unknown;settle?:()=>void}> = [], sockets: Socket[] = [];
 const socketRef: {current:Socket|null} = {current:null};
 class Socket {
  static OPEN=1;
  readyState=1;
  onmessage?: (event:{data:unknown})=>void;
  onclose?:()=>void;
  binaryType="";
  sent: Array<unknown>=[];
  constructor(readonly url:string) {sockets.push(this);}
  send(value:string) {this.sent.push(JSON.parse(value));}
  close() {this.readyState=3;this.onclose?.();}
  message(value:unknown) {this.onmessage?.({data:typeof value==="object"&&!(value instanceof Blob)?JSON.stringify(value):value});}
 }
 const noop=()=>{};
 const context={
  browserStreamVisible:true,browserEnabled:true,activeChatId:"chat",loadingChatId:null,
  browserScreenshotRef:{current:{}},browserFramePresenterRef:{current:null},browserSocketRef:socketRef,
  createBrowserFramePresenter:()=>({push:(frame:unknown,settle?:()=>void)=>received.push({frame,settle}),dispose:noop}),
  markBrowserFrameVisible:noop,beginBrowserLoading:noop,clearBrowserFrame:noop,
  browserUrlRef:{current:""},activeBrowserTabId:"browser-1",activeBrowserTabIdRef:{current:"browser-1"},
  browserRealtime:true,browserFps:30,browserDefaultViewport:{width:1280,height:800},
  browserLoadingRef:{current:false},setBrowserLoading:noop,setBrowserError:noop,
  window:{location:{protocol:"http:",host:"fixture"},setTimeout:()=>1,clearTimeout:noop},
  URLSearchParams,Blob,WebSocket:Socket,
 };
 const cleanup=new Function(...Object.keys(context),js+"return effect;")(...Object.values(context))();
 return {received,sockets,Socket,socketRef,cleanup};
}
test("the real stream opts into numbered frame acknowledgements after presentation",()=>{
 const f=fixture(), socket=f.sockets[0];
 try {
  assert.equal(new URL(socket.url).searchParams.get("frameAck"),"1");
  socket.message({type:"frame",sequence:7}); socket.message(new Blob(["jpeg"]));
  assert.equal(f.received.length,1);assert.deepEqual(socket.sent,[]);
  f.received[0].settle!();
  assert.deepEqual(socket.sent,[{type:"frame_ack",sequence:7}]);
 } finally {f.cleanup();}
});
test("legacy frames keep displaying and invalid frame headers cannot acknowledge arbitrary values",()=>{
 const f=fixture(), socket=f.sockets[0];
 try {
  socket.message(new Blob(["legacy"]));assert.equal(f.received[0].settle,undefined);
  for(const sequence of [0,-1,1.5,"1",Number.MAX_SAFE_INTEGER+1]){
   socket.message({type:"frame",sequence});socket.message(new Blob(["jpeg"]));
   assert.equal(f.received.at(-1)!.settle,undefined);
  }
  assert.deepEqual(socket.sent,[]);
 } finally {f.cleanup();}
});
test("a late decode cannot acknowledge a disposed or replaced image socket",()=>{
 const f=fixture(), socket=f.sockets[0];
 socket.message({type:"frame",sequence:1});socket.message(new Blob(["jpeg"]));
 f.cleanup();f.received[0].settle!();assert.deepEqual(socket.sent,[]);
 socket.message({type:"frame",sequence:2});socket.message(new Blob(["late"]));
 assert.equal(f.received.length,1);
 const g=fixture(), original=g.sockets[0];
 try {
  original.message({type:"frame",sequence:3});original.message(new Blob(["jpeg"]));
  g.socketRef.current=new g.Socket("ws://fixture/replacement");
  g.received[0].settle!();assert.deepEqual(original.sent,[]);
 } finally {g.cleanup();}
});
