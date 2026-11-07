import assert from "node:assert/strict";
import test from "node:test";
import { createReferenceLookup, referenceMatches } from "../lib/reference-search";

test("reference search matches words independently, accents, Unicode and German spelling", () => {
  assert.equal(referenceMatches("marz strasse", "Straße", "MÄRZ"), true);
  assert.equal(referenceMatches("LAUNCH checklist", "Launch notes", "checklist"), true);
  assert.equal(referenceMatches("missing", "Launch notes"), false);
  assert.equal(referenceMatches("   ", "Any"), true);
  assert.equal(referenceMatches("alpha beta", "alpha", undefined, "BÉTA"), true);
  assert.equal(referenceMatches("alpha", "al", "pha"), false);
  assert.equal(referenceMatches("alpha gamma", "alpha", "beta"), false);
  assert.equal(referenceMatches("launch", "Launch", "x".repeat(1_000_000)), true);
});

test("late and aborted lookups cannot replace a newer category or repopulate a closed menu", async () => {
  const pending: Array<{resolve: (r: Response) => void; url: string}> = [];
  const lookup = createReferenceLookup<string>(((url: string) => new Promise<Response>(resolve => pending.push({resolve, url}))) as typeof fetch);
  const states: Array<{key: string; status: string; results: string[]}> = [];
  const first = lookup.load({ key: "old", kind: "note", query: "old", chatId: "current" }, state => states.push(state));
  const next = lookup.load({ key: "new", kind: "canvas", query: "architecture", chatId: "current" }, state => states.push(state));
  assert.match(pending[1].url, /kind=canvas/);
  pending[1].resolve(Response.json({ results: ["Correct canvas"] })); await next;
  pending[0].resolve(Response.json({ results: ["Stale note"] })); await first;
  assert.deepEqual(states.at(-1)?.results, ["Correct canvas"]);
  assert.ok(!states.some(s => s.results.includes("Stale note")));
  const closed = lookup.load({ key: "closed", kind: "chat", query: "" }, state => states.push(state));
  lookup.cancel();
  pending[2].resolve(Response.json({ results: ["After close"] })); await closed;
  assert.ok(!states.some(s => s.results.includes("After close")));
});

test("index preparation keeps polling and cancellation stops the next request",async()=>{
 let requests=0;
 const lookup=createReferenceLookup<string>((async()=>{requests++;return Response.json({results:["Partial"],indexing:true});}) as typeof fetch);
 const states:unknown[]=[];
 const pending=lookup.load({query:"",key:"index"},state=>states.push(state));
 await new Promise(resolve=>setTimeout(resolve,30));
 lookup.cancel();
 await pending;
 assert.equal(requests,1);
 assert.ok(states.length>=2);
});

test("unfiltered searches omit kind, and document-only searches declare their scope", async () => {
  const urls:string[]=[];
  const lookup=createReferenceLookup<string>((async url=>{urls.push(String(url));return Response.json({results:["Ready"]});}) as typeof fetch);
  await lookup.load({key:"all",query:"launch"},()=>{});
  assert.ok(!new URL(urls[0],"http://test").searchParams.has("kind"));
  await lookup.load({key:"docs",query:"child",kinds:["note","canvas","plan"]},()=>{});
  assert.equal(new URL(urls[1],"http://test").searchParams.get("kinds"),"note,canvas,plan");
});

test("a stalled response times out even when transport ignores abort", async () => {
  let signal:AbortSignal|undefined;
  const lookup=createReferenceLookup<string>(((url,init)=>{signal=init?.signal as AbortSignal;return new Promise(()=>{});}) as typeof fetch,{requestTimeoutMs:10});
  const states:Array<{status:string;error?:string}>=[];
  await lookup.load({query:"immediate",key:"slow"},state=>states.push(state));
  assert.equal(states.at(-1)?.status,"error");assert.match(states.at(-1)?.error||"",/timed out/);assert.equal(signal?.aborted,true);
});

test("indexing yields partial results and stops polling with a retry notice", async () => {
  let requests=0;
  const lookup=createReferenceLookup<string>((async()=>{requests++;return Response.json({results:["Available note"],indexing:true});}) as typeof fetch,{maxIndexPolls:2,pollIntervalMs:1});
  const states:Array<{status:string;results:string[];indexing?:boolean;notice?:string}>=[];
  await lookup.load({query:"note",key:"partial"},state=>states.push(state));
  assert.equal(requests,2);assert.deepEqual(states[1].results,["Available note"]);assert.equal(states[1].status,"ready");
  assert.equal(states.at(-1)?.indexing,false);assert.match(states.at(-1)?.notice||"",/still being indexed/);
});

test("a later file-index failure preserves already available references", async () => {
  let requests=0;
  const lookup=createReferenceLookup<string>((async()=>++requests===1?Response.json({results:["Ready note"],indexing:true}):Response.json({}, {status:503})) as typeof fetch,{pollIntervalMs:1});
  const states:Array<{status:string;results:string[];notice?:string}>=[];
  await lookup.load({query:"note",key:"failure"},state=>states.push(state));
  assert.equal(states.at(-1)?.status,"ready");assert.deepEqual(states.at(-1)?.results,["Ready note"]);assert.match(states.at(-1)?.notice||"",/Try again/);
});

test("lookup exposes errors and a fresh retry replaces them with real results", async () => {
  let attempts = 0;
  const lookup = createReferenceLookup<string>((async () => ++attempts === 1
    ? Response.json({ error: "Internal error" }, { status: 500 })
    : Response.json({ results: ["Recovered"] })) as typeof fetch);
  const states: Array<{status: string; results: string[]; error?: string}> = [];
  const input = { key: "request", query: "", kind: "note" as const };
  await lookup.load(input, state => states.push(state));
  assert.equal(states.at(-1)?.status, "error");
  assert.match(states.at(-1)?.error || "", /Try again/);
  await lookup.load(input, state => states.push(state));
  assert.deepEqual(states.at(-1)?.results, ["Recovered"]);
});
