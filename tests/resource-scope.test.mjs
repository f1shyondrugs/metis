import assert from "node:assert/strict";
import test from "node:test";
import {spawn, execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resourceScopePlan, signalResourceScope} from "../lib/mcp-core/resource-scope.mjs";

const options={cwd:"/tmp",env:{PATH:"/usr/bin:/bin",SYNTHETIC_VALUE:"test-only"},stdio:["pipe","pipe","pipe"]};
const fixture={platform:"linux",systemd:true,uid:0,config:{},memory:32*1024**3,id:"synthetic"};

test("Linux systemd children receive unique bounded scopes without environment serialization",()=>{
 const p=resourceScopePlan("bash",["-lc","printf test"],options,10,fixture);
 assert.equal(p.command,"/usr/bin/systemd-run");
 assert.ok(p.args.includes("--scope"));
 assert.ok(p.args.includes("--property=MemoryMax=8192M"));
 assert.ok(p.args.includes("--property=CPUQuota=200%"));
 assert.ok(p.args.includes("--property=TasksMax=512"));
 assert.ok(p.args.includes("--property=RuntimeMaxSec=10s"));
 assert.deepEqual(p.args.slice(-4),["--","bash","-lc","printf test"]);
 assert.deepEqual(p.options,options);
 assert.ok(!p.args.join(" ").includes("test-only"));
 assert.notEqual(resourceScopePlan("true",[],options,10).unit,resourceScopePlan("true",[],options,10).unit);
});
test("mapped identity is dropped by scope launcher before executing untrusted code",()=>{
 const p=resourceScopePlan("id",[],{...options,uid:65534,gid:65534},10,fixture);
 assert.ok(p.args.includes("--uid=65534"));assert.ok(p.args.includes("--gid=65534"));
 assert.equal(p.options.uid,undefined);assert.equal(p.options.gid,undefined);
});
test("user manager cannot execute as a different OS identity",()=>{
 const p=resourceScopePlan("id",[],options,10,{...fixture,uid:1000});
 assert.equal(p.args[0],"--user");assert.equal(p.options.env.XDG_RUNTIME_DIR,"/run/user/1000");
 assert.throws(()=>resourceScopePlan("id",[],{...options,uid:0},10,{...fixture,uid:1000}),/different OS identity/);
});
test("non-systemd platforms retain existing direct execution",()=>{
 for(const f of [{...fixture,platform:"darwin"},{...fixture,platform:"win32"},{...fixture,systemd:false}]){
  assert.deepEqual(resourceScopePlan("test",["arg"],options,10,f),{command:"test",args:["arg"],options,unit:null});
 }
});
test("limits are validated; manager failure has no native fallback",()=>{
 for(const config of [{METIS_TOOL_MEMORY_MAX_MB:"0"},{METIS_TOOL_CPU_QUOTA_PERCENT:"infinity"},{METIS_TOOL_TASKS_MAX:"1"},{METIS_TOOL_MEMORY_MAX_MB:"8G;id"}]){
  assert.throws(()=>resourceScopePlan("true",[],options,10,{...fixture,config}),/Invalid/);
 }
 assert.throws(()=>resourceScopePlan("true",[],options,10,{...fixture,id:"x;id"}),/Invalid/);
});
test("cleanup targets only the generated scope and preserves manager selection",()=>{
 const p=resourceScopePlan("true",[],options,10,{...fixture,uid:1000});
 let captured;
 signalResourceScope(p,"SIGKILL",(cmd,args,opts)=>{captured={cmd,args,opts};return{on(){},unref(){}};});
 assert.deepEqual(captured.args,["--user","--no-ask-password","kill","--signal=SIGKILL","--kill-who=all","metis-tool-synthetic.scope"]);
});

const real=process.env.METIS_TEST_SYSTEMD_SCOPES==="1";
function run(command,args=[],overrides={},input=""){
 const plan=resourceScopePlan(command,args,{...options,...overrides},15);
 return new Promise(resolve=>{
  const child=spawn(plan.command,plan.args,plan.options);let stdout="",stderr="";
  child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
  child.stdout.on("data",v=>stdout+=v);child.stderr.on("data",v=>stderr+=v);
  child.on("error",e=>resolve({code:-1,stdout,stderr:String(e),plan}));
  child.on("close",(code,signal)=>{signalResourceScope(plan,"SIGKILL");resolve({code,signal,stdout,stderr,plan});});
  child.stdin.on("error",()=>{});child.stdin.end(input);
 });
}
test("real scope preserves cwd, stdin, environment, namespace and nonzero exits",{skip:!real},async()=>{
 const mount=readFileSync("/proc/self/mountinfo","utf8");
 const r=await run("/bin/sh",["-c",'pwd; printf "%s\\n" "$SYNTHETIC_VALUE"; cat /proc/self/cgroup; cat /proc/self/mountinfo >&2; cat; exit 7'],{},"UNICODE-ä-輸入");
 assert.equal(r.code,7);assert.match(r.stdout,/^\/tmp\ntest-only\n/);
 assert.ok(r.stdout.includes("/"+r.plan.unit));assert.match(r.stdout,/UNICODE-ä-輸入/);
 assert.equal(r.stderr,mount,"scope must preserve existing filesystem sandbox");
});
test("real scope drops root supplementary groups for mapped users",{skip:!real||process.getuid?.()!==0},async()=>{
 const r=await run("/usr/bin/id",[],{uid:65534,gid:65534});
 assert.equal(r.code,0,r.stderr);assert.match(r.stdout,/uid=65534/);assert.doesNotMatch(r.stdout,/groups=.*\b0\(root\)/);
});
test("bounded scope OOM does not kill the test parent and later calls still succeed",{skip:!real,timeout:30000},async()=>{
 const p=resourceScopePlan(process.execPath,["-e","const x=[]; setInterval(()=>{ const b=Buffer.alloc(8*1024*1024,1); x.push(b); },5)"],options,15,
  {config:{METIS_TOOL_MEMORY_MAX_MB:"96"}});
 const result=await new Promise(resolve=>{
  const child=spawn(p.command,p.args,p.options);
  child.stdin.end();child.stdout.resume();child.stderr.resume();
  child.on("close",(code,signal)=>{signalResourceScope(p,"SIGKILL");resolve({code,signal});});
 });
 assert.ok(result.code!==0||result.signal,"memory hog must fail");
 const next=await run("/bin/echo",["AFTER_OOM_OK"]);assert.equal(next.code,0,next.stderr);
 assert.equal(next.stdout.trim(),"AFTER_OOM_OK");
});
