import assert from "node:assert/strict";
import test from "node:test";
import { captureDesktopPreview, listDesktopMonitors, parseXrandrMonitors, windowsDesktopMonitorsCommand, windowsDesktopPreviewCommand, windowsDesktopPreviewScript } from "../remote-client/desktop-preview.mjs";
import { readFile, writeFile, stat } from "node:fs/promises";

test("Windows preview uses a bounded passive image and detects locked desktops", async () => {
  let called = false;
  const result = await captureDesktopPreview({ platform: "win32", run: async (command, args, options) => {
    called = true; assert.equal(command, "powershell.exe"); assert.equal(options.timeout, 15000);
    const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
    assert.equal(script, windowsDesktopPreviewScript);
    assert.match(script, /Unlocked/); assert.match(script, /Min\(1600/);
    assert.ok(!/SetForegroundWindow|SetCursorPos|SendInput|ActivateWindow/.test(script));
    return { stdout: '{"image_base64":"fixture","mimeType":"image/jpeg"}' };
  } });
  assert.ok(called); assert.equal(result.mimeType, "image/jpeg");
  assert.match(windowsDesktopPreviewCommand(), /^powershell.exe -NoProfile -NonInteractive -EncodedCommand /);
});

test("Linux preview captures root without focus, keyboard or mouse commands", async () => {
  const calls = [];
  const result = await captureDesktopPreview({ platform: "linux", env: { DISPLAY: ":1" },
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === "gdbus") return { stdout: "(false,)" };
      if (command === "xrandr") return { stdout: "Monitors: 1\n 0: +*eDP-1 1920/300x1080/170+0+0 eDP-1" };
      if (command === "import" && args.includes("jpeg:-")) return { stdout: Buffer.from("fixture") };
      return { stdout: "test" };
    } });
  assert.equal(result.image_base64, Buffer.from("fixture").toString("base64"));
  assert.ok(calls.some(([command, args]) => command === "import" && args.includes("root")));
  assert.ok(!calls.some(([, args]) => args.some(arg => /windowfocus|mousemove|click|keydown/.test(arg))));
});

