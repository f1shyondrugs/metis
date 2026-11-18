import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-shared-skills-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:path.join(root,"data"),CHAT_DB_PATH:path.join(root,"data/chat.sqlite"),AI_CHAT_PUBLIC_URL:"https://metis.example"});
mkdirSync(path.join(root,"skills/builtin"),{recursive:true});
writeFileSync(path.join(root,"skills/builtin/SKILL.md"),"# Builtin");
writeFileSync(path.join(root,"skills-lock.json"),JSON.stringify({skills:{builtin:{source:"trusted/repo",sourceType:"github",skillPath:"skills/builtin/SKILL.md"}}}));
test("manual skill sharing lifecycle", async (t) => {
const {addPersonalSkill,validateSkillPackage}=await import("../lib/personal-skills");
const {listInstalledSkills,skillsCatalogPrompt,alwaysOnSkillsPrompt}=await import("../lib/skills");
const {getGlobalModelSettings,saveGlobalModelSettings}=await import("../lib/db-store");
const {getDatabase}=await import("../lib/sqlite");
const {createSkillShare,getSharedSkill,importSharedSkill,revokeSkillShare,skillShareLink}=await import("../lib/skill-sharing");
const {readSkillFile}=await import("../lib/skill-files");
const publicRoute=await import("../app/api/skills/shares/[token]/route");
const shareRoute=await import("../app/api/skills/[id]/share/route");
const skillsRoute=await import("../app/api/skills/route");
const db=getDatabase();
for(const owner of ["alice","bob"]) {
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(owner,owner,"unused",new Date().toISOString());
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(createHash("sha256").update(owner+"-session").digest("hex"),owner,new Date(Date.now()+60000).toISOString());
}
function request(url:string,owner?:string,method="GET",body?:unknown){
  return new Request("https://metis.example"+url,{method,headers:{...(owner?{cookie:"ai_chat_auth="+owner+"-session"}:{}),...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
const files=[{path:"SKILL.md",content:"---\nname: My checklist\ndescription: A shared checklist\n---\n# Checklist\n- Review the change\n",encoding:"utf8" as const},{path:"references/checklist.md",content:"# Details\nKeep the useful evidence.",encoding:"utf8" as const}];
await t.test("personal skills stay account-scoped in APIs, prompts and file previews",async()=>{
  addPersonalSkill("alice","my-checklist",files);
  assert.equal(listInstalledSkills(getGlobalModelSettings("alice")).length,2);
  assert.equal(listInstalledSkills(getGlobalModelSettings("bob")).length,1);
  assert.match(skillsCatalogPrompt(getGlobalModelSettings("alice")),/my-checklist/);
  assert.doesNotMatch(skillsCatalogPrompt(getGlobalModelSettings("bob")),/my-checklist/);
  assert.equal(readSkillFile("my-checklist","references/checklist.md",getGlobalModelSettings("alice")).content,files[1].content);
  assert.throws(()=>readSkillFile("my-checklist","SKILL.md",getGlobalModelSettings("bob")),/not found/);
  saveGlobalModelSettings({skillOwnerId:"alice",alwaysOnSkills:{"my-checklist":true}},"bob");
  assert.doesNotMatch(alwaysOnSkillsPrompt(getGlobalModelSettings("bob")),/Checklist/);
  assert.match(alwaysOnSkillsPrompt({...getGlobalModelSettings("alice"),alwaysOnSkills:{"my-checklist":true}}),/Review the change/);
});
let token="";
await t.test("sharing snapshots a whole package without exposing owner ids or local paths",async()=>{
  token=createSkillShare("alice","my-checklist");
  assert.match(token,/^[a-f0-9]{48}$/);
  assert.equal(createSkillShare("alice","my-checklist"),token);
  const alias = await shareRoute.GET(new Request("http://lan-metis:3100/", {headers:{cookie:"ai_chat_auth=alice-session"}}), {params:Promise.resolve({id:"my-checklist"})});
  assert.deepEqual(await alias.json(), {token, url:"https://metis.example/skills/share/"+token});
  assert.throws(()=>createSkillShare("bob","my-checklist"),/own manual/);
  assert.throws(()=>createSkillShare("alice","builtin"),/own manual/);
  const response=await publicRoute.GET(request("/"),{params:Promise.resolve({token})});
  assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.signedIn,false);
  assert.deepEqual(body.skill.files,files);
  assert.equal(JSON.stringify(body).includes("owner_id"),false);
  assert.equal(JSON.stringify(body).includes(root),false);
  writeFileSync(path.resolve(root,listInstalledSkills(getGlobalModelSettings("alice"))[1].skillPath),"Changed later");
  assert.equal(getSharedSkill(token)?.files[0].content,files[0].content);
});
await t.test("import creates an independent copy and refuses overwrites and unauthenticated writes",async()=>{
  assert.equal((await publicRoute.POST(request("/",undefined,"POST",{id:"my-checklist"}),{params:Promise.resolve({token})})).status,401);
  const response=await publicRoute.POST(request("/","bob","POST",{id:"my-checklist"}),{params:Promise.resolve({token})});
  assert.equal(response.status,201);
  assert.equal(readSkillFile("my-checklist","references/checklist.md",getGlobalModelSettings("bob")).content,files[1].content);
  assert.throws(()=>importSharedSkill("bob",token,"my-checklist"),/already exists/);
  assert.throws(()=>importSharedSkill("bob",token,"builtin"),/already exists/);
});
await t.test("only the owner can revoke a link; existing imported copies remain",async()=>{
  await shareRoute.DELETE(request("/","bob","DELETE"),{params:Promise.resolve({id:"my-checklist"})});
  assert.ok(getSharedSkill(token));
  revokeSkillShare("alice","my-checklist");
  assert.equal(skillShareLink("alice","my-checklist"),null);
  assert.equal((await publicRoute.GET(request("/"),{params:Promise.resolve({token})})).status,404);
  assert.equal(readSkillFile("my-checklist","SKILL.md",getGlobalModelSettings("bob")).content,files[0].content);
});
await t.test("package validation rejects traversal, hidden files, bad encodings and size abuse",()=>{
  for(const relative of ["../outside.md","/etc/passwd","references/../../.env",".env","references//a.md","references/./a.md"])assert.throws(()=>validateSkillPackage([...files,{path:relative,content:"bad",encoding:"utf8"}]),/Invalid/);
  assert.throws(()=>validateSkillPackage([{path:"SKILL.md",content:"x".repeat(200001),encoding:"utf8"}]),/200 KB/);
  assert.throws(()=>validateSkillPackage([...files,{path:"image.png",content:"%%%bad",encoding:"base64"}]),/encoding/);
});
await t.test("manual text import accepts multipart content and blocks shared id collisions",async()=>{
  const form=new FormData();form.set("id","new-manual");form.set("content","# Imported manually");
  const response=await skillsRoute.POST(new Request("https://metis.example/api/skills",{method:"POST",headers:{cookie:"ai_chat_auth=bob-session"},body:form}));
  assert.equal(response.status,201);
  assert.equal(readSkillFile("new-manual","SKILL.md",getGlobalModelSettings("bob")).content,"# Imported manually");
  const overwrite=await skillsRoute.POST(request("/","bob","POST",{id:"builtin",content:"Changed"}));
  assert.equal(overwrite.status,400);
  assert.equal(readFileSync(path.join(root,"skills/builtin/SKILL.md"),"utf8"),"# Builtin");
});
await t.test("isolated agent identity reads its package without writing it or reading another account",{skip:process.platform!=="linux"||process.getuid?.()!==0},()=>{
  chmodSync(root,0o755);
  db.prepare("INSERT INTO user_workspace_access(user_id,workspace_root,uid,gid,created_at,updated_at) VALUES(?,?,?,?,?,?)").run("alice",root,65534,65534,"now","now");
  const own=addPersonalSkill("alice","agent-readable",files);
  const run=(command:string,args:string[])=>execFileSync("setpriv",["--reuid=65534","--regid=65534","--clear-groups",command,...args],{stdio:"pipe"});
  assert.equal(run("cat",[own.skillPath]).toString(),files[0].content);
  assert.throws(()=>run("cat",[listInstalledSkills(getGlobalModelSettings("bob")).find(skill=>skill.id==="my-checklist")!.skillPath]));
  assert.throws(()=>run("touch",[path.join(path.dirname(own.skillPath),"overwrite.md")]));
  const previousPath=process.env.PATH;
  try {
    process.env.PATH="/nonexistent";
    assert.throws(()=>addPersonalSkill("alice","failed-import",files));
  } finally {process.env.PATH=previousPath;}
  assert.equal(listInstalledSkills(getGlobalModelSettings("alice")).some(skill=>skill.id==="failed-import"),false);
  assert.equal(existsSync(path.join(path.dirname(path.dirname(own.skillPath)),"failed-import")),false);
});
t.after(()=>{db.close();rmSync(root,{recursive:true,force:true});});
});
