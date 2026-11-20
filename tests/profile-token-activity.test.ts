import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import type {UsageDay} from "../lib/account-types";
import {publicTokenActivity,tokenActivityDate,tokenActivityDetails} from "../lib/profile-token-activity";
const day:UsageDay={date:"2026-10-11",requests:3,tokens:15800000,inputTokens:15200000,outputTokens:600000,
 tokenReports:3,inputReports:3,outputReports:3,costUsd:25,costReports:3,
 uncachedInputTokens:2000000,uncachedInputReports:3,cachedInputTokens:13000000,cachedInputReports:3,
 cacheWriteInputTokens:200000,cacheWriteInputReports:3,unclassifiedInputTokens:0,unclassifiedInputReports:3};
test("private details reuse the split and distinguish measured zero",()=>{
 const detail=tokenActivityDetails(day,day);
 assert.equal(detail.date,"Sunday, Oct 11, 2026");assert.equal(detail.total,15800000);assert.equal(detail.requests,3);
 assert.deepEqual(detail.rows.map(row=>[row.label,row.value]),[["Input (uncached)",2000000],["Cached input",13000000],["Cache write",200000],["Output",600000],["Unclassified input",0]]);
 assert.equal(detail.partial,false);
});
test("missing totals/cache stay unknown and partial reporting stays explicit",()=>{
 const missing={...day,tokenReports:0,cachedInputReports:0,cacheWriteInputReports:0};
 const d=tokenActivityDetails(missing,missing);assert.equal(d.total,null);assert.equal(d.rows[1].value,null);assert.equal(d.rows[2].value,null);
 const partial={...day,tokenReports:2,cachedInputReports:1};
 const p=tokenActivityDetails(partial,partial);assert.equal(p.partial,true);assert.equal(p.tokenReports,2);assert.equal(p.rows[1].reports,1);
});
test("a genuinely empty day has zero values rather than unreported activity",()=>{
 const empty={...day,requests:0,tokens:0,inputTokens:0,outputTokens:0,tokenReports:0,inputReports:0,outputReports:0};
 const d=tokenActivityDetails(empty,empty);assert.equal(d.total,0);assert.equal(d.requests,0);assert.ok(d.rows.every(row=>row.value===0));
});
test("public data and public tooltip contain only date and daily token total",()=>{
 const safe=publicTokenActivity([day]);
 assert.deepEqual(safe,[{date:"2026-10-11",tokens:15800000}]);
 const detail=tokenActivityDetails(safe[0]);assert.deepEqual(detail.rows,[]);assert.equal(detail.requests,undefined);assert.equal(detail.tokenReports,undefined);
});
test("UTC formatting is stable across timezones and invalid inputs stay displayable",()=>{
 const previous=process.env.TZ;try{process.env.TZ="America/Los_Angeles";assert.equal(tokenActivityDate("2026-01-01"),"Thursday, Jan 1, 2026");assert.equal(tokenActivityDate("invalid"),"invalid");}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test("actual shared-profile page serializes only its allowed daily fields",async()=>{
 const code=readFileSync(new URL("../app/p/[shareId]/page.tsx",import.meta.url),"utf8");
 const tree=ts.createSourceFile("page.tsx",code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="SharedProfilePage")!;
 const expression=fn.getText(tree).replace("export default async function","async function");
 const js=ts.transpileModule("const page="+expression,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const stub=()=>null,heatmap=()=>null;
 const scope={
  require:createRequire(import.meta.url),
  getSharedProfile:()=>({profile:{shareActivity:true,displayName:"Fixture",links:[],bio:"",avatar:null,handle:null},ownerId:"private-owner"}),
  getAccountUsage:()=>({days:[day]}),publicTokenActivity,
  notFound:()=>{throw new Error("Not found");},
  ProfileAvatar:stub,BannerHeader:stub,TokenHeatmap:heatmap,Link:stub,ExternalLink:stub,
 };
 const page=new Function(...Object.keys(scope),"const exports={};"+js+";return page;")(...Object.values(scope));
 const result=await page({params:Promise.resolve({shareId:"fixture"})});
 let props:Record<string,unknown>|undefined;
 function walk(node:unknown){if(!node||typeof node!=="object")return;if(Array.isArray(node)){node.forEach(walk);return;}const item=node as {type:unknown;props?:Record<string,unknown>};if(item.type===heatmap)props=item.props;else walk(item.props?.children);}
 walk(result);assert.ok(props);assert.deepEqual(props.days,[{date:day.date,tokens:day.tokens}]);assert.equal(props.detailDays,undefined);
});
