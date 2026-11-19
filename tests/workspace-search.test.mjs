import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync, chownSync, readFileSync } from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { normalizeWorkspaceSearch, buildWorkspaceSearchProgram, WORKSPACE_SEARCH_TOOLS } from "../lib/mcp-core/workspace-search.mjs";
import { spawnSync } from "node:child_process";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-workspace-search-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,AI_CHAT_MCP_STATE_DIR:path.join(root,"mcp-state"),AI_CHAT_INTERNAL_ORIGIN:"http://127.0.0.1:1",MCP_BEARER_TOKEN:"synthetic"});
test.after(()=>rmSync(root,{recursive:true,force:true}));
const workspace=path.join(root,"workspace");mkdirSync(workspace);
for(const folder of ["src","nested","node_modules",".git"])mkdirSync(path.join(workspace,folder));
writeFileSync(path.join(workspace,"src","code.ts"),"zero\nMünchen Needle\nneedle again\nafter\n");
writeFileSync(path.join(workspace,"nested","two.tsx"),"Needle\n");
writeFileSync(path.join(workspace,".hidden"),"Needle\n");
writeFileSync(path.join(workspace,"node_modules","ignored.ts"),"Needle\n");
writeFileSync(path.join(workspace,".git","private"),"Needle\n");
writeFileSync(path.join(workspace,"binary.bin"),Buffer.from([0,78,101,101,100,108,101]));
writeFileSync(path.join(workspace,"large.txt"),"Needle"+"x".repeat(2*1024*1024));
writeFileSync(path.join(root,"outside.txt"),"OUTSIDE_PRIVATE");
symlinkSync(path.join(root,"outside.txt"),path.join(workspace,"escape"));
const gateway=await import("../lib/mcp-core/gateway-core.mjs");
const context={uid:process.getuid?.(),gid:process.getgid?.(),home:root,workspaceRoot:workspace,allowRoot:true,isHostAdmin:true,userId:"fixture-user",
  modePolicy:JSON.stringify({allowedCategories:["read"],toolOverrides:{}})};
