import assert from "node:assert/strict";
import test from "node:test";
import { prepareProtectedConsole } from "../lib/protected-console-login";
import type { ProtectedLoginReply } from "../lib/protected-login-contract";

const bound = JSON.stringify(["ssh","host.test",2222,"ops","ops","SHA256:valid-key"]);
const oldKey = JSON.stringify(["ssh","host.test",2222,"ops","ops","SHA256:old-key"]);
const login = { action:"connect", method:"ssh", user:"ops", host:"Host.Test", port:2222 } as const;
const prompt = {
  status:"input_required", target:bound, sessionId:"session-1",
  secureInput:{ kind:"console", sessionId:"session-1", requestId:"one-time", origin:"ssh: ops@host.test",
    expiresAt:"2099-01-01T00:00:00.000Z" },
} satisfies ProtectedLoginReply;
const savedEntry = (origin:string) => ({ origin, kind:"console", password:"MUST-NOT-APPEAR" });

function transport(saved: ProtectedLoginReply | Error, replied: ProtectedLoginReply | Error) {
  const calls: string[]=[];
  const request: Parameters<typeof prepareProtectedConsole>[3] = async (owner,chat,op,data,management) => {
    assert.equal(owner,"owner");
    assert.equal(chat,"chat");
    calls.push(op);
    if(op==="list") {
      assert.equal(management,true);
      assert.deepEqual(data,{});
      if(saved instanceof Error) throw saved;
      return saved;
    }
    assert.ok(op==="console_prepare"||op==="console_elevate");
    assert.notEqual(management,true);
    if(replied instanceof Error) throw replied;
    return replied;
  };
  return {request,calls};
}

test("console checks the account vault first and reuses only a broker-approved credential",async()=>{
  const {request,calls}=transport({credentials:[savedEntry(bound)]},{status:"console_password_entered",sessionId:"session-1",password:"SECRET"});
  assert.deepEqual(await prepareProtectedConsole("owner","chat",login,request),{
    status:"console_password_entered",sessionId:"session-1",vaultStatus:"matching_entry",
  });
  assert.deepEqual(calls,["list","console_prepare"]);
});

test("missing target, unavailable vault and verified protected prompt are distinct",async()=>{
  for(const [saved,expected] of [
    [{credentials:[]},"no_matching_entry"],
    [{credentials:[savedEntry(oldKey)]},"no_matching_entry"],
    [{credentials:[savedEntry(bound)]},"matching_entry"],
    [new Error("VAULT-PRIVATE-DETAIL"),"vault_unavailable"],
    [{status:"unexpected"},"vault_unavailable"],
    [{credentials:[],partial:true,unavailable:["console"]},"vault_unavailable"],
  ] as const){
    const {request}=transport(saved as ProtectedLoginReply|Error,prompt);
    const answer=await prepareProtectedConsole("owner","chat",login,request);
    assert.equal(answer.status,"input_required");
    assert.equal(answer.vaultStatus,expected);
    assert.deepEqual(answer.secureInput,prompt.secureInput);
    assert.doesNotMatch(JSON.stringify(answer),/VAULT-PRIVATE-DETAIL|MUST-NOT-APPEAR/);
  }
});

test("local sudo policy denial never exposes broker output or opens a password form",async()=>{
  const {request,calls}=transport({credentials:[]},{
    status:"console_unavailable", sessionId:"id", output:'sudo: The "no new privileges" flag is set. PRIVATE-DIAGNOSTIC',
    secureInput:prompt.secureInput,
  });
  const answer=await prepareProtectedConsole("owner","chat",{action:"connect",method:"sudo",user:"root"},request);
  assert.equal(answer.status,"console_policy_blocked");
  assert.equal(answer.vaultStatus,"target_not_verified");
  assert.equal(answer.secureInput,undefined);
  assert.doesNotMatch(JSON.stringify(answer),/PRIVATE-DIAGNOSTIC|one-time/);
  assert.deepEqual(calls,["list","console_prepare"]);
  assert.equal((await prepareProtectedConsole("owner","chat",login,request)).status,"console_unavailable","SSH output is not local server policy");
});

test("an invalid, stale, or differently bound broker prompt cannot open protected input",async()=>{
  const bad: ProtectedLoginReply[] = [
    { ...prompt, target:bound.replace('"ops","ops"','"other","other"') },
    { ...prompt, secureInput:undefined },
    { ...prompt, secureInput:{...prompt.secureInput,sessionId:"someone-else"} },
    { ...prompt, secureInput:{...prompt.secureInput,expiresAt:"2000-01-01T00:00:00.000Z"} },
  ];
  for(const reply of bad){
    const {request}=transport({credentials:[]},reply);
    const result=await prepareProtectedConsole("owner","chat",login,request);
    assert.equal(result.status,"console_unavailable");
    assert.equal(result.secureInput,undefined);
  }
});
