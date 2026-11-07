import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { METIS_SHARED_AGENT_CONTROL, METIS_SOURCES_PROMPT } from "../lib/agent-control";
import { HTML_EMBED_PROMPT } from "../lib/html-embed";

const dir = mkdtempSync(path.join(os.tmpdir(), "metis-sources-prompt-"));
Object.assign(process.env,{CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"test.sqlite"),AI_CHAT_ROOT:dir,AGENT_CWD:dir});
after(()=>rmSync(dir,{recursive:true,force:true}));

test("actual provider prompts include the shared sources format in every mode and incognito", async () => {
  const {getDatabase}=await import("../lib/sqlite");
  const store=await import("../lib/db-store");
  const {buildProviderPrompt}=await import("../lib/providers/prompt-context");
  const now=new Date().toISOString(),userId="sources-owner";
  getDatabase().prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)").run(userId,userId,"unused",now);
  const chat=store.createChat("Sources",undefined,userId);
  assert.ok(METIS_SHARED_AGENT_CONTROL.includes(METIS_SOURCES_PROMPT));
  for(const modeId of ["agent","ask","deep-research"]) for(const incognito of [false,true]) {
    const prompt=buildProviderPrompt({job:{id:"sources-job",chatId:chat.id,userId,message:"Research this",modeId,incognito,status:"running",attempts:1,createdAt:now,updatedAt:now}});
    assert.equal(prompt.split(METIS_SOURCES_PROMPT).length-1,1);
    assert.equal(prompt.split(HTML_EMBED_PROMPT).length-1,1, "HTML previews are documented in each actual provider prompt");
    assert.match(prompt,/inline links alone do not populate it/);
    assert.match(prompt,/If no verifiable web source was used, omit/);
  }
});
