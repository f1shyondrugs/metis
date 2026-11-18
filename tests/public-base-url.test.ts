import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, mock, test } from "node:test";
import { chatShareUrl, publicShareUrl, resolvePublicBaseUrl, skillShareToken } from "../lib/public-base-url";

const token = "1".repeat(48);
const skillPath = "/skills/share/" + token;

test("normalizes one explicit app URL for all share paths, with no browser-address fallback", () => {
  const base = resolvePublicBaseUrl(" https://METIS.example:443/metis/// ");
  assert.deepEqual(base, { state: "configured", url: "https://metis.example/metis" });
  assert.equal(chatShareUrl(base, "chat+id"), "https://metis.example/metis/share?id=chat%2Bid");
  for (const path of ["/share/notes/note", "/p/profile", skillPath]) {
    assert.equal(publicShareUrl(base, path), "https://metis.example/metis" + path);
  }
  for (const path of ["//foreign.example", "/\\foreign.example", "https://foreign.example"]) {
    assert.equal(publicShareUrl(base, path), null);
  }
  assert.equal(chatShareUrl(resolvePublicBaseUrl(undefined), "chat"), null);
  for (const raw of ["http://localhost:3100", "http://127.42.2.8", "http://127.1", "http://[::1]", "http://0.0.0.0", "http://[::]", "http://[::ffff:127.0.0.1]"]) {
    const local = resolvePublicBaseUrl(raw);
    assert.equal(local.state, "local", raw);
    assert.equal(publicShareUrl(local, skillPath), null);
  }
  for (const raw of ["ftp://metis.example", "metis.example", "https://user@host", "https://metis.example/?", "https://metis.example/#", "https:///path", "https://metis.example/a b", "https://metis.example:99999"]) {
    assert.deepEqual(resolvePublicBaseUrl(raw), { state: "invalid" }, raw);
  }
  assert.deepEqual(resolvePublicBaseUrl("http://192.168.10.8:3100/"), { state: "configured", url: "http://192.168.10.8:3100" });
});

test("skill import accepts a canonical link while the workspace is open under an alias", () => {
  const base = resolvePublicBaseUrl("https://metis.example/metis/");
  const alias = "http://lan-device:3100";
  assert.equal(skillShareToken("https://metis.example/metis" + skillPath, alias, base), token);
  assert.equal(skillShareToken(alias + skillPath, alias, base), token);
  assert.equal(skillShareToken(token, alias, base), token);
  assert.throws(() => skillShareToken("https://other.example" + skillPath, alias, base), /this Metis workspace/);
  assert.throws(() => skillShareToken("https://metis.example/metis-other" + skillPath, alias, base), /this Metis workspace/);
});

const temp = mkdtempSync(path.join(os.tmpdir(), "metis-base-url-"));
let origin: string;
let redirectRequests = 0;
const challenges: string[] = [];
let instanceProof: typeof import("../app/api/instance-proof/route").GET;
let setupPost: typeof import("../app/api/setup/route").POST;
let check: typeof import("../lib/public-base-check").checkPublicBaseUrl;

const fixture = createServer(async (req, res) => {
  const url = new URL(req.url || "/", origin);
  assert.equal(req.headers.cookie, undefined);
  assert.equal(req.headers.authorization, undefined);
  const challenge = url.searchParams.get("challenge") ?? "";
  assert.match(challenge, /^[a-f0-9]{64}$/);
  if (url.pathname.startsWith("/wrong/")) {
    const proof = createHmac("sha256", "isolated other installation key").update("metis:public-base:v1:" + challenge).digest("hex");
    res.writeHead(204, { "X-Metis-Instance-Proof": proof }).end();
  } else if (url.pathname.startsWith("/redirect/")) {
    res.writeHead(307, { Location: origin + "/redirect-target?challenge=" + challenge }).end();
  } else if (url.pathname === "/redirect-target") {
    redirectRequests++;
    res.writeHead(500).end();
  } else if (url.pathname.startsWith("/html/")) {
    res.writeHead(200, { "Content-Type": "text/html" }).end("<title>Metis</title>");
  } else if (url.pathname.startsWith("/forbidden/")) {
    res.writeHead(403).end();
  } else if (url.pathname.startsWith("/slow/")) {
    // The client timeout must also bound a server that never sends headers.
    return;
  } else {
    assert.equal(url.pathname, "/api/instance-proof");
    challenges.push(challenge);
    const result = instanceProof(new Request(url));
    res.writeHead(result.status, Object.fromEntries(result.headers)).end();
  }
});

