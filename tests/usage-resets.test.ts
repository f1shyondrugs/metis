import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const root = mkdtempSync(path.join(os.tmpdir(), "metis-reset-test-"));
process.env.CHAT_DATA_DIR = root;
process.env.CHAT_DB_PATH = path.join(root, "chat.sqlite");
process.env.AGENT_CWD = root;
process.env.AI_CHAT_ROOT = root;
process.env.AI_CHAT_SECRETS_KEY = "01".repeat(32);
process.env.METIS_RESET_TEST_STATE = path.join(root, "provider.json");
delete process.env.CHAT_LEGACY_HEADER_AUTH;
process.env.CODEX_BIN = path.join(root, "fake-codex");
writeFileSync(process.env.CODEX_BIN, `#!/usr/bin/env node
const fs=require("node:fs"),path=require("node:path"),readline=require("node:readline");
const account=JSON.parse(fs.readFileSync(path.join(process.env.CODEX_HOME,"auth.json"),"utf8")).tokens.account_id;
const file=process.env.METIS_RESET_TEST_STATE;
const send=(id,result)=>process.stdout.write(JSON.stringify({id,result})+"\\n");
readline.createInterface({input:process.stdin}).on("line",line=>{
const m=JSON.parse(line);
if(m.method==="initialize")return send(m.id,{userAgent:"test"});
if(m.method==="account/rateLimits/read"){
const state=JSON.parse(fs.readFileSync(file,"utf8"));
return send(m.id,{accountId:account,rateLimits:{primary:{usedPercent:100,windowDurationMins:300}},rateLimitResetCredits:{
availableCount:state.used?0:1,credits:m.params?.excludeResetCreditDetails?null:state.used?[]:[{id:"credit-"+account,title:"Full reset",resetType:"codexRateLimits",status:"available",grantedAt:Math.floor(Date.now()/1000)-100,expiresAt:Math.floor(Date.now()/1000)+3600}]
}});
}
if(m.method==="account/rateLimitResetCredit/consume"){
const state=JSON.parse(fs.readFileSync(file,"utf8"));
state.calls.push({key:m.params.idempotencyKey,id:m.params.creditId,account});
let outcome;
if(state.keys.includes(m.params.idempotencyKey))outcome="alreadyRedeemed";
else{state.keys.push(m.params.idempotencyKey);state.used=true;outcome="reset";}
fs.writeFileSync(file,JSON.stringify(state));
return send(m.id,{outcome:state.uncertain?"unexpected":outcome});
}
});
`, { mode: 0o755 });
const state = (value: object = {}) => writeFileSync(process.env.METIS_RESET_TEST_STATE!, JSON.stringify({ used: false, keys: [], calls: [], ...value }));
const current = () => JSON.parse(readFileSync(process.env.METIS_RESET_TEST_STATE!, "utf8"));
test.after(() => rmSync(root, { recursive: true, force: true }));

