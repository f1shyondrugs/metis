import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-custom-codex-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"test.sqlite"),AI_CHAT_SECRETS_KEY:"cd".repeat(32),CHAT_PASSWORD:"",METIS_AI_BOOTSTRAP_PASSWORD:""});
after(()=>rmSync(root,{recursive:true,force:true}));
const modules=Promise.all([import("../lib/providers/registry"),import("../lib/model-params"),import("../lib/providers/codex-context-config"),import("../lib/providers/discovery"),import("../lib/provider-connections"),import("../lib/auth"),import("../lib/context-window")]);

test("Codex CLI numeric contract survives discovery and storage without changing model capacity",async()=>{
 const [registry,params,config,discovery,connections,auth,context]=await modules;
 const owner=auth.createUser("context-owner","fixture-password").id;
 const connection=connections.upsertProviderConnection(owner,{providerKey:"codex",slug:"test-codex",label:"Test",authType:"api_key",secret:"fixture-key",enabled:true})!;
 discovery.persistDiscoveredModels(connection.id,[{id:"opaque-native-id",displayName:"Fixture",contextWindow:272000,contextWindowDiscovered:true,contextWindowSource:"provider",parameters:[{id:"effort",values:[{value:"high"}]}]}]);
 const model=discovery.providerModelsForConnection(connection).find(m=>m.id==="opaque-native-id")!;
 assert.equal(model.contextWindow,272000);
 const field=params.modelParametersForModel(model).find(p=>p.id==="context")!;
 assert.ok(field.customNumber);assert.deepEqual(field.values,[]);
 for(const value of ["1024","272000","1000000","2000000",String(Number.MAX_SAFE_INTEGER)]){
  assert.deepEqual(params.sanitizeModelParams(model,[{id:"context",value}]),[{id:"context",value}]);
  assert.equal(config.codexContextConfig(model,[{id:"context",value}]).model_context_window,Number(value));
  assert.equal(context.contextWindowForSelection(model,[{id:"context",value}]),Number(value));
 }
 assert.equal(field.customNumber.allowMagnitudeSuffix, true);
 for (const [value, canonical] of [["500k","500000"],[" 1.05M ","1050000"],["1.024 K","1024"],
   ["1.024000k","1024"],["1.000001m","1000001"],["9007199254.740991m",String(Number.MAX_SAFE_INTEGER)]]) {
  assert.deepEqual(params.sanitizeModelParams(model,[{id:"context",value}]),[{id:"context",value:canonical}]);
  assert.equal(config.codexContextConfig(model,[{id:"context",value}]).model_context_window,Number(canonical));
 }
 assert.equal(params.normalizeParameterValue({id:"other",values:[],customNumber:{min:1,max:10_000,step:1}},"2k"),undefined);
 for(const value of ["","-1","0","1023","1.5","1e6","Infinity","NaN","unlimited","9007199254740992","9007199254.740992m","1.023k","1.0241k","1.0000001m","1,05m","1.2","1e3k","500kk",'1000; shell=true']){
  assert.deepEqual(config.codexContextConfig(model,[{id:"context",value}]),{});
 }
 assert.deepEqual(config.codexContextConfig(model,[]),{});
 assert.deepEqual(config.codexContextConfig(undefined,[{id:"context",value:"1000000"}]),{});
 assert.deepEqual(params.sanitizeModelParams({id:"other",parameters:[]},[{id:"context",value:"1000000"}]),[]);
 assert.deepEqual(params.providerNativeParams(model,[{id:"context",value:"1000000"},{id:"effort",value:"high"}]),[{id:"effort",value:"high"}]);
 assert.deepEqual(params.defaultParamsForModel(model),[]);
 assert.equal(registry.getProviderDefinition("openai")?.configParameters,undefined);
 const stored=connections.listProviderModels(connection.id).find(m=>m.id===model.id)!;
 assert.equal(stored.contextWindow,272000);
 const {ensureAllModelAccess}=await import("../lib/model-access");
 ensureAllModelAccess(owner);
 const token=auth.authenticateUser("context-owner","fixture-password")!.token;
 const {GET}=await import("../app/api/models/route");
 const response=await GET(new Request("http://localhost/api/models",{headers:{cookie:"ai_chat_auth="+token}}));
 assert.equal(response.status,200);
 const body=await response.json();
 const apiModel=body.models.find((m:{connectionId?:string})=>m.connectionId===connection.id);
 assert.equal(apiModel?.parameters.find((p:{id:string;customNumber?:{allowMagnitudeSuffix?:boolean}})=>p.id==="context")?.customNumber?.allowMagnitudeSuffix,true);
});

test("SDK serializes numeric context and compaction overrides for new and resumed turns", {skip:process.platform==="win32"}, async()=>{
 const [registry,,,]=await modules;
 const {Codex}=await import("@openai/codex-sdk");
 const {codexContextConfig}=await import("../lib/providers/codex-context-config");
 const executable=path.join(root,"fake-codex"),capture=path.join(root,"argv.json");
 writeFileSync(executable,'#!/usr/bin/env node\nconst fs=require("node:fs");fs.writeFileSync(process.env.METIS_CONTEXT_CAPTURE,JSON.stringify(process.argv.slice(2)));process.stdin.resume();process.stdin.on("end",()=>{console.log(JSON.stringify({type:"thread.started",thread_id:"00000000-0000-0000-0000-000000000001"}));console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}));});\n');
 chmodSync(executable,0o700);
 const model={parameters:registry.getProviderDefinition("codex")!.configParameters};
 for(const resume of [false,true]){
  const config=codexContextConfig(model,[{id:"context",value:"1m"}]);
  assert.equal(config.model_auto_compact_token_limit,800000);
  const client=new Codex({codexPathOverride:executable,config,env:{...process.env as Record<string,string>,METIS_CONTEXT_CAPTURE:capture}});
  const options={model:"opaque-native-id",workingDirectory:root,skipGitRepoCheck:true};
  const thread=resume?client.resumeThread("00000000-0000-0000-0000-000000000001",options):client.startThread(options);
  await thread.run("fixture");
  const args=JSON.parse(readFileSync(capture,"utf8")) as string[];
  assert.ok(args.includes("model_context_window=1000000"));
  assert.ok(args.includes("model_auto_compact_token_limit=800000"));
  assert.equal(args.includes("resume"),resume);
 }
});
