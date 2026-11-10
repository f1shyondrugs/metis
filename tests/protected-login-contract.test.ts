import assert from "node:assert/strict";
import test from "node:test";
import {MAX_PROTECTED_LOGIN_REPLY_BYTES,parseProtectedLoginReply,requireProtectedInput,requireProtectedForm} from "../lib/protected-login-contract";

test("private transport rejects malformed credential metadata before opening a question", () => {
  for(const reply of [null, [], "status", {secureInput:{requestId:7,origin:"https://example.test",expiresAt:"later"}},
    {secureInput:{requestId:"fixture",origin:"https://example.test",expiresAt:"later",fields:["token"]}},
    {filled:"yes"}, {scope:"another-owner"}]) {
    assert.throws(()=>parseProtectedLoginReply(reply));
  }
});

test("status-only replies cannot be treated as a credential request or protected form", () => {
  const reply=parseProtectedLoginReply({status:"protected_browser_ready",code:"credential_fields_not_visible"});
  assert.throws(()=>requireProtectedInput(reply));
  assert.throws(()=>requireProtectedForm(reply));
  assert.equal(reply.code,"credential_fields_not_visible");
});

test("private image replies can exceed the old one-MiB cap but remain bounded",()=>{
 const screenshot="a".repeat(1024*1024+1);
 assert.equal(parseProtectedLoginReply({screenshot}).screenshot,screenshot);
 assert.throws(()=>parseProtectedLoginReply({screenshot:42}));
 assert.throws(()=>parseProtectedLoginReply({screenshot:"a".repeat(MAX_PROTECTED_LOGIN_REPLY_BYTES+1)}));
});
test("validated requests preserve the selected fields and console binding", () => {
  const input={requestId:"synthetic-request",origin:"su: fixture",expiresAt:"2099-01-01T00:00:00Z",
    kind:"console" as const,sessionId:"synthetic-session",fields:["password"]};
  const reply=parseProtectedLoginReply({status:"input_required",secureInput:input,target:"synthetic-target"});
  assert.deepEqual(requireProtectedInput(reply),input);
  assert.equal(reply.target,"synthetic-target");
});
