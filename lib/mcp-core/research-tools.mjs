import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { localWebSearch } from "./local-search.mjs";
import { localWebFetch } from "./local-scraper.mjs";

const MAX_SOURCE_CHARS = 100_000;
const BATCH_CONTENT_CHARS = 60_000;
const CONCURRENCY = 4;
const integer = (value, fallback, max) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`Expected an integer from 1 to ${max}`);
  return n;
};
const digest = value => createHash("sha256").update(value).digest("hex");
function publicUrl(value) {
  const url = new URL(String(value || ""));
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("A public HTTP(S) URL without credentials is required");
  url.hash = "";
  return url.href;
}
function linesOf(content) {
  // Keep line ranges useful even for pages extracted as a single huge paragraph.
  return String(content).replace(/\r\n?/g, "\n").split("\n").flatMap(line => line.match(/.{1,240}/gu) || [""]);
}
function mergeRanges(ranges) {
  const merged = [];
  for (const [start, end] of ranges.filter(([start, end]) => end >= start).sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
function markRead(source, ranges) {
  source.readRanges = mergeRanges([...(source.readRanges || []), ...ranges]);
}
const summary = (source, discovery = false) => {
  const totalLines = source.lines?.length || 0;
  const readRanges = source.readRanges || [];
  const readLines = readRanges.reduce((count, [start, end]) => count + end - start + 1, 0);
  const coverageComplete = totalLines > 0 && readLines === totalLines;
  const read = coverageComplete && !source.truncated;
  let nextUnreadLine = totalLines ? 1 : undefined;
  for (const [start, end] of readRanges) {
    if (start > nextUnreadLine) break;
    nextUnreadLine = end + 1;
  }
  if (nextUnreadLine > totalLines) nextUnreadLine = undefined;
  return {
    sourceId: source.sourceId, title: discovery ? source.title.slice(0, 160) : source.title, url: source.url,
    opened: Boolean(source.lines), read, discoveredAt: source.discoveredAt,
    ...(source.retrievedAt ? { retrievedAt: source.retrievedAt, totalLines, truncated: Boolean(source.truncated),
      readLines, readRanges, coverageComplete, ...(nextUnreadLine ? { nextUnreadLine } : {}) } : {}),
    ...(!source.lines ? { snippet: discovery ? source.snippet.slice(0, 80) : source.snippet } : {}),
    ...(source.attemptedAt ? { attemptedAt: source.attemptedAt } : {}),
    ...(source.lastError ? { error: source.lastError, requiresBrowser: Boolean(source.requiresBrowser) } : {}),
    status: read ? "read" : source.lines ? source.truncated ? "truncated" : "opened"
      : source.lastError ? source.requiresBrowser ? "blocked" : "failed" : "discovered",
  };
};
function sourceCounts(sources) {
  const openedCount = sources.filter(source => source.opened).length;
  const readCount = sources.filter(source => source.read).length;
  return { sources, discoveredCount: sources.length, openedCount, readCount, unreadCount: sources.length - readCount,
    unopenedCount: sources.length - openedCount,
    failedCount: sources.filter(source => source.status === "failed").length,
    blockedCount: sources.filter(source => source.status === "blocked").length,
    truncatedCount: sources.filter(source => source.truncated).length };
}
async function parallelMap(items, operation) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await operation(items[index], index);
    }
  }));
  return results;
}

