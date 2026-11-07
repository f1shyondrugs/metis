import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { editedFileFromTool as detailedEditedFileFromTool, editedFilesForMessage as detailedEditedFilesForMessage, editedFileHref, type EditedFile } from "../lib/edited-files";
import type { ToolPart } from "../lib/store";
import { compactChatPageMessages } from "../lib/chat-page-payload";
import { parseWorkspaceFileLink } from "../lib/workspace-file-link";
// These regressions assert the original count/path contract; range behavior has its own suite.
const summary = (file: EditedFile) => { const { ranges, lineChanges, ...fields } = file; return fields; };
const editedFileFromTool = (...args: Parameters<typeof detailedEditedFileFromTool>) => { const file = detailedEditedFileFromTool(...args); return file ? summary(file) : null; };
const editedFilesForMessage = (...args: Parameters<typeof detailedEditedFilesForMessage>) => detailedEditedFilesForMessage(...args).map(summary);
const dir = mkdtempSync(path.join(os.tmpdir(), "metis-edited-files-"));
Object.assign(process.env, { CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"), AGENT_CWD: dir, AI_CHAT_ROOT: dir });
after(() => rmSync(dir, { recursive: true, force: true }));
const edit = (overrides: Partial<ToolPart> = {}): ToolPart => ({ id: "edit", name: "edit_file", status: "completed", input: JSON.stringify({ path: "/workspace/src/main.ts" }), result: '{"changed":true}', ...overrides });

test("line counts exclude unchanged middle lines and handle creation, deletion and blank lines", () => {
  assert.deepEqual(editedFileFromTool(edit({diff:{before:"old\nkeep\nbefore\n",after:"new\nkeep\nafter\n"}})),{path:"/workspace/src/main.ts",target:"server",additions:2,deletions:2});
  assert.equal(editedFileFromTool(edit({diff:{before:undefined,after:"first\nsecond\n"}}))!.additions,2);
  assert.deepEqual(editedFileFromTool(edit({diff:{before:"one\ntwo\n",after:""}})),{path:"/workspace/src/main.ts",target:"server",additions:0,deletions:2});
  assert.equal(editedFileFromTool(edit({diff:{before:"a\nb\n",after:"a\n\nb\n"}}))!.additions,1);
  assert.equal(editedFileFromTool(edit({diff:{before:"a\n",after:"a"}}))!.additions,1,"EOF newline change is a changed line");
});

test("per-file totals count each tool once and persist without snapshots", async () => {
  const one=edit({diff:{before:"one\n",after:"two\n"}}),two=edit({id:"second",diff:{before:"two\n",after:"three\nfour\n"}});
  const files=editedFilesForMessage({tools:[one,two],parts:[{type:"tool",...one},{type:"tool",...two}]});
  assert.deepEqual(files,[{path:"/workspace/src/main.ts",target:"server",additions:3,deletions:2}]);
  const {compactToolForPersistence}=await import("../lib/tool-persistence");
  const saved=JSON.parse(JSON.stringify([one,two].map(t=>compactToolForPersistence(t))));
  assert.deepEqual(editedFilesForMessage({tools:saved}),files);
  const legacy=edit({editedFile:{path:"/workspace/src/main.ts",target:"server"},diff:{additions:4,deletions:1}});
  assert.equal(editedFileFromTool(legacy)!.additions,4);
});

test("unknown, partial and excessive diff counts remain unavailable", () => {
  for (const diff of [undefined,{additions:NaN,deletions:0},{additions:-1,deletions:0},{additions:2},{before:"x".repeat(2_000_001),after:"y"}]) {
    const file=editedFileFromTool(edit({diff}));
    assert.equal(file!.additions,undefined);
    assert.equal(file!.deletions,undefined);
  }
  const files=editedFilesForMessage({tools:[edit({diff:{additions:3,deletions:1}}),edit({id:"unknown"})]});
  assert.equal(files[0].additions,undefined,"partial totals must not look complete");
});

test("canonical file tools and provider-prefixed gateway wrappers resolve paths", () => {
  for (const name of ["edit_file", "write_file", "create_file", "mcp__metis_ai__edit_file", "mcp_metis_ai.edit_file", "Write", "StrReplace"]) {
    assert.deepEqual(editedFileFromTool(edit({ name })), { path: "/workspace/src/main.ts", target: "server" });
  }
  assert.deepEqual(editedFileFromTool(edit({ name: "mcp__gateway__call_mcp_tool", input: JSON.stringify({ tool: "edit_file", arguments: JSON.stringify({path: "/workspace/wrapped.ts"}) }), result: JSON.stringify({content:[{type:"text",text:'{"changed":true,"path":"/workspace/wrapped.ts"}'}]}) })), { path: "/workspace/wrapped.ts", target: "server" });
  for (const name of ["read_file", "execute_command", "delete_file", "edit_memory", "create_plan"]) assert.equal(editedFileFromTool(edit({ name })), null);
});

test("only successful actual edits count", () => {
  for (const status of ["running", "pending", "error", "failed", "cancelled"]) assert.equal(editedFileFromTool(edit({ status })), null);
  for (const result of [{ changed: false }, { dryRun: true }, { isError: true, content: [] }, { exit_code: 1 }, { success: false }, { error: "write failed" }]) assert.equal(editedFileFromTool(edit({ result: JSON.stringify(result) })), null);
  assert.equal(editedFileFromTool(edit({ input: '{"path":"/w/a","dryRun":true}' })), null);
  assert.equal(editedFileFromTool(edit({ diff: {before: "same", after: "same"} })), null);
  assert.equal(editedFileFromTool(edit({input: "{}",path: undefined,result: "{}"})), null);
});

test("deduplication stays within a message and includes parts-only streaming calls", () => {
  const tools = [edit(), edit({id:"again"}), edit({id:"second",input:'{"path":"/workspace/other.ts"}'}),edit({id:"failed",status:"error"})];
  assert.equal(editedFilesForMessage({tools,parts:tools.map(tool=>({type:"tool",...tool}))}).length,2);
  assert.equal(editedFilesForMessage({parts:[{type:"tool",...edit()}]}).length,1);
  assert.equal(editedFilesForMessage({tools:[edit({status:"error"})],parts:[{type:"tool",...edit()}]}).length,0);
  assert.deepEqual(editedFilesForMessage({}),[]);
  assert.equal(editedFilesForMessage({tools:[edit({id:"a",input:'{"path":"/workspace/a","target":"client:one"}'}),edit({id:"b",input:'{"path":"/workspace/a","target":"server"}'})]}).length,2);
});

test("workspace links preserve unusual paths and never map remote files to the server", () => {
  const file = {path:"/workspace/My project/100% #?config.ts",target:"server"};
  assert.deepEqual(parseWorkspaceFileLink(editedFileHref(file)), {path:file.path});
  assert.equal(editedFileHref({path:"C:\\Users\\Noah\\main.ts",target:"client:device"}),undefined);
  assert.equal(editedFileHref({path:"/home/noah/file.ts",target:"laptop"}),undefined);
  assert.equal(editedFileHref({path:"relative.ts",target:"server"}),undefined);
});

test("deferred page arguments retain edit identity before truncation", () => {
  const tool = edit({ input: JSON.stringify({path:"/workspace/long.ts",edits:Array.from({length:50},()=>({oldText:"old".repeat(100),newText:"new".repeat(100)}))}) });
  const page=compactChatPageMessages([{id:"message",role:"assistant",content:"Updated.",createdAt:new Date().toISOString(),tools:[tool]}],"chat")[0];
  assert.ok(page.tools![0].inputUrl);
  assert.deepEqual(editedFilesForMessage(page),[{path:"/workspace/long.ts",target:"server"}]);
});

test("durable compaction preserves edits, no-op exclusions, and message parts", async () => {
  const {compactToolForPersistence,compactMessagePartsForPersistence}=await import("../lib/tool-persistence");
  const running=compactToolForPersistence(edit({status:"running"}));
  assert.equal(running.editedFile,undefined);
  assert.equal(editedFilesForMessage({tools:[{...running,status:"completed"}]}).length,1);
  const input=JSON.stringify({edits:Array.from({length:200},()=>({oldText:"x".repeat(200),newText:"y".repeat(200)})),path:"/workspace/tail.ts"});
  const tool=edit({input}),compact=compactToolForPersistence(tool);
  assert.ok(compact.input!.length < input.length);
  assert.deepEqual(editedFilesForMessage({tools:[compact]}),[{path:"/workspace/tail.ts",target:"server"}]);
  const parts=compactMessagePartsForPersistence([{type:"tool",...tool}]);
  assert.deepEqual(editedFilesForMessage({parts}),[{path:"/workspace/tail.ts",target:"server"}]);
  const noop=compactToolForPersistence(edit({diff:{before:"same",after:"same"}}));
  assert.equal(noop.editedFile,null);
  assert.deepEqual(editedFilesForMessage({tools:[noop]}),[]);
});

test("per-run tracking trusts scoped gateway receipts and preserves remote targets", async () => {
  const {withEditedFileTracking}=await import("../lib/file-edit-snapshot");
  const {storeFileEditSnapshot}=await import("../lib/mcp-core/file-edit-snapshots.mjs");
  const scope={userId:"edited-owner",chatId:"edited-chat",jobId:"edited-job"};
  const receipt=(target:string)=>JSON.stringify(storeFileEditSnapshot({path:"src/main.ts",fileSnapshot:{before:"before",after:"after"}},scope,target));
  assert.equal(withEditedFileTracking(edit({input:'{"path":"src/main.ts"}',diff:{before:"forged",after:"forged-again"}}),dir).editedFile,null);
  const local=withEditedFileTracking(edit({result:receipt("server")}),dir,undefined,scope);
  assert.equal(local.editedFile?.path,path.join(dir,"src/main.ts"));assert.equal(local.editedFile?.target,"server");
  assert.ok(editedFileHref(local.editedFile!));
  const remote=withEditedFileTracking(edit({result:receipt("client:laptop")}),dir,undefined,scope);
  assert.equal(remote.editedFile?.path,"src/main.ts");assert.equal(remote.editedFile?.target,"client:laptop");
  const responseOnly=withEditedFileTracking(edit({input:undefined,path:undefined}),dir,edit({status:"running",input:'{"path":"src/main.ts","target":"client:laptop"}'}),scope);
  assert.equal(responseOnly.editedFile,null);
});

test("saved inline diffs use exact tool identity and remain owner scoped", async () => {
  const [auth,store,api]=await Promise.all([import("../lib/auth"),import("../lib/db-store"),import("../app/api/chats/[id]/tool-diff/route")]);
  const owner=auth.createUser("diff-owner","test-password"),other=auth.createUser("diff-other","test-password");
  const chat=store.createChat("Saved diff",undefined,owner.id);
  const {persistToolsForMessage}=await import("../lib/tool-persistence");
  const persisted=persistToolsForMessage(chat.id,"diff-message",[edit({kind:"edit",path:"/workspace/src/main.ts",diff:{before:"removed\\n",after:"added\\n"}})]);
  store.appendMessage(chat.id,{id:"diff-message",role:"assistant",content:"Updated.",tools:persisted},owner.id);
  const request=(user:typeof owner|undefined,query="messageId=diff-message&toolId=edit")=>api.GET(new Request("http://test/api/chats/"+chat.id+"/tool-diff?"+query,{headers:user?{cookie:"ai_chat_auth="+auth.authenticateUser(user.username,"test-password")!.token}:{}}),{params:Promise.resolve({id:chat.id})});
  const response=await request(owner);assert.equal(response.status,200);
  assert.equal(response.headers.get("cache-control"),"private, no-store");
  assert.deepEqual((await response.json()).diff,{path:"/workspace/src/main.ts",before:"removed\\n",after:"added\\n"});
  assert.equal((await request(other)).status,404);assert.equal((await request(undefined)).status,401);
  assert.equal((await request(owner,"messageId=diff-message&toolId=missing")).status,404);
  assert.equal((await request(owner,"messageId=diff-message")).status,400);
});

test("real persisted chat pages retain per-message files and stay owner scoped", async () => {
  const [auth,store,api]=await Promise.all([import("../lib/auth"),import("../lib/db-store"),import("../app/api/chats/[id]/route")]);
  const owner=auth.createUser("edited-files-owner","test-password"),other=auth.createUser("edited-files-other","test-password");
  const chat=store.createChat("File tracking",undefined,owner.id);
  store.appendMessage(chat.id,{id:"one",role:"assistant",content:"First.",tools:[edit({input:JSON.stringify({path:"/workspace/first.ts",content:"x".repeat(100000)})})]},owner.id);
  store.appendMessage(chat.id,{id:"two",role:"assistant",content:"Second.",tools:[edit({input:'{"path":"/workspace/second.ts"}'})]},owner.id);
  store.clearStoreCaches();
  const request=async(username:string)=>api.GET(new Request("http://test/api/chats/"+chat.id,{headers:{cookie:"ai_chat_auth="+auth.authenticateUser(username,"test-password")!.token}}),{params:Promise.resolve({id:chat.id})});
  const response=await request(owner.username);assert.equal(response.status,200);
  const body=await response.json();
  assert.deepEqual(body.chat.messages.filter((m:{role:string})=>m.role==="assistant").map(editedFilesForMessage),[[{path:"/workspace/first.ts",target:"server"}],[{path:"/workspace/second.ts",target:"server"}]]);
  assert.equal((await request(other.username)).status,404);
});
