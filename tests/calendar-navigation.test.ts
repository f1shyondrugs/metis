import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {METIS_SHARED_AGENT_CONTROL} from "../lib/agent-control";
const source=fs.readFileSync(new URL("../components/app-shell.tsx",import.meta.url),"utf8");
const file=ts.createSourceFile("app-shell.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let open="",close="",effect="";
function visit(n:ts.Node){
 if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(file)==="button"&&n.openingElement.getText(file).includes('navigateChat("calendar")')){
  const a=n.openingElement.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(file)==="onClick") as ts.JsxAttribute;open=(a.initializer as ts.JsxExpression).expression!.getText(file);
 }
 if(ts.isJsxOpeningElement(n)&&n.tagName.getText(file)==="AccountPanel"){
  const a=n.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(file)==="onClose") as ts.JsxAttribute;close=(a.initializer as ts.JsxExpression).expression!.getText(file);
 }
 if(ts.isCallExpression(n)&&n.expression.getText(file)==="useEffect"&&n.arguments[0]?.getText(file).includes("const routeProjectId = parseProjectRouteId(routeChatId)"))effect=n.arguments[0].getText(file);
 ts.forEachChild(n,visit);
}visit(file);
test("actual sidebar calendar callback, route reconciliation and Back preserve active chat",()=>{
 assert.ok(open&&close&&effect);
 const code=ts.transpileModule(`(()=>{
 let url=new URL('http://fixture/?c=original-chat'),routeChatId='original-chat',routeView=null,accountView=null;
 const state={notesOpen:true,automationsOpen:true,workspaceOpen:true,mobileNavOpen:true};
 const activeChatIdRef={current:'original-chat'},authed=true,activeChatIncognito=false,suppressNotesRouteRef={current:false},draftProjectIdRef={current:null};
 const window={get location(){return url;}};
 const setAccountView=v=>{accountView=v;},setNotesOpen=v=>{state.notesOpen=v;},setAutomationsOpen=v=>{state.automationsOpen=v;},setWorkspaceOpen=v=>{state.workspaceOpen=v;},setMobileNavOpen=v=>{state.mobileNavOpen=v;};
 const persistActiveSnapshot=()=>{},parseProjectRouteId=()=>null,setActiveChatId=()=>{throw Error('Calendar must not switch the active chat');};
 const navigateChat=id=>{url=new URL('http://fixture/?c='+id);};
 const enter=${open},back=${close},apply=${effect};
 enter();routeChatId=url.searchParams.get('c');apply();
 const entered={...state,accountView,chat:activeChatIdRef.current,url:url.search};back();
 return {entered,accountView,back:url.search};
 })()`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const result=vm.runInNewContext(code,{URL,URLSearchParams});
 assert.equal(result.entered.accountView,"calendar");assert.equal(result.entered.chat,"original-chat");assert.equal(result.entered.url,"?c=calendar");
 for(const key of ["notesOpen","automationsOpen","workspaceOpen","mobileNavOpen"])assert.equal(result.entered[key],false);
 assert.equal(result.back,"?c=original-chat");assert.equal(result.accountView,null);
});
test("sidebar order and shared native calendar policy are consistent",()=>{
 assert.ok(source.indexOf(">Notebooks</span>")<source.indexOf("<CalendarClock"));assert.ok(source.indexOf("<CalendarClock")<source.indexOf(">Automations</span>"));
 assert.ok(METIS_SHARED_AGENT_CONTROL.includes("Native calendar:"));assert.ok(METIS_SHARED_AGENT_CONTROL.includes("not proof that remote synchronization finished"));
});
