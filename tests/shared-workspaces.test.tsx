import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { sharedChatWorkspaces, sharedWorkspaceFromTool } from "../lib/shared-workspace";
import { publicMarkdownLinkTarget } from "../lib/public-markdown";
import { PublicMarkdownLink } from "../components/public-markdown-link";
import { PublicMarkdownContext } from "../components/public-markdown-context";

Object.assign(globalThis, { React });
createRequire(import.meta.url).extensions[".css"] = () => {};
const workspaces = [
  { id: "canvas-1", type: "canvas" as const, name: "Canvas", content: "Current saved content" },
  { id: "plan-1", type: "plan" as const, name: "Plan", content: "Plan content" },
];

test("artifact Open resolves nested MCP identities and only opens included saved workspaces", () => {
  for (const type of ["canvas", "plan"] as const) {
    const saved = workspaces.find(item => item.type === type)!;
    const payload = { id: saved.id, name: saved.name, content: "Old preview" };
    const tool = { kind: type, input: JSON.stringify({ content: "[Other](workspace://canvas/foreign)" }),
      result: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(payload) }] }) };
    assert.equal(sharedWorkspaceFromTool(tool, workspaces), saved);
    assert.equal(sharedWorkspaceFromTool(tool, []), null);
    assert.equal(sharedWorkspaceFromTool({ kind: type, result: JSON.stringify({ ...payload, id: "foreign" }) }, workspaces), null);
  }
  assert.equal(sharedWorkspaceFromTool({ kind: "canvas", path: "workspace://canvas/canvas-1" }, workspaces), workspaces[0]);
  assert.equal(sharedWorkspaceFromTool({ kind: "plan", path: "workspace://canvas/canvas-1" }, workspaces), null);
  assert.deepEqual(sharedChatWorkspaces({ canvas: "Legacy" }), [{ id: "canvas-default", name: "Canvas", type: "canvas", content: "Legacy" }]);
});

test("shared workspace links invoke viewer callbacks and cannot resolve private identities", () => {
  const calls: unknown[][] = [];
  const share = { noteIds: [], assets: {}, workspaces, onOpenWorkspace: (...args: unknown[]) => calls.push(args) };
  assert.equal(publicMarkdownLinkTarget("workspace://canvas/private", share), undefined);
  assert.equal(publicMarkdownLinkTarget("workspace://plan/canvas-1", share), undefined);
  assert.equal(publicMarkdownLinkTarget("workspace://file/%2Fprivate", share), undefined);
  const link = PublicMarkdownLink({ href: "workspace://canvas/canvas-1", share, children: "Canvas" });
  assert.equal(link.props.href, "#workspace-canvas-1");
  link.props.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(calls, [["canvas-1", "canvas"]]);
});

test("nested artifact Markdown inherits the public allowlist", async () => {
  const { CanvasWorkspaceCard } = await import("../components/canvas-workspace-card");
  const html = renderToStaticMarkup(<PublicMarkdownContext.Provider value={{ noteIds: [], assets: {}, workspaces }}>
    <CanvasWorkspaceCard title="Shared" content="[Allowed](workspace://canvas/canvas-1)\n\n[Private](workspace://file/%2Froot%2Fsecret)" />
  </PublicMarkdownContext.Provider>);
  assert.match(html, /href="#workspace-canvas-1"/);
  assert.doesNotMatch(html, /href="workspace:|ai-chat:open-file/);
});
