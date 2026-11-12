import test from "node:test";import assert from "node:assert/strict";import {tourPlacement} from "../lib/tour-placement";
test("walkthrough placement follows targets without overlap when space is available and stays within each viewport",()=>{
 for(const width of [390,768,1440])for(const target of [{left:24,top:100,width:60,height:40},{left:width*.5,top:700,width:width*.4,height:44}]){
  const card={width:Math.min(380,width-32),height:260},p=tourPlacement(target,card,{width,height:900});
  assert.ok(p.left>=16&&p.top>=16);assert.ok(p.left+card.width<=width-16);assert.ok(p.top+card.height<=884);
  const overlap=Math.max(0,Math.min(p.left+card.width,target.left+target.width)-Math.max(p.left,target.left))*Math.max(0,Math.min(p.top+card.height,target.top+target.height)-Math.max(p.top,target.top));assert.equal(overlap,0);
 }
});
test("completion centers even on small viewports and missing targets have a bounded fallback",()=>{
 for(const width of [390,768,1440]){const p=tourPlacement(null,{width:600,height:320},{width,height:900});assert.equal(p.left,(width-Math.min(600,width-32))/2);assert.equal(p.top,290);}
});
