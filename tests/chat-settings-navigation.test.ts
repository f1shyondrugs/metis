import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {createChatModelSettingsQueue} from "../lib/chat-model-settings";
import type {ModelParamSelection} from "../lib/model-params";
const source=ts.createSourceFile("app-shell.tsx",readFileSync("components/app-shell.tsx","utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let snapshot:ts.VariableDeclaration|undefined;
function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==="applySnapshot")snapshot=node;ts.forEachChild(node,visit);}visit(source);assert.ok(snapshot);
const js=ts.transpileModule("const "+snapshot.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const high=[{id:"effort",value:"high"},{id:"context",value:"128k"},{id:"fast",value:"false"}];
const ultra=[{id:"effort",value:"ultra"},{id:"context",value:"256k"},{id:"fast",value:"true"}];
function fixture(){
 let resolveWrite!:(selection:{modelId:string;modelParams:ModelParamSelection[]})=>void;
 const queue=createChatModelSettingsQueue(()=>new Promise(resolve=>{resolveWrite=resolve;}));
 const state={modelId:"",modelParams:[] as ModelParamSelection[]};
 const context:Record<string,any>={Boolean,Math,localStorage:{setItem:()=>{}},window:{},useCallback:(fn:unknown)=>fn,acceptServerSnapshot:()=>true,loadedChatIdsRef:{current:new Set()},renderedActivityRef:{current:new Map()},seenChatUpdatedAtRef:{current:new Map()},chatModelSettingsRef:{current:queue},activeChatIdRef:{current:null},stateRef:{current:state},modelParamsByModel:{fixture:ultra},normalizeBrowserContext:()=>({tabs:[{id:"browser",url:""}],activeTabId:"browser"}),clearUnread:()=>{},normalizeRuntimeMode:(value:unknown)=>value,normalizeWorkspaceTab:()=> "canvas",workspaceOpenFromSession:Boolean,normalizeTerminalTabs:()=>[{id:"terminal",cwd:"/fixture"}],normalizeWorkDirectory:()=>"/fixture",workspaceDefaultCwd:"/fixture",composerPersistChatRef:{current:null},composerDirtyUntilRef:{current:0},inputUpdatedAtRef:{current:""},shouldAcceptRemoteComposerInput:()=>true,removedIdsFor:()=>new Set(),mergeQueuedFollowUps:()=>[],removedQueueIdsRef:{current:new Map()},runtimeRef:{current:new Map()},pendingQuestionIdRef:{current:null},restoreQuestionDraft:()=>({answers:[],custom:[],customActive:[]}),MODE_STORAGE_KEY:"mode",RUNTIME_MODE_STORAGE_KEY:"runtime",setModelId:(id:string)=>{state.modelId=id;},setModelParams:(params:ModelParamSelection[])=>{state.modelParams=params;}};
 function setters(node:ts.Node){if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&/^set[A-Z]/.test(node.expression.text)&&!(node.expression.text in context))context[node.expression.text]=()=>{};ts.forEachChild(node,setters);}setters(snapshot!);
 const apply=vm.runInNewContext(js+";applySnapshot",context) as (id:string,snapshot:unknown,source?:string)=>void;
 const saved=(modelParams:ModelParamSelection[])=>({modelId:"fixture",modelParams,messages:[],chatTitle:"Fixture",workspaces:[],queuedMessages:[],messageOffset:0,hasEarlierMessages:false});
 return{apply,saved,state,context,queue,resolveWrite:(selection:{modelId:string;modelParams:ModelParamSelection[]})=>resolveWrite(selection)};
}
test("the real snapshot callback restores chat-specific effort,context andfast before global presets",()=>{
 const f=fixture();f.apply("A",f.saved(high));assert.deepEqual(f.state.modelParams,high);
 f.apply("B",f.saved(ultra));assert.deepEqual(f.state.modelParams,ultra);
 f.context.modelParamsByModel.fixture=[{id:"effort",value:"another-global-preset"}];
 f.apply("A",f.saved(high),"cache");assert.deepEqual(f.state.modelParams,high);assert.equal(f.state.modelId,"fixture");
 f.apply("A",f.saved([]));assert.deepEqual(f.state.modelParams,[]);
});
test("returning through the actual snapshot callback while saving keeps the latest target-chat intent",async()=>{
 const f=fixture();f.apply("A",f.saved(high));
 const saving=f.queue.save("A",{modelId:"fixture",modelParams:ultra},{modelId:"fixture",modelParams:high});
 f.apply("B",f.saved(high));assert.deepEqual(f.state.modelParams,high);
 f.apply("A",f.saved(high),"cache");assert.deepEqual(f.state.modelParams,ultra);
 f.resolveWrite({modelId:"fixture",modelParams:ultra});await saving;
 f.apply("A",f.saved(ultra));assert.deepEqual(f.state.modelParams,ultra);
});
