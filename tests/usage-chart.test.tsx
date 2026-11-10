import assert from "node:assert/strict";
import test from "node:test";
import {usageChart} from "../lib/usage-chart";
import type {UsageDay} from "../lib/account-types";
const day=(requests=0,costUsd:number|null=null):UsageDay=>({date:"2026-11-01",requests,costUsd,costReports:costUsd===null?0:requests,inputTokens:0,outputTokens:0,tokens:0,tokenReports:0,inputReports:0,outputReports:0});
test("zero activity and explicitly reported zero costs produce a real zero series without changing totals",()=>{
 const source=[day(),day(3,0)],before=JSON.stringify(source),chart=usageChart(source,"costUsd","reported");
 assert.deepEqual(chart.data.map(row=>row.value),[0,0]);assert.equal(chart.metric,"costUsd");assert.equal(chart.allZero,true);assert.equal(JSON.stringify(source),before);assert.equal(source[0].costUsd,null);
});
test("fully unreported costs use an explicitly labeled actual request series",()=>{
 const chart=usageChart([day(),day(3),day(7)],"costUsd","reported");
 assert.equal(chart.metric,"requests");assert.deepEqual(chart.data.map(row=>row.value),[0,3,7]);assert.match(chart.note!,/Showing recorded requests/);
});
test("partial reported costs stay gaps and estimated/reported modes never borrow each other's values",()=>{
 const rows=[day(1,2),day(3),day()];
 assert.deepEqual(usageChart(rows,"costUsd","reported").data.map(row=>row.value),[2,null,0]);
 assert.equal(usageChart(rows,"costUsd","estimated").metric,"requests");
 assert.equal(usageChart([{...day(1),estimatedCostUsd:.4}],"costUsd","estimated").metric,"costUsd");
 assert.equal(usageChart(rows,"costUsd","hidden").data[0].value,null);
});
test("single reported point remains visible and token series keep their existing missing-data semantics",()=>{
 assert.equal(usageChart([day(1,2),day(1)],"costUsd","reported").singlePoint,true);
 assert.deepEqual(usageChart([day(1)],"cachedInputTokens","reported").data.map(row=>row.value),[null]);
});
test("fallback units and zero-baseline explanations stay explicit",()=>{
 const fallback=usageChart([day(2)],"costUsd","reported");assert.equal(fallback.label,"Recorded requests");assert.match(fallback.note!,/Cost data is unavailable/);
 const zero=usageChart([day()],"costUsd","reported");assert.match(zero.note!,/without recorded activity/);assert.equal(zero.data[0].value,0);
});
