import type { DatabaseSync } from "node:sqlite";
import { SEARCH_CHAT_ACCESS, searchSnippet } from "@/lib/chat-search-store";
import type { ChatSearchResult } from "@/lib/db-store";
import type { SearchPayload } from "@/lib/chat-search";
type Entry = {
    id: string;
    title: string;
    keywords: string | null;
    updated_at: string;
};
const pause = () => new Promise<void>(resolve => setImmediate(resolve));

/** Legacy tools can dwarf the searchable text. Keep their JSON entirely inside
 * SQLite, stage only direct message fields, then commit the revision we read.
 * TEMP writes do not hold the main database's writer lock during extraction.
 */
export function prepareLegacySearch(db: DatabaseSync, chatId: string, revision: number) {
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS chat_search_staging (
        position INTEGER PRIMARY KEY, message_id TEXT NOT NULL,
        role TEXT NOT NULL, body TEXT NOT NULL, normalized TEXT NOT NULL
    ); DELETE FROM temp.chat_search_staging;`);
    db.function("search_normalize", {deterministic:true}, value => String(value ?? "").toLowerCase());
    db.exec("BEGIN");
    try {
        const initial = db.prepare("SELECT revision FROM chat_page_state WHERE chat_id=?").get(chatId) as {revision:number}|undefined;
        if (initial?.revision !== revision) { db.exec("ROLLBACK"); return false; }
        // json_tree.atom avoids materializing each large message object. The
        // digits-only path suffix excludes all nested tool/subagent fields.
        db.prepare(`INSERT INTO temp.chat_search_staging
            SELECT position,message_id,COALESCE(role,'assistant'),COALESCE(body,''),search_normalize(COALESCE(body,''))
            FROM (
                SELECT CAST(substr(t.path,12,length(t.path)-12) AS INTEGER) AS position,
                    MAX(CASE WHEN t.key='id' THEN t.atom END) AS message_id,
                    MAX(CASE WHEN t.key='role' THEN t.atom END) AS role,
                    MAX(CASE WHEN t.key='content' THEN t.atom END) AS body
                FROM chats c,json_tree(c.data,'$.messages') t
                WHERE c.id=? AND t.type='text' AND t.key IN ('id','role','content')
                    AND substr(t.path,1,11)='$.messages['
                    AND length(t.path)>12
                    AND substr(t.path,12,length(t.path)-12) NOT GLOB '*[^0-9]*'
                GROUP BY t.parent
            ) WHERE message_id IS NOT NULL`).run(chatId);
        // A live message may be newer than the consolidated history JSON.
        // Read only its searchable fields, within the same revision snapshot.
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE name=\'chat_message_checkpoints\'").get()) {
            db.prepare(`UPDATE temp.chat_search_staging SET
                role=(SELECT json_extract(d.data,\'$.role\') FROM chat_message_checkpoints d WHERE d.chat_id=? AND d.message_id=chat_search_staging.message_id),
                body=(SELECT json_extract(d.data,\'$.content\') FROM chat_message_checkpoints d WHERE d.chat_id=? AND d.message_id=chat_search_staging.message_id),
                normalized=search_normalize((SELECT json_extract(d.data,\'$.content\') FROM chat_message_checkpoints d WHERE d.chat_id=? AND d.message_id=chat_search_staging.message_id))
                WHERE message_id IN (SELECT message_id FROM chat_message_checkpoints WHERE chat_id=?)`)
                .run(chatId,chatId,chatId,chatId);
        }
        db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    db.exec("BEGIN IMMEDIATE");
    try {
        const current = db.prepare("SELECT revision FROM chat_page_state WHERE chat_id=?").get(chatId) as {revision:number}|undefined;
        if (current?.revision !== revision) { db.exec("ROLLBACK"); return false; }
        db.prepare("DELETE FROM chat_search_messages WHERE chat_id=?").run(chatId);
        db.prepare(`INSERT INTO chat_search_messages(chat_id,position,message_id,role,body,normalized)
            SELECT ?,position,message_id,role,body,normalized FROM temp.chat_search_staging ORDER BY position`).run(chatId);
        db.prepare(`INSERT INTO chat_search_state VALUES(?,?)
            ON CONFLICT(chat_id) DO UPDATE SET ready_revision=excluded.ready_revision`).run(chatId,revision);
        db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    finally { db.exec("DELETE FROM temp.chat_search_staging"); }
    return true;
}
export async function runSearch(db: DatabaseSync, query: string, ownerId: string | undefined, limit: number, related: boolean, cancelled: () => boolean, includeNotes = true, uniqueChats = false): Promise<SearchPayload> {
    const needle = query.trim().slice(0, 200).toLowerCase();
    const empty: SearchPayload = { results: [], notes: [], projects: [] };
    if (!needle)
        return empty;
    const check = () => { if (cancelled())
        throw Object.assign(new Error("Search cancelled"), { name: "AbortError" }); };
    const access = [ownerId ?? null, ownerId ?? null, ownerId ?? null, ownerId ?? null];
    const visible = () => db.prepare(`SELECT c.id,c.title,c.keywords,c.updated_at FROM chat_list c
 LEFT JOIN projects p ON p.id=c.project_id WHERE ${SEARCH_CHAT_ACCESS}
 ORDER BY c.pinned DESC,COALESCE(c.last_message_sent,c.created_at) DESC,c.id`).all(...access) as Entry[];
    let entries = visible();
    const deadline = performance.now() + 150;
    // No full histories cross the web thread. Preparation is resumable, one chat
    // per transaction, and yields so superseded requests stop between records.
    for (const entry of entries) {
        check();
        if (performance.now() > deadline)
            break;
        let state = db.prepare(`SELECT s.revision,r.ready_revision FROM chat_page_state s
   LEFT JOIN chat_search_state r ON r.chat_id=s.chat_id WHERE s.chat_id=?`).get(entry.id) as {
            revision: number;
            ready_revision: number | null;
        } | undefined;
        if (!state) {
            // Histories imported before the page projection was introduced have
            // no revision row yet. Seed it without reading/parsing their JSON.
            db.prepare("INSERT OR IGNORE INTO chat_page_state(chat_id) SELECT id FROM chats WHERE id=?").run(entry.id);
            state = db.prepare("SELECT revision,0 AS ready_revision FROM chat_page_state WHERE chat_id=?").get(entry.id) as { revision:number; ready_revision:number }|undefined;
        }
        if (state && state.revision === state.ready_revision)
            continue;
        if (state) prepareLegacySearch(db,entry.id,state.revision);
        await pause();
    }
    check();
    entries = visible(); // Recheck current membership and metadata after asynchronous work.
    empty.indexing = !!db.prepare(`SELECT 1 FROM chat_list c LEFT JOIN projects p ON p.id=c.project_id
 LEFT JOIN chat_page_state s ON s.chat_id=c.id LEFT JOIN chat_search_state r ON r.chat_id=c.id
 WHERE ${SEARCH_CHAT_ACCESS} AND (s.revision IS NULL OR r.ready_revision IS NULL OR r.ready_revision!=s.revision) LIMIT 1`).get(...access);
    const results: ChatSearchResult[] = [];
    const order = new Map(entries.map((entry, index) => [entry.id, index]));
    for (const entry of entries) {
        let keywords: string[] = [];
        try {
            keywords = JSON.parse(entry.keywords || "[]");
        }
        catch { }
        const matchedKeywords = keywords.filter(k => typeof k === "string" && k.toLowerCase().includes(needle)).slice(0, 5).map(k => k.slice(0, 120));
        if (entry.title.toLowerCase().includes(needle) || matchedKeywords.length)
            results.push({
                chatId: entry.id, chatTitle: entry.title.slice(0, 200), updatedAt: entry.updated_at,
                snippet: entry.title.toLowerCase().includes(needle) ? searchSnippet(entry.title, needle) : ("Keywords: " + matchedKeywords.join(" · ")).slice(0, 400),
                ...(matchedKeywords.length ? { matchedKeywords } : {}),
            });
        if (results.length >= limit)
            break;
    }
    db.function("search_snippet", { deterministic: true }, (text, q) => searchSnippet(String(text ?? ""), String(q ?? "")));
    // FTS narrows long literal queries; one/two-character queries use plain text
    // inside this worker. Never query compact previews (they may omit the match).
    const useFts = Array.from(needle).length >= 3 && !needle.includes("\u0000");
    const matched = useFts ? "m.id IN (SELECT rowid FROM chat_search_fts WHERE chat_search_fts MATCH ?) AND" : "";
    const characters = Array.from(needle);
    const phrase = [...new Set(characters.slice(0, -2).map((_, i) => characters.slice(i, i + 3).join("")))]
        .map(gram => '"' + gram.replaceAll('"', '""') + '"').join(" AND ");
    const messages: (ChatSearchResult & {position:number})[] = [];
    if (useFts) messages.push(...db.prepare(`WITH hits AS (
  SELECT m.id${uniqueChats ? ", MIN(m.position) AS firstPosition" : ""} FROM chat_search_messages m JOIN chat_list c ON c.id=m.chat_id
  LEFT JOIN projects p ON p.id=c.project_id
  JOIN chat_page_state s ON s.chat_id=c.id
  JOIN chat_search_state r ON r.chat_id=c.id AND r.ready_revision=s.revision
  WHERE ${matched} instr(m.normalized,?)>0 AND ${SEARCH_CHAT_ACCESS}
  ${uniqueChats ? "GROUP BY c.id" : ""}
  ORDER BY c.pinned DESC,COALESCE(c.last_message_sent,c.created_at) DESC,c.id,${uniqueChats ? "firstPosition" : "m.position"} LIMIT ?
 ) SELECT m.chat_id AS chatId,substr(c.title,1,200) AS chatTitle,c.updated_at AS updatedAt,
 m.message_id AS messageId,m.role,search_snippet(m.body,?) AS snippet,m.position
 FROM hits JOIN chat_search_messages m ON m.id=hits.id JOIN chat_list c ON c.id=m.chat_id`)
        .all(...(useFts ? [phrase] : []), needle, ...access, limit, needle) as unknown as (ChatSearchResult & {
        position: number;
    })[]);
    else {
        // Walk the chat/position index in display order, stopping as soon as
        // enough hits exist. Common short queries need only the first chat.
        const short = db.prepare(`SELECT m.chat_id AS chatId,substr(c.title,1,200) AS chatTitle,
            c.updated_at AS updatedAt,m.message_id AS messageId,m.role,
            search_snippet(m.body,?) AS snippet,m.position
            FROM chat_search_messages m JOIN chat_list c ON c.id=m.chat_id
            LEFT JOIN projects p ON p.id=c.project_id
            JOIN chat_page_state s ON s.chat_id=c.id
            JOIN chat_search_state r ON r.chat_id=c.id AND r.ready_revision=s.revision
            WHERE m.chat_id=? AND instr(m.normalized,?)>0 AND ${SEARCH_CHAT_ACCESS}
            ORDER BY m.position LIMIT ?`);
        for (const entry of entries) {
            const hits = short.all(needle,entry.id,needle,...access,uniqueChats ? 1 : limit-messages.length) as unknown as (ChatSearchResult & {position:number})[];
            messages.push(...hits);
            if (messages.length>=limit) break;
        }
    }
    const ranked = [...results.map(result => ({ ...result, position: -1 })), ...messages];
    ranked.sort((a, b) => (order.get(a.chatId) ?? Infinity) - (order.get(b.chatId) ?? Infinity) || a.position - b.position);
    // Apply the chat limit after grouping, so a long transcript cannot hide
    // other conversations. Keep message-level results for tool/API consumers.
    const seenChats = new Set<string>();
    empty.results = ranked.filter(result => {
        if (!uniqueChats) return true;
        if (seenChats.has(result.chatId)) return false;
        seenChats.add(result.chatId);
        return true;
    }).slice(0, limit).map(({ position: _position, ...result }) => result);
    if (!related)
        return empty;
    check();
    db.function("search_contains", { deterministic: true }, (text) => String(text ?? "").toLowerCase().includes(needle) ? 1 : 0);
    const projectAccess = "(? IS NULL OR p.owner_id=? OR EXISTS(SELECT 1 FROM project_members a WHERE a.project_id=p.id AND a.user_id=?))";
    empty.projects = db.prepare(`SELECT p.id,substr(json_extract(p.data,'$.name'),1,200) AS name,
 json_extract(p.data,'$.color') AS color,json_extract(p.data,'$.icon') AS icon FROM projects p
 WHERE ${projectAccess} AND search_contains(COALESCE(json_extract(p.data,'$.name'),'')||char(10)||COALESCE(json_extract(p.data,'$.instructions'),''))
 ORDER BY p.updated_at DESC LIMIT 8`).all(ownerId ?? null, ownerId ?? null, ownerId ?? null) as SearchPayload["projects"];
    if (!includeNotes)
        return empty;
    empty.notes = db.prepare(`WITH hits AS (
 SELECT n.id FROM notes n LEFT JOIN projects p ON p.id=json_extract(n.data,'$.projectId')
 WHERE n.archived=0 AND COALESCE(json_extract(n.data,'$.kind'),'note')!='learned_fact'
 AND json_extract(n.data,'$.scope') IN ('global','chat','workspace')
 AND (? IS NULL OR CASE WHEN p.id IS NOT NULL THEN ${projectAccess} ELSE n.owner_id=? END)
 AND (search_contains(COALESCE(json_extract(n.data,'$.title'),'')||char(10)||COALESCE(json_extract(n.data,'$.content'),''))
 OR (p.id IS NOT NULL AND search_contains(COALESCE(json_extract(p.data,'$.name'),'')||char(10)||COALESCE(json_extract(p.data,'$.instructions'),''))))
 ORDER BY n.updated_at DESC LIMIT 8
 ) SELECT n.id AS noteId,substr(json_extract(n.data,'$.title'),1,200) AS title,
 search_snippet(COALESCE(json_extract(n.data,'$.content'),''),?) AS snippet,n.updated_at AS updatedAt
 FROM hits JOIN notes n ON n.id=hits.id`).all(ownerId ?? null, ownerId ?? null, ownerId ?? null, ownerId ?? null, ownerId ?? null, needle) as SearchPayload["notes"];
    return empty;
}
