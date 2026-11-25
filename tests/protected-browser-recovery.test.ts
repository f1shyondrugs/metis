import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { ProtectedLoginError } from "../lib/protected-login-errors";
import { clickProtectedControl } from "../services/browser-login/core";
import { installProtectedRedirectGuard } from "../services/browser-login/redirect-guard";

const origin = "https://fixture.test";
const secret = "SYNTHETIC-NEVER-RENDER";
type Args = Record<string,unknown>;
type GuardArgs = Parameters<typeof installProtectedRedirectGuard>;
async function protocolFixture(opts: { message?: string; network?: boolean; failDecision?: boolean } = {}) {
  const protocol = new EventEmitter();
  const page = new EventEmitter();
  const context = new EventEmitter();
  let closes=0;
  const methods:string[]=[];
  const sent = Object.assign(protocol,{async send(method:string) {
    methods.push(method);
    if (method === "Network.enable" && opts.network === false) throw Error("Network is unavailable");
    if (method === (opts.failDecision?"Fetch.failRequest":"Fetch.continueRequest") && opts.message) throw Error(opts.message);
  }});
  Object.assign(context,{
    browser:()=>({}),newCDPSession:async()=>sent,async close() { closes++; context.emit("close"); },
  });
  await installProtectedRedirectGuard(context as unknown as GuardArgs[0],page as unknown as GuardArgs[1],
    ()=>({credentialOrigin:origin,origins:new Set([origin])}));
  const pause=(overrides:Args={})=>protocol.emit("Fetch.requestPaused", {
    requestId:"fetch-1",networkId:"request-1",resourceType:"Fetch",responseStatusCode:200,responseHeaders:[],
    request:{url:origin+"/health",method:"GET"},...overrides,
  });
  const cancel=(overrides:Args={})=>protocol.emit("Network.loadingFailed",{
    requestId:"request-1",canceled:true,errorText:"net::ERR_ABORTED",...overrides,
  });
  return {pause,cancel,protocol,methods,closes:()=>closes};
}
const interceptionGone = "Protocol error (Fetch.continueRequest): Invalid InterceptionId";

test("a Chromium-confirmed canceled same-origin read does not close or replay the session",async()=>{
  for(const before of [true,false]){
    const f=await protocolFixture({message:before?interceptionGone:"cdpSession.send: "+interceptionGone});
    if(before)f.cancel();
    f.pause();
    if(!before){await delay(5);f.cancel();}
    await delay(65);
    assert.equal(f.closes(),0);
    assert.equal(f.methods.filter(method=>method==="Fetch.continueRequest").length,1,"never retries or replays a request");
  }
});

test("only a matching terminal Chromium event can prove the read was canceled",async()=>{
  const inputs=[undefined,{requestId:"wrong-id"},{canceled:false},{errorText:"net::ERR_FAILED"}];
  for(const evidence of inputs){
    const f=await protocolFixture({message:interceptionGone});
    if(evidence)f.cancel(evidence);
    f.pause();
    await delay(65);
    assert.equal(f.closes(),1);
  }
});

test("the closed-interception exception cannot apply to redirects, navigation, writes or foreign origins",async()=>{
  for(const overrides of [
    {responseStatusCode:307}, {responseHeaders:[{name:"Location",value:"https://fixture.test/next"}]},
    {responseHeaders:[{name:"Refresh",value:"0; url=/next"}]},
    {resourceType:"Document"}, {request:{url:origin+"/",method:"POST"}},
    {request:{url:origin+"/",method:"GET",hasPostData:true}},
    {request:{url:"https://foreign.test/",method:"GET"}},{networkId:undefined},
  ]){
    const f=await protocolFixture({message:interceptionGone});
    f.cancel(); f.pause(overrides);
    await delay(5);
    assert.equal(f.closes(),1);
  }
});

