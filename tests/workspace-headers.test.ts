import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import vm from "node:vm";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {workspaceHeadersSource} from "./workspace-headers-harness.mjs";
const require=createRequire(import.meta.url);
const {buildSync}=createRequire(require.resolve("tsx"))("esbuild");
const result=buildSync({stdin:{contents:workspaceHeadersSource(),loader:"tsx",resolveDir:process.cwd()},bundle:true,platform:"node",format:"cjs",jsx:"automatic",external:["react","react-dom","react/*"],write:false});
const cjsModule={exports:{} as Record<string,React.ComponentType<Record<string,unknown>>>};
vm.runInNewContext(result.outputFiles[0].text,{exports:cjsModule.exports,module:cjsModule,require,console});
const exports=cjsModule.exports;
function render(name:string,props:Record<string,unknown>){return renderToStaticMarkup(React.createElement(exports[name],props));}
test("every account destination names the current page beside an icon-only accessible back button",()=>{
 for(const [view,title] of Object.entries({profile:"Profile","agent-hub":"Agent Hub",settings:"Settings",usage:"Usage",notifications:"Notifications"})){
  const html=render("AccountHeader",{view});
  assert.ok(html.includes(">"+title+"</h1>"),title);
  assert.match(html,/aria-label="Back to chat" title="Back to chat"/);
  assert.ok(!html.includes(">Back to chat<"));
  assert.ok(html.includes('type="button"'));
  assert.ok(html.includes("md:h-12"));
 }
});
test("Calendar, Notebooks and Automations show their titles without inserting another header row",()=>{
 for(const [component,props,title] of [["CalendarHeader",{},"Calendar"],["PrimaryHeader",{section:"notes"},"Notebooks"],["PrimaryHeader",{section:"automations"},"Automations"]] as const){
  const html=render(component,props);
  assert.ok(html.includes(">"+title+"</h1>")||html.includes(">\n              "+title),title);
  assert.equal((html.match(/<header/g)||[]).length,1);
  assert.ok(html.includes('aria-label="Open sidebar"'));
  assert.ok(html.includes('aria-label="Hide sidebar"'));
  assert.ok(!html.includes('aria-label="Back to chat"'),"primary workspaces keep their sidebar navigation");
 }
});
test("primary project header keeps its existing project name and truncation",()=>{
 const html=render("PrimaryHeader",{section:"project"});
 assert.ok(html.includes("A very long project name"));
 assert.ok(html.includes("text-ellipsis"));
});