/** Cache only: identity comes exclusively from the authenticated run, never tool arguments. */
export function createResearchTools({ stateDir, search = options => localWebSearch({ ...options, timeoutMs: 15_000 }), fetchPages = localWebFetch } = {}) {
  if (!stateDir) throw new Error("Research state directory is required");
  const ephemeral = new Map();
  const sourceLocks = new Map();
  async function withSourceLock(key, operation) {
    const previous = sourceLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    sourceLocks.set(key, current);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (sourceLocks.get(key) === current) sourceLocks.delete(key);
    }
  }
  function directory(context) {
    if (!context.userId || !context.chatId || !context.jobId) throw new Error("Research tools require an authenticated chat run");
    const key = digest(JSON.stringify([context.userId, context.chatId, context.jobId]));
    if (context.incognito) {
      for (const [id, state] of ephemeral) if (state.expires < Date.now()) ephemeral.delete(id);
      if (!ephemeral.has(key)) {
        if (ephemeral.size >= 128) ephemeral.delete(ephemeral.keys().next().value);
        ephemeral.set(key, { sources: new Map(), expires: Date.now() + 86_400_000 });
      }
      return "memory:" + key;
    }
    return path.join(stateDir, "research", key);
  }
  async function read(dir, id) {
    if (!/^src_[a-f0-9]{24}$/.test(String(id))) throw new Error("Invalid research source ID");
    if (dir.startsWith("memory:")) {
      const source = ephemeral.get(dir.slice(7))?.sources.get(id);
      if (!source) throw new Error("Source not found in this research run");
      return structuredClone(source);
    }
    try { return JSON.parse(await fs.readFile(path.join(dir, id + ".json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") throw new Error("Source not found in this research run"); throw error; }
  }
  async function save(dir, source, onlyMissing = false) {
    if (dir.startsWith("memory:")) {
      const sources = ephemeral.get(dir.slice(7)).sources;
      if (!onlyMissing || !sources.has(source.sourceId)) sources.set(source.sourceId, structuredClone(source));
      return;
    }
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const dest = path.join(dir, source.sourceId + ".json");
    const temp = dest + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(temp, JSON.stringify(source), { mode: 0o600 });
      if (onlyMissing) {
        try { await fs.link(temp, dest); } catch (error) { if (error.code !== "EEXIST") throw error; }
      } else await fs.rename(temp, dest);
    }
    finally { await fs.rm(temp, { force: true }); }
  }
  async function candidate(dir, item) {
    const url = publicUrl(item.url);
    const sourceId = "src_" + digest(url).slice(0, 24);
    try { return await read(dir, sourceId); } catch (error) {
      if (error.message !== "Source not found in this research run") throw error;
    }
    const source = { sourceId, url, title: String(item.title || url).slice(0, 500),
      snippet: String(item.content || "").slice(0, 2000), discoveredAt: new Date().toISOString() };
    await save(dir, source, true);
    return read(dir, sourceId);
  }
  function excerpt(source, args, contentBudget) {
    const start = integer(args.start_line, 1, Math.max(1, source.lines.length));
    const count = integer(args.line_count, 60, 160);
    const requested = source.lines.slice(start - 1, start - 1 + count);
    const selected = [];
    let contentLength = 0;
    for (const line of requested) {
      const formatted = `L${start + selected.length}: ${line}`;
      const nextLength = contentLength + formatted.length + (selected.length ? 1 : 0);
      if (nextLength > contentBudget) break;
      selected.push(formatted);
      contentLength = nextLength;
    }
    const end = start + selected.length - 1;
    markRead(source, [[start, end]]);
    return { ...summary(source), startLine: start, endLine: end, returnedLineCount: selected.length,
      hasMore: end < source.lines.length, budgetLimited: selected.length < requested.length,
      content: selected.join("\n"), citation: { title: source.title, url: source.url }, untrustedContent: true };
  }
  async function openSource(dir, selector, args, context, contentBudget) {
    const sourceId = selector.source_id || (await candidate(dir, { url: selector.url })).sourceId;
    return withSourceLock(dir + ":" + sourceId, async () => {
      const source = await read(dir, sourceId);
      if (!source.lines) {
        source.attemptedAt = new Date().toISOString();
        try {
          const payload = await fetchPages({ urls: [source.url], maxChars: MAX_SOURCE_CHARS }, context);
          const page = payload.results?.[0];
          if (!page?.ok || !String(page.content || "").trim()) {
            source.lastError = String(page?.error || "Source could not be read").slice(0, 1000);
            source.requiresBrowser = Boolean(page?.requiresBrowser);
          } else {
            const text = String(page.content);
            source.title = String(page.title || source.title).slice(0, 500);
            source.retrievedAt = new Date().toISOString();
            source.lines = linesOf(text.slice(0, MAX_SOURCE_CHARS));
            source.truncated = Boolean(page.truncated || text.length >= MAX_SOURCE_CHARS);
            source.readRanges = [];
            delete source.lastError;
            delete source.requiresBrowser;
          }
        } catch (error) {
          source.lastError = String(error.message || error).slice(0, 1000);
          source.requiresBrowser = false;
        }
        if (!source.lines) {
          await save(dir, source);
          return { ok: false, ...summary(source),
            instruction: source.requiresBrowser ? "Use the persistent Metis browser; do not bypass authentication or challenges."
              : "Try another source or report this access limitation." };
        }
      }
      const result = excerpt(source, args, contentBudget);
      await save(dir, source);
      return { ok: true, ...result };
    });
  }
  return async function research(name, args = {}, context = {}) {
    const dir = directory(context);
    if (name === "research_search") {
      if (!Array.isArray(args.queries) || args.queries.length < 1 || args.queries.length > 20
        || args.queries.some(q => typeof q !== "string" || !q.trim() || q.length > 1000)) throw new Error("Provide 1–20 nonempty search queries, at most 1000 characters each");
      const count = integer(args.num_results, 5, 20);
      const results = await parallelMap(args.queries, async query => {
        try {
          const found = await search({ query: query.trim(), numResults: count }, context);
          const sources = [];
          for (const item of (found.results || []).slice(0, count)) {
            try { sources.push(summary(await candidate(dir, item), true)); } catch (error) {
              if (!(error instanceof TypeError) && !error.message.startsWith("A public HTTP")) throw error;
            }
          }
          return { query, ok: sources.length > 0, sources, ...(sources.length ? {} : { error: "No search results" }) };
        } catch (error) { return { query, ok: false, sources: [], error: error.message }; }
      });
      return { ok: results.some(result => result.ok), results, instruction: "Read every source's numbered passages before citing claims. Snippets are discovery leads, not read evidence. Use batched research_open and follow nextUnreadLine until read=true." };
    }
    if (name === "research_open") {
      const selectors = ["source_id", "url", "source_ids", "urls"].filter(key => args[key] !== undefined);
      if (selectors.length !== 1) throw new Error("Provide exactly one of source_id, url, source_ids or urls");
      const key = selectors[0];
      const batch = key === "source_ids" || key === "urls";
      if (!batch) return openSource(dir, { [key]: args[key] }, args, context, 40_000);
      const values = args[key];
      if (!Array.isArray(values) || values.length < 1 || values.length > 20 || values.some(value => typeof value !== "string" || !value.trim())) {
        throw new Error("Provide 1–20 nonempty source IDs or URLs");
      }
      const singular = key === "source_ids" ? "source_id" : "url";
      // Allocate a shared content budget; the evidence ledger credits only returned lines.
      const perSourceBudget = Math.floor(BATCH_CONTENT_CHARS / values.length);
      const results = await parallelMap(values, async (value, index) => {
        try { return { index, ...await openSource(dir, { [singular]: value }, args, context, perSourceBudget) }; }
        catch (error) { return { index, ok: false, error: String(error.message || error) }; }
      });
      return { ok: results.some(result => result.ok), results, contentBudget: BATCH_CONTENT_CHARS,
        instruction: "Only the returned line ranges count as read. Continue at nextUnreadLine for sources where read=false; blocked or truncated sources are not fully read." };
    }
    if (name === "research_find") {
      return withSourceLock(dir + ":" + args.source_id, async () => {
        const source = await read(dir, args.source_id);
        if (!source.lines) throw new Error("Open this source before searching its text");
        const query = String(args.query || "").trim().toLowerCase();
        if (!query || query.length > 1000) throw new Error("A search phrase of 1–1000 characters is required");
        const all = source.lines.flatMap((line, index) => line.toLowerCase().includes(query) ? [index] : []);
        const ranges = all.slice(0, 30).map(index => [Math.max(0, index - 1) + 1, Math.min(source.lines.length, index + 2)]);
        const matches = ranges.map(([start, end], i) => ({ line: all[i] + 1,
          content: source.lines.slice(start - 1, end).map((line, offset) => `L${start + offset}: ${line}`).join("\n") }));
        markRead(source, ranges);
        await save(dir, source);
        return { ...summary(source), matchCount: all.length, matches, untrustedContent: true };
      });
    }
    if (name === "research_sources") {
      if (dir.startsWith("memory:")) return sourceCounts([...ephemeral.get(dir.slice(7)).sources.values()].map(source => summary(source, true)));
      let names;
      try { names = await fs.readdir(dir); } catch (error) { if (error.code === "ENOENT") return sourceCounts([]); throw error; }
      const sources = [];
      for (const name of names.filter(name => /^src_[a-f0-9]{24}\.json$/.test(name))) sources.push(summary(await read(dir, name.slice(0, -5)), true));
      sources.sort((a, b) => a.discoveredAt.localeCompare(b.discoveredAt) || a.sourceId.localeCompare(b.sourceId));
      return sourceCounts(sources);
    }
    throw new Error("Unknown research tool");
  };
}