async function call(name,args,extra={}) {
 const result=await gateway.dispatchGatewayTool(name,args,{auditCall:false,context:{...context,...extra}});
 const text=result.content?.filter(c=>c.type==="text").map(c=>c.text).join("\n");
 return {result,data:result.isError?undefined:JSON.parse(text),text};
}
test("fresh core catalog includes both structured searches as read-only tools",()=>{
 for(const name of ["grep_search","file_search"]){const tool=WORKSPACE_SEARCH_TOOLS.find(t=>t.name===name);assert.equal(tool.annotations.readOnlyHint,true);assert.equal(gateway.modeToolCategory(name),"read");assert.ok(gateway.visibleToolsForContext(context).some(t=>t.name===name));}
});
test("literal, regex, case-insensitive, glob and context searches run without shell output",async()=>{
 const first=await call("grep_search",{path:"src",pattern:"Needle",context_lines:1});
 assert.ok(!first.result.isError,first.text);assert.equal(first.data.type,"text_search");assert.equal(first.data.matches.length,1);
 assert.equal(first.data.matches[0].line,2);assert.equal(first.data.matches[0].column,9);assert.equal(first.data.matches[0].text,"München Needle");
 assert.deepEqual(first.data.matches[0].context,[{line:1,text:"zero"},{line:3,text:"needle again"}]);
 const insensitive=await call("grep_search",{path:"src",pattern:"needle",case_sensitive:false});
 assert.equal(insensitive.data.count,2);
 const regex=await call("grep_search",{pattern:"^Needle$",regex:true,glob:"**/*.tsx"});
 assert.deepEqual(regex.data.matches.map(m=>m.path),["nested/two.tsx"]);
 assert.equal(regex.data.stdout,undefined);
});
test("file globs support root/nested basenames, braces, spaces and empty results",async()=>{
 const all=await call("file_search",{pattern:"*.{ts,tsx}"});
 assert.deepEqual(all.data.files.map(m=>m.path),["nested/two.tsx","src/code.ts"]);
 assert.equal(all.data.root,workspace);
 writeFileSync(path.join(workspace,"src","space file.md"),"safe");
 assert.equal((await call("file_search",{path:"src",pattern:"*file.md"})).data.files[0].path,"space file.md");
 const empty=await call("grep_search",{pattern:"NOT_FOUND"});assert.equal(empty.data.count,0);assert.equal(empty.data.truncated,false);
 const explicit=await call("grep_search",{path:"src/code.ts",pattern:"Needle"});assert.equal(explicit.data.matches[0].path,"code.ts");
});
test("search defaults skip hidden, binary, oversized and dependency files and never follow symlinks",async()=>{
 const found=await call("grep_search",{pattern:"Needle"});
 assert.equal(found.data.count,2);assert.equal(found.data.skipped.binary,1);assert.equal(found.data.skipped.oversized,1);assert.equal(found.data.skipped.symlinks,1);
 const expanded=await call("grep_search",{pattern:"Needle",include_hidden:true,include_ignored:true});
 assert.equal(expanded.data.count,4);assert.ok(!expanded.data.matches.some(m=>m.path.startsWith(".git/")));
 const outside=await call("grep_search",{pattern:"OUTSIDE",include_hidden:true});assert.equal(outside.data.count,0);
 assert.equal((await call("grep_search",{path:"escape",pattern:"PRIVATE"})).result.isError,true);
 assert.equal((await call("grep_search",{path:"../",pattern:"PRIVATE"})).result.isError,true);
});
test("file names include dotfiles and non-text entries without reading their contents", async () => {
 const deep = path.join(workspace, "nested", "deeper"); mkdirSync(deep);
 mkdirSync(path.join(workspace, ".config"));
 writeFileSync(path.join(deep, ".env.deep"), "other");
 writeFileSync(path.join(workspace, ".config", ".env.binary"), Buffer.from([0,1,2]));
 writeFileSync(path.join(workspace, ".git", ".env.hidden"), "not visible");
 writeFileSync(path.join(workspace, ".env"), "FIXTURE_SETTING=off");
 try {
  const names = await call("file_search", {pattern:".env*",include_hidden:true});
  assert.deepEqual(names.data.files.map(row => row.path), [".config/.env.binary",".env","nested/deeper/.env.deep"]);
  assert.equal(names.data.skipped.binary,0);
  assert.equal(names.data.skipped.oversized,0);
  const narrow = await call("file_search", {pattern:".env*",include_hidden:true,limit:1});
  assert.equal(narrow.data.files[0].path,".env");
  assert.equal(narrow.data.truncated,true);
  const explicit = await call("file_search", {pattern:"*.{bin,txt}",include_hidden:true});
  assert(explicit.data.files.some(row => row.path === "binary.bin"));
  assert(explicit.data.files.some(row => row.path === "large.txt"));
 } finally {
  for (const file of [".env", ".config", "nested/deeper", ".git/.env.hidden"]) rmSync(path.join(workspace,file), {recursive:true,force:true});
 }
});

