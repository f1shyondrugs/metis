import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createResearchTools, RESEARCH_TOOLS } from "../lib/mcp-core/research-tools.mjs";

const context = { userId: "owner", chatId: "chat", jobId: "run" };
test("research search/open/find keeps verifiable sources, stable excerpts and isolated durable runs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metis-research-"));
  let fetches = 0;
  const research = createResearchTools({ stateDir: root,
    search: async ({ query }) => {
      if (query === "broken") throw new Error("Search unavailable");
      return { results: [{ title: "Primary source", url: "https://example.org/evidence#section", content: "Unverified snippet" }] };
    },
    fetchPages: async () => { fetches++; return { results: [{ ok: true, title: "Official report", content: "Please retain original wording.\nCurrently in order to compare.\nRevenue was 42 EUR.\n" + "x".repeat(600) }] }; },
  });
  try {
    const results = await research("research_search", { queries: ["first", "broken", "second"] }, context);
    assert.equal(results.ok, true);
    assert.equal(results.results[1].ok, false);
    const id = results.results[0].sources[0].sourceId;
    assert.equal(results.results[0].sources[0].opened, false);
    assert.equal(results.results[2].sources[0].sourceId, id);
    await assert.rejects(research("research_find", { source_id: id, query: "42" }, context), /Open this source/);
    const opened = await research("research_open", { source_id: id, line_count: 2 }, context);
    assert.equal(opened.ok, true);
    assert.equal(opened.opened, true);
    assert.equal(opened.citation.url, "https://example.org/evidence");
    assert.equal(opened.hasMore, true);
    assert.match(opened.content, /L1: Please retain original wording/);
    assert.match(opened.content, /L2: Currently in order to compare/);
    assert.ok(opened.retrievedAt);
    const match = await research("research_find", { source_id: id, query: "42 EUR" }, context);
    assert.equal(match.matchCount, 1);
    assert.equal(match.matches[0].line, 3);
    const range = await research("research_open", { source_id: id, start_line: 3, line_count: 2 }, context);
    assert.match(range.content, /L3: Revenue was 42 EUR/);
    assert.equal(fetches, 1, "range reads reuse the same retrieved text");
    const persisted = createResearchTools({ stateDir: root });
    assert.equal((await persisted("research_sources", {}, context)).openedCount, 1);
    for (const foreign of [{ ...context, userId: "other" }, { ...context, chatId: "other" }, { ...context, jobId: "other" }]) {
      await assert.rejects(research("research_open", { source_id: id }, foreign), /Source not found/);
      assert.equal((await research("research_sources", {}, foreign)).openedCount, 0);
    }
    await assert.rejects(research("research_sources", {}, {}), /authenticated chat run/);
    await assert.rejects(research("research_open", { source_id: "../outside" }, context), /Invalid research source/);
    await assert.rejects(research("research_open", { url: "file:///etc/passwd" }, context), /HTTP/);
    await assert.rejects(research("research_open", { url: "https://user:pass@example.org" }, context), /credentials/);
    await assert.rejects(research("research_open", { source_id: id, url: opened.url }, context), /exactly one/);
    await assert.rejects(research("research_open", { source_id: id, start_line: -1 }, context), /integer/);
    await assert.rejects(research("research_search", { queries: [] }, context), /1–20/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("blocked pages remain unread and Incognito evidence never reaches disk", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metis-research-private-"));
  const research = createResearchTools({ stateDir: root,
    fetchPages: async () => ({ results: [{ ok: false, requiresBrowser: true, error: "Login required" }] }),
  });
  try {
    const privateContext = { ...context, incognito: true };
    const blocked = await research("research_open", { url: "https://example.org/blocked" }, privateContext);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.requiresBrowser, true);
    assert.equal(blocked.opened, false);
    assert.equal((await research("research_sources", {}, privateContext)).openedCount, 0);
    assert.equal((await research("research_sources", {}, privateContext)).sources.length, 1);
    assert.deepEqual(await readdir(root), []);
    assert.equal((await research("research_sources", {}, context)).sources.length, 0);
    assert.deepEqual(RESEARCH_TOOLS.map(t => t.name), ["research_search", "research_open", "research_find", "research_sources"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("two hundred synthetic sources can be discovered and fully read in bounded batches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metis-research-scale-"));
  let searches = 0, fetches = 0, activeSearches = 0, activeFetches = 0, maxSearches = 0, maxFetches = 0;
  const research = createResearchTools({ stateDir: root,
    search: async ({ query, numResults }) => {
      activeSearches++; maxSearches = Math.max(maxSearches, activeSearches); searches++;
      await new Promise(resolve => setImmediate(resolve));
      activeSearches--;
      return { results: Array.from({ length: numResults }, (_, index) => ({
        title: "Source " + query + "-" + index, url: "https://example.org/" + query + "/" + index,
        content: "Unverified discovery lead ".repeat(100),
      })) };
    },
    fetchPages: async ({ urls }) => {
      activeFetches++; maxFetches = Math.max(maxFetches, activeFetches); fetches++;
      await new Promise(resolve => setImmediate(resolve));
      activeFetches--;
      return { results: [{ ok: true, url: urls[0], content: "Primary evidence.\nIndependent method.\nLimitations stated." }] };
    },
  });
  try {
    const found = await research("research_search", { queries: Array.from({ length: 20 }, (_, i) => "q" + i), num_results: 10 }, context);
    const ids = found.results.flatMap(result => result.sources.map(source => source.sourceId));
    assert.equal(ids.length, 200);
    assert.equal(new Set(ids).size, 200);
    assert.equal(searches, 20);
    assert.ok(maxSearches > 1 && maxSearches <= 4);
    assert.ok(found.results.every(result => result.sources.every(source => source.snippet.length <= 80)));
    let audit = await research("research_sources", {}, context);
    assert.deepEqual([audit.discoveredCount, audit.openedCount, audit.readCount, audit.unreadCount], [200, 0, 0, 200]);
    for (let index = 0; index < ids.length; index += 20) {
      const batch = await research("research_open", { source_ids: ids.slice(index, index + 20) }, context);
      assert.equal(batch.results.length, 20);
      assert.ok(batch.results.every(result => result.ok && result.read));
      assert.ok(batch.results.reduce((size, result) => size + result.content.length, 0) <= batch.contentBudget);
    }
    assert.equal(fetches, 200);
    assert.ok(maxFetches > 1 && maxFetches <= 4);
    audit = await createResearchTools({ stateDir: root })("research_sources", {}, context);
    assert.deepEqual([audit.discoveredCount, audit.openedCount, audit.readCount, audit.unreadCount], [200, 200, 200, 0]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("read coverage credits only returned ranges and follows gaps despite batch output limits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metis-research-coverage-"));
  const research = createResearchTools({ stateDir: root,
    fetchPages: async () => ({ results: [{ ok: true, content: Array.from({ length: 100 }, (_, i) => "Evidence " + (i + 1) + " " + "x".repeat(200)).join("\n") }] }),
  });
  try {
    const partial = await research("research_open", { url: "https://example.org/partial", start_line: 20, line_count: 10 }, context);
    assert.equal(partial.read, false);
    assert.deepEqual(partial.readRanges, [[20, 29]]);
    assert.equal(partial.readLines, 10);
    assert.equal(partial.nextUnreadLine, 1);
    const start = await research("research_open", { source_id: partial.sourceId, line_count: 19 }, context);
    assert.deepEqual(start.readRanges, [[1, 29]]);
    assert.equal(start.nextUnreadLine, 30);
    const tail = await research("research_open", { source_id: partial.sourceId, start_line: 30, line_count: 160 }, context);
    assert.equal(tail.read, true);
    assert.equal(tail.coverageComplete, true);
    assert.equal(tail.readLines, 100);
    const batch = await research("research_open", { urls: Array.from({ length: 20 }, (_, i) => "https://example.org/large/" + i), line_count: 160 }, context);
    assert.ok(batch.results.every(result => result.ok && result.budgetLimited && !result.read && result.returnedLineCount < 100));
    assert.ok(batch.results.reduce((size, result) => size + result.content.length, 0) <= 60_000);
    const audit = await research("research_sources", {}, context);
    assert.deepEqual([audit.openedCount, audit.readCount, audit.unreadCount], [21, 1, 20]);
    for (const source of audit.sources.filter(source => !source.read)) {
      const returned = batch.results.find(result => result.sourceId === source.sourceId);
      assert.equal(source.readLines, returned.returnedLineCount);
      assert.deepEqual(source.readRanges, [[returned.startLine, returned.endLine]]);
      assert.equal(source.nextUnreadLine, returned.endLine + 1);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent ranges merge without lost coverage and find credits returned context only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metis-research-range-lock-"));
  let fetches = 0;
  const research = createResearchTools({ stateDir: root,
    fetchPages: async () => {
      fetches++;
      await new Promise(resolve => setImmediate(resolve));
      return { results: [{ ok: true, content: Array.from({ length: 100 }, (_, i) => "Evidence marker " + i).join("\n") }] };
    },
  });
  try {
    const [first] = await Promise.all([
      research("research_open", { url: "https://example.org/shared", line_count: 10 }, context),
      research("research_open", { url: "https://example.org/shared", start_line: 11, line_count: 10 }, context),
    ]);
    assert.equal(fetches, 1);
    const find = await research("research_find", { source_id: first.sourceId, query: "marker" }, context);
    assert.equal(find.matchCount, 100);
    assert.equal(find.matches.length, 30);
    assert.equal(find.read, false);
    assert.equal(find.readLines, 31);
    assert.deepEqual(find.readRanges, [[1, 31]]);
    const tail = await research("research_open", { source_id: first.sourceId, start_line: 32, line_count: 160 }, context);
    assert.equal(tail.read, true);
    assert.deepEqual(tail.readRanges, [[1, 100]]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("batch failures and truncation remain honest and isolated from successful sources", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metis-research-errors-"));
  const research = createResearchTools({ stateDir: root,
    fetchPages: async ({ urls }) => {
      if (urls[0].endsWith("/throw")) throw new Error("Request timed out");
      if (urls[0].endsWith("/blocked")) return { results: [{ ok: false, requiresBrowser: true, error: "Login required" }] };
      return { results: [{ ok: true, content: "Actual evidence", truncated: urls[0].endsWith("/truncated") }] };
    },
  });
  try {
    const batch = await research("research_open", { urls: ["https://example.org/good", "https://example.org/throw", "https://example.org/blocked", "https://example.org/truncated"] }, context);
    assert.deepEqual(batch.results.map(result => result.ok), [true, false, false, true]);
    assert.equal(batch.results[0].read, true);
    assert.equal(batch.results[1].status, "failed");
    assert.equal(batch.results[2].status, "blocked");
    assert.equal(batch.results[3].coverageComplete, true);
    assert.equal(batch.results[3].read, false);
    const audit = await research("research_sources", {}, context);
    assert.deepEqual([audit.discoveredCount, audit.openedCount, audit.readCount, audit.unreadCount, audit.failedCount, audit.blockedCount, audit.truncatedCount], [4, 2, 1, 3, 1, 1, 1]);
    const ids = audit.sources.map(source => source.sourceId);
    const mixed = await research("research_open", { source_ids: [ids[0], "src_000000000000000000000000", "../invalid"] }, context);
    assert.equal(mixed.results.length, 3);
    assert.equal(mixed.results[1].ok, false);
    assert.equal(mixed.results[2].ok, false);
    for (const args of [{}, { url: "https://example.org", urls: ["https://example.org"] }, { urls: [] }, { urls: Array(21).fill("https://example.org") }]) {
      await assert.rejects(research("research_open", args, context), /exactly one|1–20/);
    }
    const schema = RESEARCH_TOOLS.find(tool => tool.name === "research_open").inputSchema;
    assert.equal(schema.properties.source_ids.maxItems, 20);
    assert.equal(schema.properties.urls.maxItems, 20);
    assert.equal(RESEARCH_TOOLS.find(tool => tool.name === "research_search").inputSchema.properties.num_results.maximum, 20);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("gateway exposes research tools under the canonical read capability and preserves quotes", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metis-research-gateway-"));
  Object.assign(process.env, { AI_CHAT_ROOT: root, AI_CHAT_MCP_STATE_DIR: root, AI_CHAT_INTERNAL_ORIGIN: "http://127.0.0.1:1" });
  try {
    const { tools, modeToolCategory, dispatchGatewayTool } = await import("../lib/mcp-core/gateway-core.mjs");
    for (const name of RESEARCH_TOOLS.map(t => t.name)) {
      assert.equal(tools.filter(t => t.name === name).length, 1);
      assert.equal(modeToolCategory(name), "read");
    }
    t.mock.method(globalThis, "fetch", async () => Response.json({ results: [{ ok: true, title: "Verbatim", content: "Please retain original wording.\nCurrently in order to compare." }] }));
    const quoted = await dispatchGatewayTool("research_open", { url: "https://example.org/quotes" }, { auditCall: false, context: { ...context, compressionEnabled: true } });
    assert.equal(quoted.isError, undefined);
    assert.match(JSON.parse(quoted.content[0].text).content, /Please retain original wording/);
    assert.match(JSON.parse(quoted.content[0].text).content, /Currently in order to compare/);
    const result = await dispatchGatewayTool("research_sources", {}, { auditCall: false, context: { ...context, modePolicy: JSON.stringify({ allowedCategories: ["read"] }) } });
    assert.equal(result.isError, undefined);
    assert.equal(JSON.parse(result.content[0].text).openedCount, 1);
    const denied = await dispatchGatewayTool("research_sources", {}, { auditCall: false, context: { ...context, modePolicy: JSON.stringify({ allowedCategories: [] }) } });
    assert.equal(denied.isError, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