const objectSchema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const sourceId = { type: "string", description: "Exact sourceId returned by research_search/open in this run." };
export const RESEARCH_TOOLS = [
  { name: "research_search", description: "Search 1–20 focused queries with bounded concurrency and register up to 20 results each for Deep Research. Results are discovery leads; read sources with research_open. Sources are scoped to the authenticated account, chat and run.",
    inputSchema: objectSchema({ queries: { type: "array", items: { type: "string", minLength: 1, maxLength: 1000 }, minItems: 1, maxItems: 20 }, num_results: { type: "integer", minimum: 1, maximum: 20 } }, ["queries"]) },
  { name: "research_open", description: "Read a public source by source_id or url, or batch 1–20 source_ids or urls. Supply exactly one selector form. Return numbered passages with exact read coverage; fetching/caching alone does not mark a source fully read. Batch passages share a 60k-character budget. Follow nextUnreadLine until read=true. For requiresBrowser use the persistent Metis browser; truncated sources are not fully read.",
    inputSchema: objectSchema({ source_id: sourceId, url: { type: "string" },
      source_ids: { type: "array", items: sourceId, minItems: 1, maxItems: 20 },
      urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
      start_line: { type: "integer", minimum: 1 }, line_count: { type: "integer", minimum: 1, maximum: 160 } }) },
  { name: "research_find", description: "Find a literal phrase in an opened source and return matching line numbers with surrounding text. No regex. Only returned passages count toward read coverage. Use research_open to read wider context.",
    inputSchema: objectSchema({ source_id: sourceId, query: { type: "string", minLength: 1, maxLength: 1000 } }, ["source_id", "query"]) },
  { name: "research_sources", description: "List the run's discovered, opened and fully read sources, exact returned-line coverage, unread count, and blocked/failed/truncated sources. Audit evidence before citing or reporting completion. Opened does not mean read.",
    inputSchema: objectSchema({}) },
].map(tool => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false } }));
