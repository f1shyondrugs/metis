import React from "react";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import postcss from "postcss";
import {renderToStaticMarkup} from "react-dom/server";
import {RichComposerInput} from "../components/rich-composer-input";
import {Input} from "../components/ui/input";
import {Button} from "../components/ui/button";

Object.assign(globalThis,{React});
const sheets = ["app/globals.css","components/notes/block-editor.css"].map(p=>postcss.parse(readFileSync(new URL("../"+p,import.meta.url),"utf8")));
function hoverGated(rule:postcss.Rule) {
  for(let p:postcss.Node|undefined=rule.parent;p;p=p.parent)
    if(p.type==="atrule" && (p as postcss.AtRule).name==="media" && /\(hover:\s*hover\)/.test((p as postcss.AtRule).params)) return true;
  return false;
}
test("chat composer exposes the send keyboard hint without replacing its native textarea",()=>{
  const html=renderToStaticMarkup(<RichComposerInput value={"  hello\nworld  "} onChange={()=>{}} aria-label="Message"/>);
  assert.match(html,/<textarea/);assert.match(html,/enterKeyHint="send"/i);
  assert.match(html,/  hello\nworld  <\/textarea>/);
});
test("existing email and decimal input semantics remain intact",()=>{
  const html=renderToStaticMarkup(<><Input type="email" autoComplete="email"/><Input type="number" inputMode="decimal" min="0" step="any"/></>);
  for(const attr of ['type="email"','autoComplete="email"','inputMode="decimal"','step="any"'])assert.ok(html.includes(attr),attr);
});
test("shared button has manipulation touch action and keeps focus/press feedback",()=>{
  const html=renderToStaticMarkup(<Button>Action</Button>);
  for(const token of ["touch-manipulation","focus-visible:ring-3","active:not-aria-[haspopup]:translate-y-px"])assert.ok(html.includes(token),token);
});
for(const [i,sheet] of sheets.entries())test("handwritten hover rules are capability-gated in stylesheet "+i,()=>{
  let count=0;sheet.walkRules(r=>{if(r.selector.includes(":hover")){count++;assert.ok(hoverGated(r),r.selector);}});
  assert.ok(count>0);
});
test("touch selected/active/focus states are not hidden behind hover capability",()=>{
  const expected=[".notes-selection-toolbar .is-active",".notes-context-toolbar button[aria-pressed=true]",".notes-block-menu>button.is-selected",".automation-sidebar-resize-handle:focus-visible > span",'.automation-editor-actions button[type="submit"]:active:not(:disabled)'];
  for(const selector of expected){let found=false;for(const sheet of sheets)sheet.walkRules(r=>{if(r.selectors.includes(selector)){found=true;assert.equal(hoverGated(r),false,selector);}});assert.ok(found,selector);}
});
