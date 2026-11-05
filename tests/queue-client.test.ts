import assert from "node:assert/strict";
import test from "node:test";
import { mergeQueuedFollowUps } from "../lib/composer-send";
import { removeQueuedFollowUp, saveQueuedFollowUps, updateChatQueue } from "../lib/queue-client";

test("clicking remove suppresses live-sync echoes before DELETE completes", async () => {
  const message = { id: "q-remove", text: "delete", files: ["attachment"] };
  const kept = { id: "q-keep", text: "keep", files: [] };
  let queue = [message, kept];
  const removedIds = new Set<string>();
  let finish!: (response: Response) => void;
  const deleting = removeQueuedFollowUp({
    chatId: "chat", messageId: message.id, removedIds,
    removeLocally: () => { queue = queue.filter((item) => item.id !== message.id); },
    restoreLocally: () => { queue.unshift(message); },
    request: async (url, init) => {
      assert.equal(url, "/api/chats/chat/queue/q-remove");
      assert.equal(init?.method, "DELETE");
      return new Promise<Response>((resolve) => { finish = resolve; });
    },
  });
  assert.deepEqual(queue, [kept]);
  queue = mergeQueuedFollowUps(queue, [message, kept], { removedIds });
  assert.deepEqual(queue, [kept]);
  finish(Response.json({ ok: true }));
  assert.equal(await deleting, true);
  assert.ok(removedIds.has(message.id));
});

test("failed deletes restore the item and allow another attempt", async () => {
  for (const failure of ["http", "network"]) {
    const removedIds = new Set<string>();
    let visible = true;
    await assert.rejects(removeQueuedFollowUp({
      chatId: "chat", messageId: "q", removedIds,
      removeLocally: () => { visible = false; },
      restoreLocally: () => { visible = true; },
      request: async () => {
        if (failure === "network") throw new Error("offline");
        return new Response(null, { status: 500 });
      },
    }));
    assert.equal(visible, true);
    assert.equal(removedIds.has("q"), false);
  }
});

test("deleting one item twice cannot issue competing requests", async () => {
  const removedIds = new Set<string>();
  let calls = 0;
  const options = {
    chatId: "chat", messageId: "q", removedIds,
    removeLocally: () => {}, restoreLocally: () => {},
    request: async () => { calls++; return Response.json({ ok: true }); },
  };
  await Promise.all([removeQueuedFollowUp(options), removeQueuedFollowUp(options)]);
  assert.equal(calls, 1);
});

test("draft removal stays local and persisted IDs are safely encoded", async () => {
  let calls = 0;
  const base = {
    messageId: "q/a?", removedIds: new Set<string>(),
    removeLocally: () => {}, restoreLocally: () => {},
    request: async (url: Parameters<typeof fetch>[0]) => {
      calls++;
      assert.equal(url, "/api/chats/chat%2Fid/queue/q%2Fa%3F");
      return Response.json({ ok: true });
    },
  };
  assert.equal(await removeQueuedFollowUp({ ...base, chatId: null }), true);
  assert.equal(calls, 0);
  assert.equal(await removeQueuedFollowUp({ ...base, removedIds: new Set(), chatId: "chat/id" }), true);
  assert.equal(calls, 1);
});


test("late queue updaters retain the destination state and never execute against its items", () => {
  const current = { chatId: "destination", messages: [{ id: "destination-message" }] };
  let invoked = false;
  const next = updateChatQueue(current, "outgoing", () => { invoked = true; return []; });
  assert.equal(next, current);
  assert.equal(invoked, false);
  assert.equal(updateChatQueue(current, "outgoing", []), current);
});

test("ordinary queue persistence starts immediately without consuming keepalive quota", async () => {
  const calls: RequestInit[] = [];
  const message = { id: "q", text: "Read " + "🧪".repeat(25_000) };
  const saving = saveQueuedFollowUps("chat/id", [message], {
    request: async (url, init) => {
      assert.equal(url, "/api/chats/chat%2Fid");
      calls.push(init!);
      return Response.json({});
    },
  });
  assert.equal(calls.length, 1, "No timer or render may gate persistence");
  assert.equal(calls[0].keepalive, undefined);
  assert.deepEqual(JSON.parse(String(calls[0].body)).queuedMessages, [message]);
  await saving;
});

test("small lifecycle saves retry without keepalive when the shared quota is exhausted", async () => {
  const calls: RequestInit[] = [];
  await saveQueuedFollowUps("chat", [{ id: "q", text: "Continue" }], {
    keepalive: true,
    request: async (_url, init) => {
      calls.push(init!);
      if (init?.keepalive) throw new TypeError("Failed to fetch: keepalive quota exhausted");
      return Response.json({});
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].keepalive, true);
  assert.equal(calls[1].keepalive, undefined);
  assert.equal(calls[0].body, calls[1].body, "Retry the same stable queue IDs");
});

test("large UTF-8 lifecycle payloads bypass the keepalive limit without truncation", async () => {
  const message = { id: "q", text: "🧪".repeat(20_000) };
  await saveQueuedFollowUps("chat", [message], {
    keepalive: true,
    request: async (_url, init) => {
      assert.equal(init?.keepalive, undefined);
      assert.deepEqual(JSON.parse(String(init?.body)).queuedMessages, [message]);
      return Response.json({});
    },
  });
});

test("HTTP rejection is surfaced once and never retried as an unload fallback", async () => {
  let calls = 0;
  await assert.rejects(saveQueuedFollowUps("chat", [{ id: "q", text: "Keep locally" }], {
    keepalive: true,
    request: async () => { calls++; return Response.json({}, { status: 401 }); },
  }), /Could not save queued messages/);
  assert.equal(calls, 1);
});

test("ordinary network failures retain their error for lifecycle recovery", async () => {
  let calls = 0;
  await assert.rejects(saveQueuedFollowUps("chat", [{ id: "q", text: "Keep locally" }], {
    request: async () => { calls++; throw new TypeError("offline"); },
  }), /offline/);
  assert.equal(calls, 1);
});

test("a queue update is scoped to its owner, including drafts", () => {
  const current = { chatId: null, messages: [{ id: "draft" }] };
  const next = updateChatQueue(current, null, items => [...items, { id: "second" }]);
  assert.deepEqual(next.messages.map(item => item.id), ["draft", "second"]);
  assert.deepEqual(current.messages.map(item => item.id), ["draft"]);
  assert.equal(next.chatId, null);
});
