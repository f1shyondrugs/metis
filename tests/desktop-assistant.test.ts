import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsSearchEntries, visibleSettingsTabs } from "../lib/settings-navigation";
import { desktopCaptureContext, type DesktopCapture } from "../lib/desktop-assistant";
test("local settings remain absent on the web and searchable in desktop for both roles",()=>{
  for(const admin of [true,false]){
    assert.ok(!visibleSettingsTabs(admin).some(tab=>tab.value==="remote-client"));
    assert.ok(!settingsSearchEntries(admin).some(tab=>tab.tab==="remote-client"));
    assert.equal(visibleSettingsTabs(admin,true).filter(tab=>tab.value==="remote-client").length,1);
    assert.equal(settingsSearchEntries(admin,true).filter(tab=>tab.tab==="remote-client").length,1);
  }
});
test("screen context preserves origin, negative monitor coordinates and image ordering without duplicating pixels",()=>{
  const capture:DesktopCapture={device:{clientId:"fixture-id",hostname:"Fixture PC",platform:"win32",version:"1.5.3"},capturedAt:"2026-11-10T20:00:00Z",monitors:[
    {id:"left",name:"Left",primary:false,bounds:{x:-1920,y:0,width:1920,height:1080},scaleFactor:1,image:"data:image/png;base64,secret-pixels"},
    {id:"main",name:"Main",primary:true,bounds:{x:0,y:0,width:2560,height:1440},scaleFactor:1.5,image:"data:image/png;base64,more-pixels"}
  ]};
  const context=desktopCaptureContext(capture);
  assert.ok(context.includes('"clientId":"fixture-id"'));
  const monitors=context.split("\n").filter(line=>line.startsWith('{"image":')).map(line=>JSON.parse(line));
  assert.deepEqual(monitors.map(item=>[item.image,item.id,item.bounds.x,item.scaleFactor]),[[1,"left",-1920,1],[2,"main",0,1.5]]);
  assert.ok(!context.includes("secret-pixels"));
  assert.ok(context.includes("untrusted observations"));
});
