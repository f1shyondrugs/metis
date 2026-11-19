import assert from 'node:assert/strict';
import test from 'node:test';
import { PROVIDERS } from '../lib/providers/registry';
import type { ProviderConnection, ProviderDefinition, ProviderModel } from '../lib/providers/types';
import { ACCEPTANCE_CHECKS, buildAcceptanceMatrix, summarizeAcceptanceReport, renderAcceptanceHtml, renderAcceptanceMarkdown, type AcceptanceReport } from '../lib/providers/acceptance';

const provider: ProviderDefinition = {
  key:'fixture', name:'Fixture', description:'', kind:'compatible', authTypes:['api_key','oauth','local'],
  capabilities:{streaming:true,tools:true,vision:true,agent:false,modelDiscovery:true,mcp:true},
  models:[{id:'native:model',displayName:'Native',capabilities:{tools:true,vision:false}}], setupHint:'',
};
const connection = (patch: Partial<ProviderConnection> = {}): ProviderConnection => ({
  id:'conn-a',ownerId:'PRIVATE_OWNER',providerKey:'fixture',slug:'PRIVATE_SLUG',label:'PRIVATE_LABEL',
  authType:'api_key',baseUrl:'https://PRIVATE_BASE.invalid',config:{token:'PRIVATE_SECRET'},enabled:true,
  hasSecret:true,secretHint:'PRIVATE_HINT',createdAt:'',updatedAt:'',...patch,
});
const model = (patch: Partial<ProviderModel> = {}): ProviderModel => ({
  id:'native:model',key:'UNTRUSTED_KEY',displayName:'PRIVATE_MODEL_LABEL',providerKey:'fixture',
  providerName:'Fixture',connectionId:'conn-a',connectionLabel:'PRIVATE_CONNECTION_LABEL',source:'discovered',...patch,
});
const report = (patch: Partial<AcceptanceReport> = {}): AcceptanceReport => ({
  schemaVersion:1,id:'report',createdAt:'2026-11-19T00:00:00Z',updatedAt:'2026-11-19T00:00:00Z',
  mode:'catalog',state:'planned',revision:'fixture',targets:buildAcceptanceMatrix({providers:[provider],connections:[connection()]}),
  limits:{maxTurns:2,timeoutMs:1000},turnsUsed:0,notes:[],...patch,
});
test('covers every dynamic registry provider and advertised authentication path without green cells', () => {
  const targets = buildAcceptanceMatrix({providers:PROVIDERS});
  for (const p of PROVIDERS) for (const authType of p.authTypes) {
    const rows = targets.filter(t => t.providerKey === p.key && t.authType === authType);
    assert.ok(rows.length, p.key + '/' + authType);
    for (const row of rows) {
      assert.equal(row.modelSource,'catalog');
      assert.deepEqual(row.cells.map(c => c.check),ACCEPTANCE_CHECKS);
      assert.ok(row.cells.every(c => c.status !== 'passed' && /Catalog\/unverified/.test(c.reason)));
    }
  }
  assert.equal(summarizeAcceptanceReport(report({targets})).releaseReady,false);
});
test('authentication is independent and endpoints remain distinct; local needs no secret', () => {
  const rows = buildAcceptanceMatrix({providers:[provider],connections:[
    connection(),connection({id:'second'}),connection({id:'disabled',enabled:false}),
    connection({id:'oauth',authType:'oauth',hasSecret:false}),
    connection({id:'local',authType:'local',hasSecret:false}),
  ]});
  assert.equal(new Set(rows.map(t => t.id)).size,5);
  for (const id of ['conn-a','second','local']) assert.equal(rows.find(t => t.connectionId === id)!.cells[0].status,'untested');
  for (const id of ['disabled','oauth']) assert.ok(rows.find(t => t.connectionId === id)!.cells.every(c => c.status === 'blocked'));
  const missing = buildAcceptanceMatrix({providers:[provider],connections:[connection()]});
  assert.ok(missing.filter(t => t.authType !== 'api_key').every(t => t.cells.every(c => c.status === 'blocked')));
});
test('discovery overlays exact registry metadata without leaking across connections or guessing names', () => {
  const rows = buildAcceptanceMatrix({providers:[provider],connections:[connection(),connection({id:'second'})],models:[
    model({capabilities:{tools:false,vision:true,streaming:false}}),
    model({id:'vision-tools-famous-name',capabilities:{},connectionId:'second'}),
  ]});
  const first = rows.find(t => t.connectionId === 'conn-a')!;
  assert.equal(first.modelId,'native:model');
  assert.equal(first.modelKey,'fixture:conn-a:native:model');
  assert.equal(first.modelSource,'discovered');
  assert.equal(first.capabilities.vision,true);
  assert.equal(first.capabilities.tools,false);
  assert.equal(first.cells.find(c => c.check === 'mcp')!.status,'unsupported');
  const second = rows.find(t => t.connectionId === 'second')!;
  assert.equal(second.capabilities.tools,undefined);
  assert.equal(second.capabilities.vision,undefined);
  assert.equal(second.cells.find(c => c.check === 'vision')!.status,'untested');
  const exact = buildAcceptanceMatrix({providers:[provider],connections:[connection()],models:[model()]})[0];
  assert.equal(exact.capabilities.tools,true);
  assert.equal(exact.capabilities.vision,false);
});
test('authentication-only models block explicitly; no implementation stays untested', () => {
  const rows = buildAcceptanceMatrix({providers:[{...provider,models:[]}],connections:[connection()]});
  assert.ok(rows[0].cells.every(c => c.status === 'blocked' && /no model/.test(c.reason)));
  const runnable = buildAcceptanceMatrix({providers:[provider],connections:[connection()]})[0];
  for (const check of ['persistence','interactive-input','model-switch'] as const)
    assert.equal(runnable.cells.find(c => c.check === check)!.status,'untested');
});
test('summary fails closed on empty, missing, catalog, incomplete, and evidence-free reports', () => {
  const target = buildAcceptanceMatrix({providers:[provider],connections:[connection()]})[0];
  target.cells = target.cells.map(c => ({...c,status:'passed',checkedAt:'2026-11-19T00:00:00Z',evidence:{executed:true}}));
  const live = report({mode:'live',state:'completed',turnsUsed:1,targets:[target]});
  assert.equal(summarizeAcceptanceReport(live).releaseReady,true);
  for (const patch of [{targets:[]},{mode:'catalog' as const},{state:'cancelled' as const},{turnsUsed:0}])
    assert.equal(summarizeAcceptanceReport({...live,...patch}).releaseReady,false);
  for (const status of ['failed','blocked','untested'] as const) {
    const r = structuredClone(live); r.targets[0].cells[0].status = status;
    const summary = summarizeAcceptanceReport(r);
    assert.equal(summary[status],1); assert.equal(summary.releaseReady,false);
    assert.equal(summary.total,ACCEPTANCE_CHECKS.length);
  }
  for (const transform of [
    () => [], (cells: typeof target.cells) => cells.slice(1),
    (cells: typeof target.cells) => cells.map(c => ({...c,evidence:undefined})),
    (cells: typeof target.cells) => cells.map(c => ({...c,checkedAt:undefined})),
    (cells: typeof target.cells) => cells.map(c => ({...c,status:'unsupported' as const})),
  ]) {
    const r = structuredClone(live); r.targets[0].cells = transform(r.targets[0].cells);
    assert.equal(summarizeAcceptanceReport(r).releaseReady,false);
  }
});
test('outputs whitelist metadata, are pure and escape hostile HTML and Markdown', () => {
  const input = {providers:[provider],connections:[connection()],models:[model()]};
  const before = JSON.stringify(input);
  const targets = buildAcceptanceMatrix(input);
  assert.equal(JSON.stringify(input),before);
  const r = report({targets});
  for (const text of [JSON.stringify(targets),renderAcceptanceMarkdown(r),renderAcceptanceHtml(r)])
    assert.doesNotMatch(text,/PRIVATE_|UNTRUSTED_KEY|https:\/\//);
  const attack = '<script>alert("x")</script> | [link](javascript:bad)\n# injected';
  r.notes = [attack]; r.targets[0].providerName = attack;
  r.targets[0].cells[0].reason = attack;
  r.targets[0].cells[0].evidence = {payload:attack};
  const html = renderAcceptanceHtml(r), md = renderAcceptanceMarkdown(r);
  assert.match(html,/<!doctype html>/i);
  assert.doesNotMatch(html,/<script>|<a\\b|href=|onclick=/);
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(md,/<script>|\[link\]|\n# injected/);
  assert.match(md,/&#124;/);
  assert.match(html,/Release ready: No/);
});
