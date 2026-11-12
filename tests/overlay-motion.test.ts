import assert from "node:assert/strict";
import test from "node:test";
import { interpolateOverlayItem, mixCurve, motionEase, overlayOpacity, snapshotCurve } from "../lib/overlay-motion";
import type { OverlayItem } from "../lib/desktop-overlay";

const box:OverlayItem={id:"box",type:"rect",x:10,y:20,width:100,height:50};
test("geometry interpolates from current paint and returns the exact immutable target",()=>{
  const target={...box,x:210,width:200,opacity:.4};
  const middle=interpolateOverlayItem(box,target,.5);
  assert.equal(middle.x,110);assert.equal(middle.width,150);assert.equal(middle.opacity,.7);
  assert.equal(box.x,10);
  assert.equal(interpolateOverlayItem(box,target,1),target);
  const retarget=interpolateOverlayItem(middle,{...target,x:310},.5);
  assert.equal(retarget.x,210);
});
test("opacity defaults remain semantic, not accidentally fully opaque dim/highlight",()=>{
  assert.equal(overlayOpacity({...box,type:"spotlight"}),.65);
  assert.equal(overlayOpacity({...box,type:"highlight"}),.25);
  assert.equal(overlayOpacity({...box,opacity:0}),0);
  assert.equal(interpolateOverlayItem({...box,type:"spotlight"},{...box,type:"spotlight",opacity:.2},.5).opacity,.42500000000000004);
});
test("holes open/close from their centers and finish without retained ghost holes",()=>{
  const before={...box,type:"spotlight" as const,holes:[{x:0,y:0,width:100,height:80,shape:"rect" as const}]};
  const after={...before,holes:[]};
  const mid=interpolateOverlayItem(before,after,.5).holes![0];
  assert.equal(mid.width,50);assert.equal(mid.x,25);
  assert.deepEqual(interpolateOverlayItem(before,after,1).holes,[]);
  assert.equal(interpolateOverlayItem(after,before,.5).holes![0].height,40);
});
test("path topology changes and type replacement never interpolate unrelated vertices",()=>{
  const before={...box,type:"path" as const,points:[{x:0,y:0},{x:10,y:10}]};
  const after={...before,points:[{x:20,y:0},{x:40,y:20}]};
  assert.deepEqual(interpolateOverlayItem(before,after,.5).points,[{x:10,y:0},{x:25,y:15}]);
  const different={...after,points:[...after.points,{x:60,y:0}]};
  assert.deepEqual(interpolateOverlayItem(before,different,.5).points,different.points);
  assert.equal(interpolateOverlayItem(box,{...box,type:"ellipse"},.5).type,"ellipse");
});
test("motion easing is bounded, monotone and completes exactly",()=>{
  assert.equal(motionEase(-1),0);assert.equal(motionEase(2),1);
  let previous=0;
  for(let i=0;i<=100;i++){const t=motionEase(i/100);assert.ok(t>=previous&&t<=1);previous=t;}
});
test("curve snapshots are bounded and detached from interrupted evaluator lifetimes",()=>{
  let multiplier=1,calls=0;
  const frozen=snapshotCurve(x=>{calls++;return multiplier*x;},-4,4);
  assert.equal(calls,513);multiplier=8;
  assert.equal(frozen(2),2);assert.equal(frozen(-2),-2);
  for(let i=0;i<1000;i++)frozen(1.234);
  assert.equal(calls,513);
  assert.equal(mixCurve(frozen(2),8,.5),5);
});
test("curve morph never bridges nonfinite regions, and final target stays exact",()=>{
  assert.ok(Number.isNaN(mixCurve(Infinity,2,.5)));
  assert.ok(Number.isNaN(mixCurve(2,NaN,.5)));
  assert.equal(mixCurve(NaN,2,1),2);
  const frozen=snapshotCurve(x=>x===0?NaN:1/x,-1,1);
  assert.ok(Number.isNaN(frozen(0)));
  assert.ok(Number.isNaN(frozen(.001)));
});
