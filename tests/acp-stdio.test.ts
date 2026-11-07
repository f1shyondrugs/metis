import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {copyFileSync,rmSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {withNativeRuntime,nativeRuntimeScope} from "../lib/providers/native-sandbox";
import {
  applyAcpSessionUpdate,
  mcpServersForAcp,
  rejectedAcpPermissionResult,
  runAcpStdioAgent,
} from "../lib/providers/acp-stdio";

test("applyAcpSessionUpdate maps MCP-looking tools onto canonical parts", () => {
  const tools: Array<{ name: string; source?: string; kind?: string }> = [];
  applyAcpSessionUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "1",
    title: "list_directory",
    status: "completed",
    rawInput: { path: "/tmp" },
  }, {
    onText() {},
    onTool(tool) { tools.push(tool); },
  });
  assert.equal(tools[0]?.name, "list_directory");
  assert.equal(tools[0]?.source, "mcp");
  assert.equal(tools[0]?.kind, "read");
});

test("mcpServersForAcp keeps HTTP Authorization headers", () => {
  const mapped = mcpServersForAcp({
    gateway: { type: "http", url: "http://127.0.0.1:8787", headers: { Authorization: "Bearer x" } },
  });
  assert.equal(mapped[0]?.type, "http");
  assert.equal(mapped[0]?.url, "http://127.0.0.1:8787");
  assert.deepEqual(mapped[0]?.headers, [{ name: "Authorization", value: "Bearer x" }]);
});

test("ACP permission requests are rejected instead of approving native tools", () => {
  assert.deepEqual(
    rejectedAcpPermissionResult({
      options: [
        { optionId: "allow-once", kind: "allow_once" },
        { optionId: "deny-once", kind: "reject_once" },
      ],
    }),
    { outcome: { outcome: "selected", optionId: "deny-once" } },
  );
  assert.deepEqual(
    rejectedAcpPermissionResult({ options: [{ optionId: "allow-once", kind: "allow_once" }] }),
    { outcome: { outcome: "cancelled" } },
  );
});

test("runAcpStdioAgent drives a real isolated ACP child and surfaces tools + text",{skip:process.platform!=="linux"||process.getuid?.()===0}, async () => {
 const previousIsolation=process.env.METIS_NATIVE_ISOLATION;
 process.env.METIS_NATIVE_ISOLATION="1";
 const owner="acp-test-"+randomUUID();
 try { await withNativeRuntime(owner,undefined,async()=>{
  const scope=nativeRuntimeScope()!,fixture=path.join(scope.home,"fake-acp.cjs");
  copyFileSync(fileURLToPath(new URL("./fixtures/fake-acp.cjs", import.meta.url)),fixture);
  try{
  const tools: string[] = [];
  let text = "";
  const result = await runAcpStdioAgent({
    command: process.execPath,
    args: [fixture],
    cwd: path.dirname(fixture),
    prompt: "list tmp",
    mcp: {gateway:{type:"http",url:"http://127.0.0.1:1/mcp",headers:{Authorization:`Bearer metis-v1.${Buffer.from(JSON.stringify({userId:owner})).toString("base64url")}.fixture`}}},
    signal: new AbortController().signal,
    onText: (chunk) => { text += chunk; },
    onTool: (tool) => { tools.push(tool.name); },
  });
  assert.equal(result.sessionId, "sess-1");
  assert.deepEqual(tools, ["list_directory"]);
  assert.match(text, /listed \/tmp/);
  }finally{rmSync(scope.state,{recursive:true,force:true});}
 }); } finally { if(previousIsolation===undefined)delete process.env.METIS_NATIVE_ISOLATION;else process.env.METIS_NATIVE_ISOLATION=previousIsolation; }
});
