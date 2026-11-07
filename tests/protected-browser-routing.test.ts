import test from "node:test";
import assert from "node:assert/strict";
import { ProtectedBrowserRouting } from "../lib/protected-browser-routing";
import { ProtectedLoginError } from "../lib/protected-login-errors";

test("readiness routes school selection privately and repeated prepare never reads the stale ordinary tab", async () => {
  const calls: Array<{owner:string;chat:string;operation:string;input:Record<string,unknown>}> = [];
  let targetReads = 0;
  const trustedUrl = "https://portal.test/login?campus=example";
  const router = new ProtectedBrowserRouting(async (owner,chat,operation,input) => {
    calls.push({owner,chat,operation,input:input??{}});
    return operation === "prepare" ? {status:"protected_browser_ready", missingFields:["username","password"]} : {tabId:"protected"};
  }, async (owner,chat,tabId) => {
    targetReads++;
    assert.deepEqual([owner,chat,tabId], ["owner-a","chat-a","tab-a"]);
    return trustedUrl;
  });
  await router.prepare("owner-a","chat-a",{tabId:"tab-a",fields:["username","password"]});
  assert.equal(router.has("owner-a","chat-a"), true);
  assert.equal(router.has("owner-b","chat-a"), false);
  assert.equal(router.has("owner-a","chat-b"), false);
  await router.action("owner-a","chat-a",{action:"select_option",selector:"#school",value:"school-a"});
  await router.prepare("owner-a","chat-a",{tabId:"tab-a",fields:["username","password"]});
  assert.equal(targetReads, 1);
  assert.equal(calls[0].input.url, trustedUrl);
  assert.equal(calls[1].operation, "action");
  assert.equal(calls[1].input.value, "school-a");
  assert.equal(Object.hasOwn(calls[2].input,"url"), false);
  await router.action("owner-a","chat-a",{action:"close"});
  assert.equal(router.has("owner-a","chat-a"), false);
});

test("field correction stays on the private page while transport failures do not select it", async () => {
  for (const [code, active] of [["field_ambiguous",true], ["unsafe_target",true], ["invalid_fields",true], ["session_limit",false], ["protected_login_unavailable",false]] as const) {
    const router = new ProtectedBrowserRouting(async () => { throw new ProtectedLoginError(code); }, async () => "https://portal.test/");
    await assert.rejects(router.prepare("owner","chat",{}), error => error instanceof ProtectedLoginError && error.code === code);
    assert.equal(router.has("owner","chat"), active);
  }
});

test("expired or restarted private sessions release routing and can be explicitly reopened", async () => {
  for (const operation of ["prepare","action"]) {
    let unavailable = false;
    let targets = 0;
    const router = new ProtectedBrowserRouting(async (_owner,_chat,op) => {
      if (unavailable && op !== "close") throw new ProtectedLoginError("session_unavailable");
      return {status:"protected_browser_ready"};
    }, async () => { targets++; return "https://portal.test/"; });
    await router.prepare("owner","chat",{});
    unavailable = true;
    await assert.rejects(operation === "prepare" ? router.prepare("owner","chat",{}) : router.action("owner","chat",{action:"form_state"}), error => error instanceof ProtectedLoginError && error.code === "session_unavailable");
    assert.equal(router.has("owner","chat"), false);
    await router.action("owner","chat",{action:"close"});
    unavailable = false;
    await router.prepare("owner","chat",{});
    assert.equal(router.has("owner","chat"), true);
    assert.equal(targets, 2);
  }
});

test("explicit protected tab restores routing without reading or creating an ordinary tab", async () => {
  const calls: string[] = [];
  const router = new ProtectedBrowserRouting(async (_owner,_chat,operation,input) => {
    calls.push(operation);
    assert(!input || !Object.hasOwn(input,"url"));
    return {status:"protected_browser_ready"};
  }, async () => { throw Error("Must not read ordinary tab"); });
  await router.prepare("owner","chat",{tabId:"protected",fields:["password"]});
  await router.action("owner","chat",{action:"form_state",tabId:"protected"});
  assert.deepEqual(calls, ["prepare","action"]);
  assert.equal(router.has("owner","chat"), true);
});