const operatorToken = "synthetic-test-operator-token-not-a-production-value";
const setupRequest = (fields: Record<string, unknown>, headers: Record<string, string> = {}) => setupPost(new Request(origin + "/api/setup", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify({ action: "check-public-url", ...fields }),
}));

before(async () => {
  await new Promise<void>((resolve, reject) => {
    fixture.once("error", reject);
    fixture.listen(0, "127.0.0.1", resolve);
  });
  const address = fixture.address();
  assert(address && typeof address !== "string");
  origin = "http://127.0.0.1:" + address.port;
  Object.assign(process.env, {
    AI_CHAT_PUBLIC_URL: origin, AI_CHAT_ROOT: temp, AGENT_CWD: temp,
    CHAT_DATA_DIR: temp, CHAT_DB_PATH: path.join(temp, "test.sqlite"), AI_CHAT_SETUP_TOKEN: operatorToken,
  });
  delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;
  ({ GET: instanceProof } = await import("../app/api/instance-proof/route"));
  ({ POST: setupPost } = await import("../app/api/setup/route"));
  ({ checkPublicBaseUrl: check } = await import("../lib/public-base-check"));
});

after(async () => {
  fixture.closeAllConnections();
  await new Promise<void>(resolve => fixture.close(() => resolve()));
  rmSync(temp, { recursive: true, force: true });
});