test("Linux preview refuses Wayland and locked sessions without capturing", async () => {
  const failIfCalled = async () => { throw new Error("unexpected capture"); };
  await assert.rejects(captureDesktopPreview({ platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" }, run: failIfCalled }), /Wayland/);
  const calls = [];
  await assert.rejects(captureDesktopPreview({ platform: "linux", env: { DISPLAY: ":1" },
    run: async (command, args) => { calls.push([command, args]); return { stdout: command === "gdbus" ? "(true,)" : "test" }; } }), /locked/);
  assert.ok(!calls.some(([, args]) => args.includes("jpeg:-")));
});

test("X11 monitor discovery preserves actual names, primary flags, resolution and signed origins", () => {
  assert.deepEqual(parseXrandrMonitors("Monitors: 2\n 0: +*eDP-1 1920/300x1080/170+0+0 eDP-1\n 1: +HDMI-1 2560/600x1440/340-2560+0 HDMI-1"), [
    {id:"eDP-1",name:"eDP-1",width:1920,height:1080,x:0,y:0,primary:true},
    {id:"HDMI-1",name:"HDMI-1",width:2560,height:1440,x:-2560,y:0,primary:false},
  ]);
  assert.throws(()=>parseXrandrMonitors("Monitors: 0"), /No active monitors/);
});

function linuxCommands(calls, topology="Monitors: 2\n 0: +*eDP-1 1920/300x1080/170+0+0 eDP-1\n 1: +HDMI-1 2560/600x1440/340+1920+0 HDMI-1") {
 return async(command,args)=>{
  calls.push([command,args]);
  if(command==="gdbus")return{stdout:"(false,)"};
  if(command==="xrandr")return{stdout:topology};
  if(command==="import"&&args.includes("jpeg:-"))return{stdout:Buffer.from("selected-frame")};
  return{stdout:"test"};
 };
}
test("Linux captures the selected monitor rectangle and defaults to actual primary", async()=>{
 const calls=[],options={platform:"linux",env:{DISPLAY:":1"},run:linuxCommands(calls)};
 const inventory=await listDesktopMonitors(options);
 assert.equal(inventory.monitors.length,2);
 const selected=await captureDesktopPreview({...options,monitorId:"HDMI-1"});
 assert.equal(selected.monitorId,"HDMI-1");
 assert.deepEqual(calls.find(([c,args])=>c==="import"&&args.includes("jpeg:-"))[1],
  ["-window","root","-crop","2560x1440+1920+0","+repage","-resize","1600x1600>","jpeg:-"]);
 calls.length=0;
 assert.equal((await captureDesktopPreview(options)).monitorId,"eDP-1");
 assert.ok(!calls.some(([c,args])=>c==="wmctrl"&&args.includes("-ia")||args.includes("windowfocus")));
});
test("unknown and unplugged Linux monitors fail before capture instead of showing primary", async()=>{
 const calls=[],options={platform:"linux",env:{DISPLAY:":1"},run:linuxCommands(calls)};
 await assert.rejects(captureDesktopPreview({...options,monitorId:"missing"}),/monitor is unavailable/);
 assert.ok(!calls.some(([c,args])=>c==="import"&&args.includes("jpeg:-")));
 const removed={...options,run:linuxCommands(calls,"Monitors: 1\n 0: +*eDP-1 1920x1080+0+0 eDP-1")};
 await assert.rejects(captureDesktopPreview({...removed,monitorId:"HDMI-1"}),/monitor is unavailable/);
});
test("Linux reports unavailable xrandr without fabricating a monitor inventory",async()=>{
 const base=linuxCommands([]);
 await assert.rejects(listDesktopMonitors({platform:"linux",env:{DISPLAY:":1"},run:async(c,a)=>{
  if(c==="xrandr")throw new Error("ENOENT");return base(c,a);
 }}),/xrandr/);
});
test("Windows inventory and preview commands carry selected IDs as encoded data",async()=>{
 const target=String.raw`\\.\DISPLAY2'; throw 'not code`;
 const encoded=windowsDesktopPreviewCommand(target).split(" ").at(-1);
 const script=Buffer.from(encoded,"base64").toString("utf16le");
 assert.ok(!script.includes(target),"Monitor names must never become PowerShell source");
 const payload=script.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)[1];
 assert.deepEqual(JSON.parse(Buffer.from(payload,"base64").toString("utf8")),{monitorId:target});
 assert.match(script,/DeviceName -ceq \$selection.monitorId/);
 assert.match(script,/Selected monitor is unavailable/);
 const discovery=Buffer.from(windowsDesktopMonitorsCommand().split(" ").at(-1),"base64").toString("utf16le");
 assert.match(discovery,/AllScreens/);assert.match(discovery,/primary=\[bool\]\$_.Primary/);
 const result=await listDesktopMonitors({platform:"win32",run:async(c,args)=>{
  assert.equal(c,"powershell.exe");
  assert.equal(Buffer.from(args.at(-1),"base64").toString("utf16le"),discovery);
  return{stdout:JSON.stringify({monitors:[{id:"D2",name:"Monitor",x:-1920,y:0,width:1920,height:1080,primary:false}]})};
 }});
 assert.equal(result.monitors[0].x,-1920);
 const frame=await captureDesktopPreview({platform:"win32",monitorId:"D2",run:async()=>({stdout:'{"image_base64":"ok","monitorId":"D2"}'})});
 assert.equal(frame.monitorId,"D2");
 await assert.rejects(captureDesktopPreview({platform:"win32",monitorId:"D2",run:async()=>({stdout:'{"image_base64":"primary","monitorId":"D1"}'})}),/monitor is unavailable/);
});
test("macOS discovery and selected capture use native display bounds without activating windows",async()=>{
 const calls=[],monitors=[
  {id:"42",name:"Built-in display",x:0,y:0,width:1512,height:982,primary:true},
  {id:"77",name:"External display",x:-1920,y:0,width:1920,height:1080,primary:false},
 ];
 let captureFile;
 const run=async(command,args)=>{
  calls.push([command,args]);
  if(command==="/usr/sbin/screencapture"){
   assert.deepEqual(args.slice(0,-1),["-x","-R","-1920,0,1920,1080","-t","jpg"]);
   captureFile=args.at(-1);await writeFile(captureFile,"synthetic-mac-jpeg");return{stdout:""};
  }
  const p=JSON.parse(Buffer.from(args[0],"base64").toString("utf8"));
  return {stdout:JSON.stringify(p.operation==="status"?{available:true}:p.operation==="monitors"?{monitors}:{})};
 };
 assert.deepEqual(await listDesktopMonitors({platform:"darwin",run}),{monitors});
 const result=await captureDesktopPreview({platform:"darwin",monitorId:"77",run});
 assert.equal(result.monitorId,"77");
 assert.equal(Buffer.from(result.image_base64,"base64").toString(),"synthetic-mac-jpeg");
 await assert.rejects(stat(captureFile),/ENOENT/);
 assert.ok(!calls.some(([,args])=>args.some(arg=>/activate|windowfocus|mousemove/.test(arg))));
 await assert.rejects(captureDesktopPreview({platform:"darwin",monitorId:"removed",run}),/monitor is unavailable/);
});
test("invalid monitor IDs fail locally before any OS command",async()=>{
 for(const monitorId of ["",null,5,"x".repeat(201),"bad\nmonitor"]){
  await assert.rejects(captureDesktopPreview({platform:"win32",monitorId,run:async()=>{throw new Error("must not run")}}),/Invalid monitor ID/);
 }
});

test("native monitor sources ship unchanged in the public installer",async()=>{
 for(const [source,distribution]of [["computer-use.mjs","computer-use.mjs"],["desktop-preview.mjs","desktop-preview.mjs"],["desktop-preview-command.mjs","desktop-preview-command.mjs"],["metis-desktop-helper.swift","metis-desktop-helper.swift"]]){
  assert.deepEqual(await readFile(new URL("../remote-client/"+source,import.meta.url)),await readFile(new URL("../public/install/"+distribution,import.meta.url)),source+" must match installer");
 }
});

test("Linux normalizes negative virtual monitor origins into root-image crop coordinates",async()=>{
 const calls=[], options={platform:"linux",env:{DISPLAY:":1"},run:linuxCommands(calls,
  "Monitors: 2\n 0: +*eDP-1 1920x1080+0+0 eDP-1\n 1: +HDMI-1 2560x1440-2560-200 HDMI-1")};
 assert.equal((await captureDesktopPreview({...options,monitorId:"HDMI-1"})).monitorId,"HDMI-1");
 assert.equal(calls.find(([c,a])=>c==="import"&&a.includes("jpeg:-"))[1][3],"2560x1440+0+0");
 calls.length=0;
 assert.equal((await captureDesktopPreview({...options,monitorId:"eDP-1"})).monitorId,"eDP-1");
 assert.equal(calls.find(([c,a])=>c==="import"&&a.includes("jpeg:-"))[1][3],"1920x1080+2560+200");
});

test("Linux without xrandr retains the legacy default preview but never guesses an explicitly selected monitor",async()=>{
 const calls=[], base=linuxCommands(calls),options={platform:"linux",env:{DISPLAY:":1"},run:async(command,args)=>{
  if(command==="xrandr")throw new Error("ENOENT");
  return base(command,args);
 }};
 const frame=await captureDesktopPreview(options);
 assert.equal(frame.mimeType,"image/jpeg");
 assert.equal(frame.image_base64,Buffer.from("selected-frame").toString("base64"));
 assert.equal("monitorId" in frame,false,"A whole-root compatibility capture must not claim a physical monitor");
 assert.deepEqual(calls.find(([c,a])=>c==="import"&&a.includes("jpeg:-"))[1],
  ["-window","root","-resize","1600x1600>","jpeg:-"]);
 calls.length=0;
 await assert.rejects(captureDesktopPreview({...options,monitorId:"eDP-1"}),/xrandr/);
 assert.ok(!calls.some(([c,a])=>c==="import"&&a.includes("jpeg:-")));
 await assert.rejects(listDesktopMonitors(options),/xrandr/);
});
