import assert from "node:assert/strict";
import test from "node:test";
import { ChatListClient } from "../lib/chat-list-client";
import type { ChatIndexEntry } from "../lib/store";

const chat = (id: string): ChatIndexEntry => ({id,title:id,createdAt:"2026-01-01",updatedAt:"2026-01-01"});
const page = (ids: string[], nextCursor: string | null) => Response.json({chats:ids.map(chat),nextCursor});
async function idle(client: ChatListClient) {
  for (let i=0;i<100;i++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    if (!client.getSnapshot().loading) return;
  }
  throw new Error("Client did not become idle");
}
test("loads one page, serializes duplicate scrolls, deduplicates and refreshes only loaded pages", async () => {
  const requests: string[] = [];
  const client = new ChatListClient(async input => {
    const url = String(input); requests.push(url);
    return url.includes("cursor=") ? page(["b","c"],null) : page(["a","b"],"next");
  });
  client.configure(true,null);
  await idle(client);
  assert.equal(requests.length,1);
  assert.equal(new URL(requests[0],"http://local").searchParams.get("limit"),"30");
  await Promise.all([client.loadMore(),client.loadMore(),client.loadMore()]);
  assert.equal(requests.length,2);
  assert.deepEqual(client.getSnapshot().chats.map(c=>c.id),["a","b","c"]);
  assert.equal(client.getSnapshot().nextCursor,null);
  await client.loadMore();
  assert.equal(requests.length,2);
  await client.refresh();
  assert.equal(requests.length,4);
  assert.deepEqual(client.getSnapshot().chats.map(c=>c.id),["a","b","c"]);
  client.dispose();
});

test("scope changes and sign-out abort stale results even if transport ignores abort", async () => {
  const pending: Array<{resolve:(response:Response)=>void; signal:AbortSignal}> = [];
  const client = new ChatListClient((_input,init) => new Promise(resolve=>pending.push({resolve,signal:init!.signal as AbortSignal})));
  client.configure(true,null);
  await Promise.resolve();
  client.configure(true,"project-b");
  await Promise.resolve();
  assert.equal(pending[0].signal.aborted,true);
  pending[1].resolve(page(["new"],null));
  await idle(client);
  pending[0].resolve(page(["stale"],"old"));
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(client.getSnapshot().chats.map(c=>c.id),["new"]);
  client.configure(true,"project-c"); await Promise.resolve();
  client.configure(false,null);
  pending[2].resolve(page(["signed-out"],null));
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(client.getSnapshot().chats,[]);
  client.dispose();
});

test("errors preserve loaded rows and cursor; retry works without automatic retry loops", async () => {
  let requests = 0, fail = true;
  const client = new ChatListClient(async input => {
    requests++;
    if (String(input).includes("cursor=")) {
      if (fail) return new Response("",{status:503});
      return page(["b"],null);
    }
    return page(["a"],"next");
  });
  client.configure(true,null); await idle(client);
  await client.loadMore();
  assert.equal(requests,2);
  assert.match(client.getSnapshot().error,/Failed to load/);
  assert.deepEqual(client.getSnapshot().chats.map(c=>c.id),["a"]);
  assert.equal(client.getSnapshot().nextCursor,"next");
  fail=false;
  await client.loadMore();
  assert.equal(client.getSnapshot().error,"");
  assert.deepEqual(client.getSnapshot().chats.map(c=>c.id),["a","b"]);
  client.dispose();
});

test("live refresh during scrolling is coalesced and applied after the page request", async () => {
  let finish: ((response:Response)=>void) | undefined;
  let requests=0;
  const client=new ChatListClient(async input=>{
    requests++;
    if (requests===2) return new Promise<Response>(resolve=>{finish=resolve;});
    return String(input).includes("cursor=")?page(["b"],null):page(["a"],"next");
  });
  client.configure(true,null);await idle(client);
  const more=client.loadMore(); await Promise.resolve();
  void client.refresh(); void client.refresh();
  finish!(page(["b"],null)); await more; await idle(client);
  assert.equal(requests,4);
  assert.deepEqual(client.getSnapshot().chats.map(c=>c.id),["a","b"]);
  client.dispose();
});