test("result caps explicitly mark partial results, invalid regex/parameters report tool errors",async()=>{
 const cap=await call("grep_search",{pattern:"needle",case_sensitive:false,limit:1});assert.equal(cap.data.count,1);assert.equal(cap.data.truncated,true);assert.deepEqual(cap.data.limits,["results"]);
 for(const args of [{pattern:"[",regex:true},{pattern:"",limit:1},{pattern:"Needle",limit:0},{pattern:"Needle",limit:201},{pattern:"Needle",context_lines:4},{pattern:"Needle",regex:"true"}]){
  assert.equal((await call("grep_search",args)).result.isError,true);
 }
 const denied=await call("grep_search",{pattern:"Needle"},{modePolicy:JSON.stringify({allowedCategories:[],toolOverrides:{}})});
 assert.equal(denied.result.isError,true);
});
test("patterns are data, never executable shell strings",async()=>{
 const pattern="${HOME} $(touch "+path.join(workspace,"should-not-exist")+") `id`";
 writeFileSync(path.join(workspace,"literal.txt"),pattern);
 const found=await call("grep_search",{pattern});
 assert.equal(found.data.count,1);
 assert.throws(()=>readFileSync(path.join(workspace,"should-not-exist")));
});
test("serialized worker is independent of the app checkout and returns bounded line previews",()=>{
 writeFileSync(path.join(workspace,"longline.txt"),"x".repeat(6000)+"SPECIAL_END");
 const request=normalizeWorkspaceSearch("grep_search",{pattern:"SPECIAL_END",path:workspace});
 const result=spawnSync(process.execPath,["-"],{input:buildWorkspaceSearchProgram({...request,workspace}),encoding:"utf8",cwd:workspace,env:{PATH:"/nonexistent"},timeout:10000});
 assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout);
 assert.equal(data.matches[0].column,6001);assert.equal(data.matches[0].textTruncated,true);assert.ok(data.matches[0].text.includes("SPECIAL_END"));
});
test("serialized searches still execute after production function minification", async () => {
 const require = createRequire(import.meta.url);
 const { minify } = require("next/dist/compiled/terser");
 const source = readFileSync(new URL("../lib/mcp-core/workspace-search.mjs", import.meta.url), "utf8")
   .replace('from "minimatch"', "from " + JSON.stringify(pathToFileURL(require.resolve("minimatch")).href));
 const compiled = await minify(source, { module: true, compress: true, mangle: true });
 const modulePath = path.join(root, "minified-search.mjs");writeFileSync(modulePath, compiled.code);
 const bundled = await import(pathToFileURL(modulePath).href);
 for (const [name, args, expected] of [
   ["file_search", {pattern:"*.ts",path:path.join(workspace,"src")}, 1],
   ["grep_search", {pattern:"needle",path:path.join(workspace,"src"),case_sensitive:false}, 2],
 ]){
   const request = bundled.normalizeWorkspaceSearch(name,args);
   const result = spawnSync(process.execPath,["-"],{input:bundled.buildWorkspaceSearchProgram({...request,workspace}),encoding:"utf8",cwd:workspace,timeout:10000});
   assert.equal(result.status,0,result.stderr);
   assert.equal(JSON.parse(result.stdout).count,expected);
 }
});
test("unprivileged gateway search uses mapped UID and cannot read private files or escape the workspace",{skip:process.platform!=="linux"||process.getuid?.()!==0},async()=>{
 const fields=readFileSync("/etc/passwd","utf8").split("\n").find(line=>line.startsWith("nobody:")).split(":");
 chmodSync(root,0o711);chmodSync(workspace,0o755);chmodSync(path.join(workspace,"src"),0o755);chmodSync(path.join(workspace,"src","code.ts"),0o644);
 const privateFile=path.join(workspace,"root-only.txt");writeFileSync(privateFile,"ROOT_SECRET",{mode:0o600});
 const safe=await call("grep_search",{pattern:"Needle",path:"src"},{uid:Number(fields[2]),gid:Number(fields[3]),osUsername:fields[0],home:workspace,isHostAdmin:false,allowRoot:false});
 assert.ok(!safe.result.isError,safe.text);assert.equal(safe.data.count,1);
 const unprivileged={uid:Number(fields[2]),gid:Number(fields[3]),osUsername:fields[0],home:workspace,isHostAdmin:false,allowRoot:false};
 const name=await call("file_search",{pattern:"root-only.txt"},unprivileged);
 assert.deepEqual(name.data.files.map(file=>file.path),["root-only.txt"]);
 assert.ok(!name.text.includes("ROOT_SECRET"));
 const secret=await call("grep_search",{pattern:"ROOT_SECRET"},unprivileged);
 assert.ok(!secret.result.isError,secret.text);assert.equal(secret.data.count,0);assert.ok(secret.data.skipped.unreadable>0);
 assert.equal((await call("grep_search",{pattern:"ROOT_SECRET"},{uid:0,gid:0,isHostAdmin:false,allowRoot:true})).result.isError,true);
});
