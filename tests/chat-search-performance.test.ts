import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { boundedSearchResults } from "../lib/palette-search";
const root = mkdtempSync(path.join(os.tmpdir(), "metis-chat-search-"));
process.env.CHAT_DATA_DIR = root;
process.env.CHAT_DB_PATH = path.join(root, "chat.sqlite");
process.env.AGENT_CWD = root;
const modules = Promise.all([import("../lib/sqlite"), import("../lib/db-store"), import("../lib/chat-search"), import("../app/api/chats/search/route")]);
const stamp = "2026-01-01T00:00:00.000Z";
test.after(() => rmSync(root, { recursive: true, force: true }));
test("literal full-text search retains ACL, revisions, original history and bounded projections", async () => {
    const [{ getDatabase }, store, { searchOffThread }, api] = await modules;
    const db = getDatabase();
    for (const user of ["owner", "member", "stranger"]) {
        db.prepare("INSERT INTO users VALUES(?,?,?,?,0)").run(user, user, "unused", stamp);
        db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(createHash("sha256").update(user + "-token").digest("hex"), user, "2099-01-01T00:00:00Z");
    }
    const project = { id: "p", ownerId: "owner", name: "Shared project", instructions: "ProjectNeedle", color: "#123456", icon: "folder", createdAt: stamp, updatedAt: stamp };
    db.prepare("INSERT INTO projects VALUES(?,?,?,?,?)").run("p", "owner", JSON.stringify(project), stamp, stamp);
    db.prepare("INSERT INTO project_members VALUES(?,?,?)").run("p", "member", stamp);
    const insert = (id: string, owner: string, content: string, patch: Record<string, unknown> = {}) => {
        const value = { id, ownerId: owner, title: "Title " + id, keywords: ["tagneedle"], createdAt: stamp, updatedAt: stamp, messages: [{ id: "m-" + id, role: "assistant", content, createdAt: stamp, tools: [{ id: "tool", name: "read_file", result: "PRIVATE_TOOL_ONLY" }] }], ...patch };
        const raw = JSON.stringify(value);
        db.prepare("INSERT INTO chats VALUES(?,?,?,?,?)").run(id, owner, raw, stamp, stamp);
        db.prepare("INSERT INTO chat_list(id,owner_id,title,keywords,created_at,updated_at,incognito,automation_run_id,project_id,archived) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id, owner, value.title, JSON.stringify(value.keywords), stamp, stamp, patch.incognito ? 1 : 0, patch.automationRunId as string || null, patch.projectId as string || null, patch.archived ? 1 : 0);
        return raw;
    };
    const content = "prefix ".repeat(4000) + 'beyond-preview ÄPFEL 100% _literal_ "quoted" 🚀ab 中华人民 az xy';
    const raw = insert("shared", "owner", content, { projectId: "p", archived: true });
    // Upgrade/import: neither a search index nor a page revision existed yet.
    db.prepare("DELETE FROM chat_page_state WHERE chat_id='shared'").run();
    insert("private", "owner", content);
    insert("hidden", "owner", content, { incognito: true });
    insert("automation", "owner", content, { automationRunId: "automation" });
    const find = async (q: string, user = "owner", limit = 30) => store.searchChatsForUser(q, user, limit);
    for (const query of ["beyond-preview", "äpfel", "100%", "_literal_", '"quoted"', "🚀ab", "华人民", "az", "x", "xy"]) {
        const own = await find(query);
        assert.deepEqual(new Set(own.map(r => r.chatId)), new Set(["shared", "private"]), query);
        assert.ok(own.every(r => r.messageId?.startsWith("m-") && r.snippet.length < 401));
    }
    assert.equal((await find("PRIVATE_TOOL_ONLY")).length, 0);
    assert.deepEqual((await find("beyond-preview", "member")).map(r => r.chatId), ["shared"]);
    assert.equal((await find("beyond-preview", "stranger")).length, 0);
    assert.equal((await find("tagneedle")).length, 2);
    assert.equal((await find("Title", undefined, 1)).length, 1);
    assert.equal((db.prepare("SELECT data FROM chats WHERE id='shared'").get() as {
        data: string;
    }).data, raw);
    // Revocation takes precedence even if a member created a resource.
    insert("member-owned", "member", "beyond-preview", { projectId: "p" });
    await find("beyond-preview", "member");
    db.prepare("DELETE FROM project_members WHERE user_id='member'").run();
    assert.equal((await find("beyond-preview", "member")).length, 0);
    const changed = JSON.parse(raw);
    changed.messages[0].content = "Replacement only";
    db.prepare("UPDATE chats SET data=? WHERE id='shared'").run(JSON.stringify(changed)); // same updated_at
    assert.equal((await find("beyond-preview")).some(r => r.chatId === "shared"), false);
    assert.equal((await find("Replacement")).some(r => r.chatId === "shared"), true);
    const chat = store.createChat("New title", undefined, "owner");
    store.appendMessage(chat.id, { id: "append", role: "user", content: "AppendNeedle", createdAt: stamp }, "owner");
    assert.equal((await find("AppendNeedle"))[0].messageId, "append");
    const note = { id: "note", ownerId: "owner", scope: "global", kind: "note", title: "A note", content: "a".repeat(20000) + " NoteNeedle", createdAt: stamp, updatedAt: stamp };
    db.prepare("INSERT INTO notes(id,owner_id,scope,archived,data,created_at,updated_at) VALUES(?,?,?,0,?,?,?)").run(note.id, "owner", "global", JSON.stringify(note), stamp, stamp);
    const full = await searchOffThread("NoteNeedle", "owner", 30, true);
    assert.equal(full.notes[0].noteId, "note");
    assert.ok(full.notes[0].snippet.length < 401);
    assert.equal((await searchOffThread("NoteNeedle", "stranger", 30, true)).notes.length, 0);
    assert.equal((await searchOffThread("NoteNeedle", "owner", 30, true, undefined, false)).notes.length, 0);
    assert.equal((await searchOffThread("ProjectNeedle", "owner", 30, true)).projects[0].id, "p");
    assert.equal((await searchOffThread("ProjectNeedle", undefined, 30, true)).projects[0].id, "p");
    assert.equal((await searchOffThread("NoteNeedle", undefined, 30, true)).notes[0].noteId, "note");
    const request = (q: string, token = "owner") => new Request("http://fixture/api/chats/search?q=" + encodeURIComponent(q) + "&related=1", { headers: { cookie: "ai_chat_auth=" + token + "-token" } });
    assert.equal((await api.GET(new Request("http://fixture/api/chats/search?q=x"))).status, 401);
    const response = await api.GET(request("NoteNeedle"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).notes[0].noteId, "note");
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(searchOffThread("x", "owner", 30, false, cancelled.signal), { name: "AbortError" });
    db.prepare("DELETE FROM chats WHERE id='shared'").run();
    assert.equal((await find("Replacement")).length, 0);
});
test("large legacy preparation yields partial responses without blocking other work", async () => {
    const [{ getDatabase }, store, { searchOffThread }] = await modules;
    const db = getDatabase();
    const pad = "x".repeat(2000000), raw = JSON.stringify({ id: "large", ownerId: "owner", title: "Large", createdAt: stamp, updatedAt: stamp, messages: Array.from({ length: 16 }, (_, i) => ({ id: "large-m" + i, role: "assistant", content: "LegacySearch " + i, tools: [{ id: "t", name: "read_file", result: pad }], createdAt: stamp })) });
    db.prepare("INSERT INTO chats VALUES(?,?,?,?,?)").run("large", "owner", raw, stamp, stamp);
    db.prepare("INSERT INTO chat_list(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)").run("large", "owner", "Large", stamp, stamp);
    const parse = JSON.parse;
    let maxPause = 0, last = performance.now(), ticks = 0;
    const timer = setInterval(() => { const now = performance.now(); maxPause = Math.max(maxPause, now - last); last = now; ticks++; }, 5);
    JSON.parse = ((text: string, ...args: unknown[]) => { assert.ok(text.length < 512 * 1024, "Full history parsed on web thread"); return Reflect.apply(parse, JSON, [text, ...args]); }) as typeof JSON.parse;
    const start = performance.now();
    try {
        const result = await searchOffThread("LegacySearch", "owner");
        assert.ok(result.results.length === 16 || result.indexing);
        await store.searchChatsForUser("LegacySearch", "owner");
    }
    finally {
        JSON.parse = parse;
        clearInterval(timer);
    }
    assert.ok(ticks > 0);
    assert.ok(maxPause < 250, "Web loop pause " + maxPause);
    assert.equal((db.prepare("SELECT data FROM chats WHERE id='large'").get() as {
        data: string;
    }).data, raw);
    console.log(JSON.stringify({ legacyBytes: raw.length, elapsed: performance.now() - start, maxPause, ticks }));
});
test("80 MB of legacy tools indexes under the unchanged 192 MiB worker limit without parsing the history in JS", async () => {
    const [{getDatabase}, store] = await modules;
    const {prepareLegacySearch} = await import("../lib/chat-search-engine");
    const db=getDatabase(),id="heap-heavy",pad="t".repeat(2_000_000);
    const raw=JSON.stringify({id,ownerId:"owner",title:"Heap fixture",createdAt:stamp,updatedAt:stamp,
        messages:Array.from({length:40},(_,i)=>({id:"heap-"+i,role:"assistant",content:"HeapNeedle ÄPFEL "+i,
            tools:[{id:"tool-"+i,name:"read_file",result:pad,content:"NestedOnlyNeedle",
                subagent:{messages:[{id:"nested",role:"assistant",content:"NestedOnlyNeedle"}]}}]}))});
    assert.ok(Buffer.byteLength(raw)>80_000_000);
    db.prepare("INSERT INTO chats VALUES(?,?,?,?,?)").run(id,"owner",raw,stamp,stamp);
    db.prepare("INSERT INTO chat_list(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)").run(id,"owner","Heap fixture",stamp,stamp);
    const parse=JSON.parse;
    JSON.parse=((text:string,...args:unknown[])=>{
        assert.ok(text.length<512*1024,"Legacy index parsed the complete JSON tree");
        return Reflect.apply(parse,JSON,[text,...args]);
    }) as typeof JSON.parse;
    try{assert.equal(prepareLegacySearch(db,id,1),true);}finally{JSON.parse=parse;}
    assert.equal(db.prepare("SELECT count(*) AS n FROM chat_search_messages WHERE chat_id=?").get(id)?.n,40);
    db.prepare("DELETE FROM chat_search_state WHERE chat_id=?").run(id);
    const start=performance.now();
    const results=await store.searchChatsForUser("HeapNeedle","owner");
    assert.equal(results.length,30);assert.ok(results.every(r=>r.chatId===id));
    assert.equal((await store.searchChatsForUser("NestedOnlyNeedle","owner")).length,0);
    const current=db.prepare("SELECT data FROM chats WHERE id=?").get(id) as {data:string};
    assert.equal(createHash("sha256").update(current.data).digest("hex"),createHash("sha256").update(raw).digest("hex"));
    console.log(JSON.stringify({heapFixtureBytes:Buffer.byteLength(raw),searchMs:performance.now()-start,workerOldGenerationMiB:192}));
});
test("chat-grouped UI searches fill distinct conversation slots and retain tool message search", async () => {
    const [, store, {searchOffThread}, api] = await modules;
    const first = store.createChat("Korlei qz", undefined, "owner");
    const second = store.createChat("Another conversation", undefined, "owner");
    const sameTitle = store.createChat("Korlei qz", undefined, "owner");
    const foreign = store.createChat("Korlei qz", undefined, "stranger");
    first.pinned = true;
    for (const chat of [first, second, sameTitle, foreign]) {
        chat.messages = Array.from({length: chat.id === first.id || chat.id === second.id ? 100 : 1}, (_, n) => ({
            id: chat.id + "-message-" + n, role: "user" as const, content: "Korlei qz " + n, createdAt: stamp,
        }));
        store.saveChat(chat);
    }
    // Prepare the index using the unchanged message search.
    assert.ok((await store.searchChatsForUser("Korlei", "owner")).length > 3);
    for (const query of ["Korlei", "qz"]) {
        for (const limit of [2, 30]) {
            const response = await api.GET(new Request("http://fixture/api/chats/search?" + new URLSearchParams({
                q: query, related: "1", group: "chat", limit: String(limit),
            }), {headers: {cookie: "ai_chat_auth=owner-token"}}));
            assert.equal(response.status, 200);
            const results = (await response.json()).results as Array<{chatId: string; messageId?: string; snippet: string}>;
            assert.equal(results.length, Math.min(limit, 3), "Limit counts conversations for " + query);
            assert.equal(new Set(results.map(item => item.chatId)).size, results.length);
            assert.ok(!results.some(item => item.chatId === foreign.id));
            if (limit === 30) {
                assert.deepEqual(new Set(results.map(item => item.chatId)), new Set([first.id, second.id, sameTitle.id]));
                const bodyMatch = results.find(item => item.chatId === second.id)!;
                assert.equal(bodyMatch.messageId, second.id + "-message-0");
                assert.match(bodyMatch.snippet, /Korlei qz/);
            }
        }
        const grouped = await searchOffThread(query, "owner", 30, false, undefined, true, true);
        assert.equal(grouped.results.length, 3, "Worker also groups without related results");
    }
});

test("palette groups older message-level responses by chat ID without merging equal titles", () => {
    const results = boundedSearchResults({results: [
        {chatId: "first", chatTitle: "Korlei", messageId: "best", snippet: "First matching message"},
        ...Array.from({length: 29}, (_, n) => ({chatId: "first", chatTitle: "Korlei", messageId: String(n)})),
        {chatId: "second", chatTitle: "Korlei", messageId: "other", snippet: "Other conversation"},
    ]}).results;
    assert.deepEqual(results.map(item => item.chatId), ["first", "second"]);
    assert.equal(results[0].messageId, "best");
});

test("malformed or oversized responses cannot expand the palette DOM without bounds", () => {
    const text = "a".repeat(50000), data = boundedSearchResults({
        results: Array.from({ length: 200 }, (_, i) => ({ chatId: "c" + i, chatTitle: text, snippet: text, matchedKeywords: Array(50).fill(text) })),
        notes: Array.from({ length: 500 }, (_, i) => ({ noteId: "n" + i, title: text, snippet: text })),
        projects: Array.from({ length: 500 }, (_, i) => ({ id: "p" + i, name: text })),
    });
    assert.equal(data.results.length, 30);
    assert.equal(data.notes.length, 8);
    assert.equal(data.projects.length, 8);
    assert.ok(data.results.every(r => r.chatTitle.length <= 200 && r.snippet.length <= 400 && r.matchedKeywords!.length <= 5));
    assert.ok(JSON.stringify(data).length < 50000);
    assert.deepEqual(boundedSearchResults(null), { results: [], notes: [], projects: [], indexing: false });
});