test("a failed block, unexpected protocol error, or unavailable observer still fails closed",async()=>{
  const block=await protocolFixture({message:"Invalid InterceptionId",failDecision:true});
  block.cancel(); block.pause({responseStatusCode:302,responseHeaders:[{name:"location",value:"http://fixture.test/rejected"}]});
  await delay(5);
  assert.equal(block.closes(),1);
  const other=await protocolFixture({message:"Unknown protocol failure "+secret});
  other.cancel();other.pause();
  const unavailable=await protocolFixture({message:interceptionGone,network:false});
  unavailable.cancel();unavailable.pause();
  await delay(5);
  assert.equal(other.closes(),1);
  assert.equal(unavailable.closes(),1);
});

test("an unsupported worker never resumes",async()=>{
  const f=await protocolFixture();
  f.protocol.emit("Target.attachedToTarget",{sessionId:"worker",targetInfo:{type:"worker"}});
  await delay(5);
  assert.equal(f.closes(),1);
  assert.equal(f.methods.includes("Target.sendMessageToTarget"),false);
});

type ClickPage = Parameters<typeof clickProtectedControl>[0];
function controlFixture({failure,closed=false,url=null,textMatches=[true]}:{failure?:Error;closed?:boolean;url?:string|null;textMatches?:boolean[]}={}) {
  const actions:unknown[]=[];
  let matches=1;
  const locator={
    filter(options:{visible?:boolean}) { actions.push({visible:options.visible}); if(options.visible)matches=textMatches.filter(Boolean).length; return locator; },
    async evaluate(){if(failure)throw failure;if(matches!==1)throw Error("Ambiguous or unavailable");return url;},
    async click(){actions.push("click");},
  };
  const page={
    isClosed:()=>closed,
    locator(selector:string){actions.push({selector});return locator;},
    getByText(text:string,options:unknown){actions.push({text,options});matches=textMatches.length;return locator;},
  } as unknown as ClickPage;
  return {page,actions};
}
test("protected text clicks resolve the requested label and keep the same link validation as selector clicks",async()=>{
  const f=controlFixture({url:origin+"/next",textMatches:[false,true]});
  await clickProtectedControl(f.page,{text:"Continue",exact:true},url=>f.actions.push({url}));
  assert.deepEqual(f.actions,[{text:"Continue",options:{exact:true}},{visible:true},{url:origin+"/next"},"click"]);
  const denied=controlFixture({url:"https://foreign.test/next"});
  await assert.rejects(()=>clickProtectedControl(denied.page,{text:"Continue",exact:true},()=>{
    throw new ProtectedLoginError("navigation_blocked");
  }), (e:unknown)=>e instanceof ProtectedLoginError&&e.code==="navigation_blocked");
  assert.equal(denied.actions.includes("click"),false);
});

test("ambiguous or hidden-only text does not click any control",async()=>{
  for (const textMatches of [[true,false,true],[false,false]]) {
    const f=controlFixture({textMatches});
    await assert.rejects(()=>clickProtectedControl(f.page,{text:"Calendar",exact:true},()=>{}),
      (e:unknown)=>e instanceof ProtectedLoginError&&e.code==="protected_control_unavailable");
    assert.equal(f.actions.includes("click"),false);
  }
  console.log("PROTECTED_TEXT_REJECTS_MULTIPLE_VISIBLE_OR_HIDDEN_ONLY");
});

test("a missing or stale protected control gets safe actionable guidance, not a login-preparation error",async()=>{
  const f=controlFixture({failure:Error(secret)});
  const p=(code:string)=>(e:unknown)=>e instanceof ProtectedLoginError&&e.code===code&&!e.message.includes(secret);
  await assert.rejects(()=>clickProtectedControl(f.page,{selector:"#old"},()=>{}),p("protected_control_unavailable"));
  await assert.rejects(()=>clickProtectedControl(f.page,{},()=>{}),p("protected_control_unavailable"));
  const closed=controlFixture({failure:Error(secret),closed:true});
  await assert.rejects(()=>clickProtectedControl(closed.page,{text:"Continue"},()=>{}),p("session_unavailable"));
});
