import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ComposerCommandPicker, composerCommands, commandResults, commandScope, WORKSPACE_COMMAND_TABS,
  type ComposerCommand,
} from "../components/composer-command-picker";
import { ReferencePicker } from "../components/reference-picker";
import { composerReferenceKeyAction } from "../lib/composer-references";
import type { ModelInfo } from "../components/settings-panel";

Object.assign(globalThis, { React });

function fixture(locks: { modelLock?: string; optionLock?: string } = {}) {
  const model: ModelInfo = {
    id: "fixture:main", displayName: "Fixture model", providerName: "Synthetic provider",
    parameters: [{ id: "effort", displayName: "Thinking", values: [{ value: "low" }, { value: "high", displayName: "High" }] },
      { id: "context", values: [], customNumber: { min: 1024, max: 4096, step: 256 } }],
    defaultParams: [{ id: "effort", value: "low" }],
  };
  const applied: unknown[] = [];
  const commands = composerCommands({
    modes: ["agent", "plan", "deep-research"].map(id => ({ id, label: id === "deep-research" ? "Deep Research" : id,
      run: () => applied.push(["mode", id]) })),
    access: ["approval-required", "auto-accept-edits", "auto", "full-access"].map(id => ({ id, label: id, run: () => applied.push(["access", id]) })),
    models: [model], selectedModel: model, modelParams: [{ id: "effort", value: "low" }],
    chains: [{ id: "chain-1", name: "Fallback chain", steps: [], version: 1, createdAt: "", updatedAt: "" }],
    favoriteModelIds: [model.id], modelId: model.id, modelLabel: model.displayName,
    workspaceTabs: WORKSPACE_COMMAND_TABS.filter(tab => tab.id !== "team"), canCreate: true,
    onModel: id => applied.push(["model", id]), onChain: chain => applied.push(["chain", chain.id]),
    onModelParams: params => applied.push(params), onWorkspace: tab => applied.push(["workspace", tab]),
    onCreate: type => applied.push(["create", type]), onSettings() {}, onAgentHub() {}, onCalendar() {}, onChatSearch() {}, onFiles() {},
    ...locks,
  });
  return { commands, applied };
}

function run(item: ComposerCommand | undefined) {
  assert(item && "run" in item && !item.disabled);
  item.run();
}

test("typing finds Deep Research, commands inside groups, models, chains and workspace tools", () => {
  const { commands, applied } = fixture();
  run(commandResults(commands, [], "deep-research")[0]);
  run(commandResults(commands, [], "full-access")[0]);
  run(commandResults(commands, ["model"], "synthetic fixture")[0]);
  run(commandResults(commands, ["model"], "fallback chain")[0]);
  run(commandResults(commands, [], "terminal")[0]);
  run(commandResults(commands, ["workspace"], "create canvas")[0]);
  assert.deepEqual(applied, [
    ["mode", "deep-research"], ["access", "full-access"], ["model", "fixture:main"], ["chain", "chain-1"],
    ["workspace", "terminal"], ["create", "canvas"],
  ]);
  assert(!commandResults(commands, ["workspace"], "").some(row => row.id === "tab:team"));
  assert(!commandResults(commands, ["mode"], "").some(row => row.id.includes("deep-research")));
  assert.equal(commandResults(commands, [], "reasoning")[0].parentId, "model-options");
});

test("model option values use the model contract, including numeric constraints and locks", () => {
  const { commands, applied } = fixture();
  run(commandResults(commands, ["model-options", "option:effort"], "high")[0]);
  assert.equal(commandResults(commands, ["model-options", "option:effort"], "fabricated").length, 0);
  assert.equal(commandResults(commands, ["model-options", "option:context"], "1025").length, 0);
  run(commandResults(commands, ["model-options", "option:context"], "2048")[0]);
  assert.deepEqual(applied, [[{ id: "effort", value: "high" }], [{ id: "context", value: "2048" }, { id: "effort", value: "low" }]]);
  const locked = fixture({ modelLock: "Project controlled", optionLock: "Chain controlled" }).commands;
  assert(commandResults(locked, [], "model").find(item => item.id === "model")?.disabled);
  assert.deepEqual(commandResults(locked, ["model"], "fixture"), []);
  assert.equal(commandScope(locked, ["model-options", "option:effort"]), undefined);
});

test("@ and / render the same accessible picker shell, but only / offers Deep Research", () => {
  const { commands } = fixture();
  const reference = renderToStaticMarkup(<ReferencePicker id="references" query="" kind={null} results={[]} index={0}
    loading={false} indexing={false} onIndex={()=>{}} onCategory={()=>{}} onQuery={()=>{}} onSelect={()=>{}} onKeyDown={()=>{}} retry={()=>{}} />);
  const slash = renderToStaticMarkup(<ComposerCommandPicker query="" rows={commands} index={0}
    onIndex={()=>{}} onQuery={()=>{}} onSelect={()=>{}} onKeyDown={()=>{}} />);
  for (const markup of [reference, slash]) {
    assert.match(markup, /class="reference-picker text-sm"/);
    assert.match(markup, /role="combobox".*aria-activedescendant=/);
    assert.match(markup, /role="listbox"/);
  }
  assert.match(reference, /@skills/);
  assert.doesNotMatch(reference, /Deep Research/);
  assert.match(slash, /\/deep-research/);
  assert.deepEqual(composerReferenceKeyAction({key: "Enter", index: 0, count: commands.length}), {type: "select", index: 0});
  assert.deepEqual(composerReferenceKeyAction({key: "ArrowUp", index: 0, count: commands.length}), {type: "move", index: commands.length - 1});
  assert.equal(composerReferenceKeyAction({key: "Enter", index: 0, count: commands.length, composing: true}), null);
});