test("setup checks only the operator-configured address and does not consume the setup token", async () => {
  const unauthenticated = await setupRequest({ url: origin + "/wrong" });
  assert.equal(unauthenticated.status, 403);
  assert.equal(challenges.length, 0);
  for (let i = 0; i < 2; i++) {
    const response = await setupRequest({ setupToken: operatorToken, url: origin + "/wrong" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { check: { state: "verified" } });
  }
  assert.equal(challenges.length, 2);
  assert.notEqual(challenges[0], challenges[1]);
  assert.notEqual(
    instanceProof(new Request(origin + "/api/instance-proof?challenge=" + challenges[0])).headers.get("x-metis-instance-proof"),
    instanceProof(new Request(origin + "/api/instance-proof?challenge=" + challenges[1])).headers.get("x-metis-instance-proof"),
  );
  assert.equal(instanceProof(new Request(origin + "/api/instance-proof?challenge=bad")).status, 400);
  assert.equal(instanceProof(new Request(origin + "/api/instance-proof")).headers.get("x-metis-instance-proof"), null);
});

test("configured address is not verified for another instance, HTML, redirects, HTTP errors or timeouts", async () => {
  for (const [suffix, expected] of [
    ["/wrong", { state: "other_instance" }],
    ["/html", { state: "not_metis" }],
    ["/redirect", { state: "redirect", status: 307 }],
    ["/forbidden", { state: "http_error", status: 403 }],
    ["/slow", { state: "unreachable" }],
  ] as const) {
    assert.deepEqual(await check(resolvePublicBaseUrl(origin + suffix)), expected);
  }
  assert.equal(redirectRequests, 0);
  assert.deepEqual(await check(resolvePublicBaseUrl(undefined)), { state: "unset" });
  assert.deepEqual(await check(resolvePublicBaseUrl("invalid")), { state: "invalid" });
});

test("only the signed-in setup admin can save a verified public URL; private destinations never connect", async () => {
  assert.equal((await setupRequest({ publicUrl: "https://metis.example", setupToken: operatorToken })).status, 403);
  const creation = await setupRequest({ action: "bootstrap", username: "url-fixture-admin", password: "fixture-password-12", setupToken: operatorToken });
  assert.equal(creation.status, 201);
  const cookie = creation.headers.get("set-cookie")?.split(";")[0] || "";
  assert(cookie);
  const { getPublicBaseUrl } = await import("../lib/public-base-settings");
  assert.equal((await setupRequest({ publicUrl: "https://metis.example" }, { cookie, origin: "https://foreign.example" })).status, 403);
  assert.deepEqual(await (await setupRequest({ publicUrl: "http://metis.example" }, { cookie })).json(), { check: { state: "https_required" } });
  assert.deepEqual(await (await setupRequest({ publicUrl: "https://192.168.1.10" }, { cookie })).json(), { check: { state: "unsafe_url" } });
  assert.deepEqual(getPublicBaseUrl(), resolvePublicBaseUrl(origin));

  let secureRequests = 0;
  let correctInstance = false;
  const address = "93.184.216.34";
  const resolver = mock.method(dns, "lookup", (async () => [{ address, family: 4 }]) as unknown as typeof dns.lookup);
  const transport = mock.method(https, "request", ((target: URL, options: https.RequestOptions, onResponse: (response: unknown) => void) => {
    secureRequests++;
    assert.equal(target.origin, "https://metis.example");
    assert.equal(target.pathname, "/api/instance-proof");
    assert.equal(options.agent, false);
    assert.equal(options.family, 4);
    assert(!options.headers || !Object.keys(options.headers).some(name => /^(cookie|authorization)$/i.test(name)));
    const pinnedLookup = options.lookup as (hostname: string, options: object, cb: (error: Error | null, ip: string, family: number) => void) => void;
    pinnedLookup("metis.example", {}, (error, ip, family) => {
      assert.equal(error, null); assert.equal(ip, address); assert.equal(family, 4);
    });
    const returned = correctInstance ? instanceProof(new Request(target)).headers.get("x-metis-instance-proof") : "1".repeat(64);
    return Object.assign(new EventEmitter(), { end() {
      onResponse({ statusCode: 204, headers: { "x-metis-instance-proof": returned }, destroy() {} });
    } });
  }) as unknown as typeof https.request);
  try {
    const wrong = await setupRequest({ publicUrl: "https://metis.example" }, { cookie });
    assert.deepEqual(await wrong.json(), { check: { state: "other_instance" } });
    assert.deepEqual(getPublicBaseUrl(), resolvePublicBaseUrl(origin));
    correctInstance = true;
    const verified = await setupRequest({ publicUrl: "https://metis.example/" }, { cookie });
    const base = resolvePublicBaseUrl("https://metis.example");
    assert.deepEqual(await verified.json(), { check: { state: "verified" }, base });
    assert.deepEqual(getPublicBaseUrl(), base);
    assert.equal(chatShareUrl(getPublicBaseUrl(), "test"), "https://metis.example/share?id=test");
    assert.equal(secureRequests, 2);

    const { config } = await import("../lib/config");
    const writable = config as { publicBaseUrl: ReturnType<typeof resolvePublicBaseUrl> };
    const oldDefault = writable.publicBaseUrl;
    try {
      writable.publicBaseUrl = resolvePublicBaseUrl("https://operator-change.example");
      assert.deepEqual(getPublicBaseUrl(), writable.publicBaseUrl);
    } finally { writable.publicBaseUrl = oldDefault; }
    assert.equal((await setupRequest({ action: "complete" }, { cookie })).status, 200);
    assert.equal((await setupRequest({ publicUrl: "https://metis.example" }, { cookie })).status, 403);
  } finally { transport.mock.restore(); resolver.mock.restore(); }
});
