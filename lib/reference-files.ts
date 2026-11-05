import type { DatabaseSync } from "node:sqlite";
import type { ReferenceResult } from "./reference-search";
import { referenceMatches } from "./reference-search";

const json = (expression: string) => `CASE WHEN json_valid(${expression}) THEN ${expression} ELSE '{}' END`;
/** Project file handles only. Huge message text, diffs and tool results never enter JS. */
export async function referenceFiles(db: DatabaseSync, chatId: string, title: string, query: string,
  push: (item: ReferenceResult) => void, check: () => void, full: () => boolean) {
  const state = db.prepare("SELECT revision,ready_revision FROM chat_page_state WHERE chat_id=?").get(chatId) as
    { revision: number; ready_revision: number } | undefined;
  const ready = state && state.revision === state.ready_revision;
  const messages = ready
    ? "SELECT data FROM chat_page_messages WHERE chat_id=?"
    : `SELECT COALESCE(d.data,m.value) AS data FROM chats c,json_each(c.data,'$.messages') m
       LEFT JOIN chat_message_checkpoints d ON d.chat_id=c.id AND d.message_id=json_extract(m.value,'$.id') WHERE c.id=?`;
  const tools = ready
    ? "SELECT data FROM chat_page_tools WHERE chat_id=?"
    : `SELECT t.value AS data FROM (${messages}) m,json_each(m.data,'$.tools') t
       UNION ALL SELECT t.value AS data FROM (${messages}) m,json_each(m.data,'$.parts') t
       WHERE json_extract(t.value,'$.type')='tool'`;
  // The common wrapped argument forms can be JSON objects or JSON-encoded strings.
  const input = json("json_extract(data,'$.input')");
  const paths = ["path","filePath","file_path","filename"].flatMap(key =>
    ["", "args.", "arguments.", "input.", "params.", "value.", "data."].map(prefix => `json_extract(${input},'$.${prefix}${key}')`));
  const filePath = `COALESCE(json_extract(data,'$.editedFile.path'),json_extract(data,'$.path'),${paths.join(",")},(SELECT atom FROM json_tree(${input}) WHERE type=\'text\' AND key IN (\'path\',\'filePath\',\'file_path\',\'filename\') ORDER BY length(fullkey) LIMIT 1))`;
  const rows = db.prepare(`SELECT json_extract(data,'$.id') AS id,json_extract(data,'$.name') AS name,
    ${filePath} AS path,
    COALESCE(json_extract(data,'$.editedFile.target'),json_extract(${input},'$.target'),'server') AS target,
    substr(CASE WHEN json_type(data,'$.result')='text' THEN json_extract(data,'$.result') ELSE COALESCE(json_extract(data,'$.detail'),'') END,1,6000) AS content
    FROM (${tools}) WHERE typeof(${filePath})='text'`).iterate(...(ready ? [chatId] : [chatId,chatId]));
  let count = 0;
  for (const row of rows) {
    check();
    const path = String(row.path);
    const label = path.split(/[\\/]/).pop() || path;
    const detail = typeof row.name === "string" ? row.name : `${row.target} · in ${title}`;
    const content = String(row.content || "");
    if (referenceMatches(query,label,detail,path,content)) push({
      kind:"file",id:`${chatId}:${row.id || path}`,label,detail,chatId,path,content,target:String(row.target || "server"),
    });
    if (full()) return;
    if (++count % 8 === 0) await new Promise<void>(resolve => setImmediate(resolve));
  }
  for (const row of db.prepare(`SELECT json_extract(a.value,'$.id') AS id,json_extract(a.value,'$.name') AS name,
    json_extract(a.value,'$.storedName') AS path FROM (${messages}) m,json_each(m.data,'$.attachments') a`).iterate(chatId)) {
    check();
    push({kind:"file",id:`${chatId}:${row.id}`,label:String(row.name || "File"),detail:`in ${title}`,chatId,
      ...(typeof row.path === "string" ? {path:row.path} : {})});
    if (full()) return;
  }
}
