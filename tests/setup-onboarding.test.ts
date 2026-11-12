import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,readFileSync} from "node:fs";
import os from "node:os";import path from "node:path";
import {resolveSetupStep} from "../lib/setup-step";
const root=path.join(import.meta.dirname,".."),data=mkdtempSync(path.join(os.tmpdir(),"metis-onboard-"));
Object.assign(process.env,{CHAT_DATA_DIR:data,CHAT_DB_PATH:path.join(data,"test.sqlite"),AGENT_CWD:data,AI_CHAT_ROOT:data,CHAT_PASSWORD:"must-not-become-a-user"});
delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;
const file=(name:string)=>readFileSync(path.join(root,name),"utf8");

test("admin-only setup keeps the existing protected bootstrap and completion contracts",()=>{
 const api=file("app/api/setup/route.ts"),wizard=file("components/setup-wizard.tsx"),helper=file("lib/setup.ts");
 assert.match(api,/bootstrapSetupAccount/);assert.match(api,/markSetupComplete/);
 for(const text of ["Create your admin account","Operator setup token","data/setup-token","AI_CHAT_SETUP_TOKEN",'action: "bootstrap", setupToken','action: "complete"','setSetupToken("")'])assert(wizard.includes(text),text);
 assert(helper.includes("setup_complete"));
 assert.doesNotMatch(wizard,/ProviderSetupDialog|OsUserField|makeAdmin|addPerson/);
 assert(!wizard.includes("/api/admin/users"));
});
test("legacy progress cannot restore removed user/provider setup screens",()=>{
 for(const saved of [undefined,null,"welcome","people","provider","ready","admin","complete","invalid"]){
  assert.equal(resolveSetupStep(false,saved),"admin");assert.equal(resolveSetupStep(true,saved),"complete");
 }
});
test("onboarding keeps the shared stage and provider access inside the ordinary UI",()=>{
 const wizard=file("components/setup-wizard.tsx"),stage=file("components/onboarding-stage.tsx"),shell=file("components/app-shell.tsx");
 assert.match(wizard,/OnboardingStage/);assert.match(stage,/mountOnboardingMotion/);
 assert.doesNotMatch(wizard,/ProviderSetupDialog/);
 assert(shell.includes("open={providerSetupOpen}"));assert(shell.includes("setProviderSetupOpen(true)"));
});
test("empty-instance onboarding remains before sign-in and legacy installs still bypass first-run",()=>{
 const shell=file("components/app-shell.tsx"),status=file("app/api/status/route.ts");
 const start=shell.indexOf("setupStatus?.needed && !setupStatus.hasUsers");
 assert(start>=0&&shell.indexOf("if (!authed)",start)>start);
 assert(shell.includes("setupStatus.needed && authed"));assert(status.includes("setup: getSetupStatus"));
 assert(file("lib/setup.ts").includes("return userCount() > 0"));
});
test("CHAT_PASSWORD does not seed an admin or replace operator verification",async()=>{
 assert(!file("install/linux.sh").includes("CHAT_PASSWORD"));
 const {getDatabase}=await import("../lib/sqlite"),{getSetupStatus}=await import("../lib/setup");
 assert.equal(Number((getDatabase().prepare("SELECT COUNT(*) AS n FROM users").get() as {n:number}).n),0);
 assert.equal(getSetupStatus().needed,true);
});
