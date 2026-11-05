import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { noteLucideIcon, parseNoteIcon, searchNoteIcons } from "../lib/note-icon";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-note-icons-"));
Object.assign(process.env, { CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root,"chat.sqlite"), AGENT_CWD: root, AI_CHAT_ROOT: root });
test.after(() => rmSync(root, { recursive: true, force: true }));

test("page icons preserve Unicode and validate structured glyph/color values", () => {
  for (const text of ["📚", "👩🏽‍💻", "🏳️‍🌈", "legacy"]) assert.deepEqual(parseNoteIcon(text), { kind: "emoji", text });
  const value=noteLucideIcon("check-check","#ABC");
  assert.equal(value,"lucide:check-check:#aabbcc");
  assert.deepEqual(parseNoteIcon(value),{kind:"lucide",name:"check-check",color:"#aabbcc"});
  assert.equal(noteLucideIcon("check"),"lucide:check");
  assert.equal(parseNoteIcon(null),null);
  for(const text of ["lucide:not-real","lucide:check:red","lucide:check:#123456:extra","lucide:check:url(x)"]) assert.equal(parseNoteIcon(text),null);
  assert.equal(noteLucideIcon("check","url(x)"),null);
});

test("the library supports names, multiword queries and plural checks", () => {
  assert.ok(searchNoteIcons("").length > 1500);
  assert.ok(searchNoteIcons("checks").includes("check-check"));
  assert.ok(searchNoteIcons("circle check").includes("circle-check"));
  assert.equal(searchNoteIcons("absolutely-no-such-icon-xyz").length,0);
});

test("colored icons, emoji replacements and removal persist through real note writes", async () => {
  const {createNote,getNote,updateNote,notePageInputFromBody}=await import("../lib/shared-context");
  const { getDatabase } = await import("../lib/sqlite");
  getDatabase().prepare("INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)").run("fixture-owner","icons-owner","unused",new Date().toISOString());
  const value=noteLucideIcon("check-check","#22c55e")!;
  const note=createNote({title:"Icon fixture",content:"Unchanged content",ownerId:"fixture-owner",icon:value});
  assert.equal(getNote(note.id,"fixture-owner")?.icon,value);
  assert.equal(getNote(note.id,"other-owner"),null);
  const emoji=updateNote(note.id,{...notePageInputFromBody({icon:"👩🏽‍💻"}),ownerId:"fixture-owner"});
  assert.equal(emoji?.icon,"👩🏽‍💻");
  assert.equal(emoji?.content,"Unchanged content");
  const removed=updateNote(note.id,{...notePageInputFromBody({icon:null}),ownerId:"fixture-owner"});
  assert.equal(removed?.icon,null);
});
