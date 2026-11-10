import assert from "node:assert/strict";
import test from "node:test";
import { createCpuSampler } from "../lib/server-cpu";
const stat=(user:number,idle:number,cores=[`cpu0 ${user} 0 0 ${idle} 0 0 0 0`],guest=0)=>[`cpu ${user} 0 0 ${idle} 0 0 0 0 ${guest} 0`,...cores,"intr 123"].join("\n");

test("logical CPU intervals start unknown and guest counters are not counted twice",()=>{
 const sample=createCpuSampler();
 assert.deepEqual(sample(stat(100,900,undefined,50)),{cpuPercent:0,cpuCores:[{id:0,percent:null}]});
 const next=sample(stat(150,950,undefined,75));
 assert.equal(next.cpuPercent,50);assert.deepEqual(next.cpuCores,[{id:0,percent:50}]);
});
test("each logical CPU has its own baseline, including noncontiguous and reordered IDs",()=>{
 const sample=createCpuSampler();
 sample(stat(100,900,["cpu7 0 0 0 100","cpu0 0 0 0 100"]));
 const next=sample(stat(150,950,["cpu0 100 0 0 100","cpu7 0 0 0 200"]));
 assert.deepEqual(next.cpuCores,[{id:0,percent:100},{id:7,percent:0}]);
});
test("CPU hotplug, disappearance, counter reset and unchanged counters do not invent utilization",()=>{
 const sample=createCpuSampler();
 sample(stat(100,900,["cpu0 100 0 0 900"]));
 assert.deepEqual(sample(stat(200,1000,["cpu0 100 0 0 900","cpu2 10 0 0 10"])).cpuCores,[{id:0,percent:null},{id:2,percent:null}]);
 assert.deepEqual(sample(stat(210,1010,["cpu2 5 0 0 5"])).cpuCores,[{id:2,percent:null}]);
 assert.deepEqual(sample(stat(220,1020,["cpu0 200 0 0 1000","cpu2 15 0 0 15"])).cpuCores,[{id:0,percent:null},{id:2,percent:50}]);
});
test("iowait is idle; a decreasing idle counter is unavailable for that interval",()=>{
 const sample=createCpuSampler();
 sample("cpu 0 0 0 100 100\ncpu0 0 0 0 100 100");
 assert.equal(sample("cpu 50 0 0 125 125\ncpu0 50 0 0 125 125").cpuCores[0].percent,50);
 assert.equal(sample("cpu 200 0 0 100 100\ncpu0 200 0 0 100 100").cpuCores[0].percent,null);
});
test("missing aggregate counters fail sampling without advancing the last valid baseline",()=>{
 const sample=createCpuSampler();sample(stat(100,900));
 assert.throws(()=>sample("cpu bad counters\ncpu0 200 0 0 900"),/unavailable/);
 assert.equal(sample(stat(200,900)).cpuCores[0].percent,100);
});