test("reset availability, confirmations, owner boundaries, replay protection and idempotent recovery", async () => {
  const auth = await import("../lib/auth");
  const connections = await import("../lib/provider-connections");
  const service = await import("../lib/usage-resets");
  const api = await import("../app/api/usage-resets/route");
  const { getDatabase } = await import("../lib/sqlite");
  const owner = auth.createUser("reset-owner", "test-password");
  const other = auth.createUser("reset-other", "test-password");
  const token = auth.authenticateUser(owner.username, "test-password")!.token;
  const otherToken = auth.authenticateUser(other.username, "test-password")!.token;
  const connection = connections.upsertProviderConnection(owner.id, {
    providerKey: "codex", authType: "account", slug: "codex-one", label: "Test account", secret: JSON.stringify({ tokens: { account_id: "account-one" } }),
  });
  const second = connections.upsertProviderConnection(owner.id, {
    providerKey: "codex", authType: "account", slug: "codex-two", label: "Second account", secret: JSON.stringify({ tokens: { account_id: "account-two" } }),
  });
  assert.ok(connection && second);
  const request = (body?: object, session: string | undefined = token, origin?: string) => new Request("http://test/api/usage-resets", {
    method: body ? "POST" : "GET",
    headers: { ...(session ? { cookie: "ai_chat_auth=" + session } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(origin ? { origin } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  state();
  assert.equal((await api.GET(new Request("http://test/api/usage-resets"))).status, 401);
  assert.equal((await api.POST(request({ action: "prepare", connectionId: connection.id, creditId: "credit-account-one" }, token, "https://foreign.test"))).status, 403);
  assert.equal(current().calls.length, 0);
  const catalog = service.usageResetCatalog(owner.id);
  assert.ok(catalog.providers.length >= 13);
  assert.equal(catalog.connections.length, 2);
  assert.equal(catalog.providers.find(p => p.key === "codex")!.status, "integrated");
  assert.equal(catalog.providers.find(p => p.key === "ollama")!.status, "not_exposed");
  const { getPlanUsage } = await import("../lib/plan-usage");
  const quota = await getPlanUsage(true, owner.id);
  assert.equal(quota.providers.find(p => p.key === "codex")?.extra?.resetCredits, 1, "the footer receives the authoritative count without credit details");
  assert.equal(current().calls.length, 0, "quota polling must not redeem credits");
  const read = await service.getUsageResets(owner.id, connection.id);
  assert.equal(read.availableCount, 1);
  assert.equal(current().calls.length, 0, "reads must never redeem a credit");
  await assert.rejects(service.getUsageResets(other.id, connection.id), /not found/);
  const review = await service.prepareUsageReset(owner.id, connection.id, "credit-account-one");
  assert.equal(current().calls.length, 0, "opening confirmation must not redeem");
  assert.equal((await api.POST(request({ action: "consume", connectionId: connection.id, id: review.id, token: review.token, confirmed: false }))).status, 409);
  assert.equal((await api.POST(request({ action: "consume", connectionId: connection.id, id: review.id, token: review.token, confirmed: true }, otherToken))).status, 404);
  await assert.rejects(service.consumeUsageReset(owner.id, second.id, review.id, review.token, true), /not found/);
  assert.equal(current().calls.length, 0);
  const result = await service.consumeUsageReset(owner.id, connection.id, review.id, review.token, true);
  assert.equal(result.outcome, "reset");
  assert.equal((await getPlanUsage(true, owner.id)).providers.find(p => p.key === "codex")?.extra?.resetCredits, 0, "refresh updates the footer after consumption");
  assert.equal(current().calls.length, 1);
  assert.equal(current().calls[0].id, "credit-account-one");
  await assert.rejects(service.consumeUsageReset(owner.id, connection.id, review.id, review.token, true), /already used/);
  assert.equal(current().calls.length, 1);
  assert.equal(service.usageResetHistory(owner.id, connection.id)[0].status, "reset");
  assert.equal(service.usageResetHistory(other.id).length, 0);

  state();
  const expired = await service.prepareUsageReset(owner.id, second.id, "credit-account-two");
  getDatabase().prepare("UPDATE usage_reset_actions SET confirmation_expires_at=0 WHERE id=?").run(expired.id);
  await assert.rejects(service.consumeUsageReset(owner.id, second.id, expired.id, expired.token, true), /expired/);
  assert.equal(current().calls.length, 0);

  state({ uncertain: true });
  const uncertain = await service.prepareUsageReset(owner.id, second.id, "credit-account-two");
  await assert.rejects(service.consumeUsageReset(owner.id, second.id, uncertain.id, uncertain.token, true), /could not be confirmed/);
  assert.equal(current().calls.length, 1);
  const firstKey = current().calls[0].key;
  assert.equal(service.usageResetHistory(owner.id, second.id)[0].status, "unknown");
  state({ used: true, keys: [firstKey], calls: current().calls });
  const retry = await service.prepareUsageReset(owner.id, second.id, undefined, uncertain.id);
  assert.equal(current().calls.length, 1, "reviewing retry must not send a consume request");
  const recovered = await service.consumeUsageReset(owner.id, second.id, retry.id, retry.token, true);
  assert.equal(recovered.outcome, "alreadyRedeemed");
  assert.equal(current().calls[1].key, firstKey);

  state();
  const third = connections.upsertProviderConnection(owner.id, {
    providerKey: "codex", authType: "account", slug: "codex-three", label: "Third account", secret: JSON.stringify({ tokens: { account_id: "account-three" } }),
  });
  assert.ok(third);
  const concurrent = await service.prepareUsageReset(owner.id, third.id, "credit-account-three");
  const raced = await Promise.allSettled([
    service.consumeUsageReset(owner.id, third.id, concurrent.id, concurrent.token, true),
    service.consumeUsageReset(owner.id, third.id, concurrent.id, concurrent.token, true),
  ]);
  assert.equal(raced.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(current().calls.length, 1, "parallel confirmation requests redeem only once");

  state();
  const fourth = connections.upsertProviderConnection(owner.id, {
    providerKey: "codex", authType: "account", slug: "codex-four", label: "Fourth account", secret: JSON.stringify({ tokens: { account_id: "account-four" } }),
  });
  assert.ok(fourth);
  const switched = await service.prepareUsageReset(owner.id, fourth.id, "credit-account-four");
  connections.updateProviderConnection(fourth.id, owner.id, { secret: JSON.stringify({ tokens: { account_id: "different-account" } }) });
  await assert.rejects(service.consumeUsageReset(owner.id, fourth.id, switched.id, switched.token, true), /account changed/);
  assert.equal(current().calls.length, 0);
  const binary = process.env.CODEX_BIN;
  try {
    process.env.CODEX_BIN = path.join(root, "missing-cli");
    const unavailable = await service.getUsageResets(owner.id, connection.id);
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.availableCount, null);
    assert.ok(unavailable.history.length > 0, "history must remain available when live reads fail");
  } finally { process.env.CODEX_BIN = binary; }
});

test("reset parsing distinguishes count-only, unavailable, partial details and invalid expiry", async () => {
  const { parseResetCredits, resetCreditUsable } = await import("../lib/usage-reset-types");
  assert.equal(parseResetCredits(undefined), null);
  assert.deepEqual(parseResetCredits({ availableCount: 3, credits: null }), { availableCount: 3, credits: [], detailsAvailable: false });
  const parsed = parseResetCredits({ availableCount: 3, credits: [
    { id: "a", resetType: "codexRateLimits", status: "available", expiresAt: "invalid" },
    { id: "b", resetType: "unknown", status: "available", expiresAt: null },
    { id: "c", resetType: "codexRateLimits", status: "available", expiresAt: Date.now() / 1000 - 100 },
  ] })!;
  assert.equal(parsed.availableCount, 3);
  assert.ok(parsed.credits.every(c => !resetCreditUsable(c)));
});

test("account RPC resolves Windows npm shims through the declared Node launcher", async () => {
  const { codexAccountCommand } = await import("../lib/providers/codex-account");
  const modules = path.join(root, "path & spaces", "node_modules");
  const pkg = path.join(modules, "@openai", "codex");
  mkdirSync(path.join(pkg, "bin"), { recursive: true });
  writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ bin: { codex: "bin/launcher.js" } }));
  const entry = path.join(pkg, "bin", "launcher.js");
  writeFileSync(entry, "// fixture");
  const command = codexAccountCommand(path.join(modules, ".bin", "codex.cmd"), "win32");
  assert.equal(command.command, process.execPath);
  assert.deepEqual(command.args, [entry, "app-server", "--stdio"]);
  assert.equal(codexAccountCommand("codex.exe", "win32").command, "codex.exe");
  assert.equal(codexAccountCommand("/fixture/codex", "linux").command, "/fixture/codex");
});
