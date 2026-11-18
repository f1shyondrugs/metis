import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RUNTIME_MODES, RUNTIME_MODE_TO_CODEX } from "../lib/runtime-mode";

// A real Codex process + synthetic local Responses/MCP servers. No provider
// credentials, model billing, production state or native file/shell tools.
test("real Codex delegates MCP approvals to Metis in every permission mode", { timeout: 60_000, skip: process.platform === "win32" }, async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-codex-approval-"));
  Object.assign(process.env, { CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"), AGENT_CWD: root });
  const { Codex } = await import("@openai/codex-sdk");
  const { codexGatewayMcpConfig, codexMcpOnlyConfig } = await import("../lib/providers/adapters/codex");
  let writes = 0;
  let modelRequests: Array<Record<string, unknown>> = [];
  let fixtureError: string | undefined;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/mcp") {
      if (req.method !== "POST") { res.writeHead(405).end(); return; }
      if (body.id === undefined) { res.writeHead(202).end(); return; }
      let result: unknown;
      if (body.method === "initialize") result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "metis-permission-fixture", version: "1" } };
      else if (body.method === "tools/list") result = { tools: [{
        name: "fixture_write", description: "Synthetic write; the gateway owns confirmation.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      }] };
      else if (body.method === "tools/call") { writes++; result = { content: [{ type: "text", text: "GATEWAY_EXECUTED_FIXTURE" }] }; }
      else result = {};
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      return;
    }
    if (!req.url?.endsWith("/responses")) { res.writeHead(404).end(); return; }
    modelRequests.push(body);
    const tool = (body.tools || []).flatMap((entry: { name?: string; type?: string; tools?: Array<{ name: string }> }) => entry.type === "namespace"
      ? (entry.tools || []).map(tool => ({ name: tool.name, namespace: entry.name })) : [entry]).find((tool: { name?: string }) => tool.name?.includes("fixture_write"));
    if (!tool) { fixtureError = "Missing MCP fixture tool: " + JSON.stringify(body.tools?.map((entry: Record<string, unknown>) => ({ ...entry, description: undefined, parameters: undefined }))).slice(0, 6000); }
    const item = modelRequests.length === 1 && tool
      ? { type: "function_call", id: "fc-fixture", call_id: "fixture-call", name: tool.name, namespace: tool.namespace, arguments: "{}" }
      : { type: "message", id: "msg-fixture", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Fixture complete", annotations: [] }] };
    const response = { id: "response-" + modelRequests.length, object: "response", created_at: 0, status: "completed", output: [item],
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 105 } };
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    for (const event of [
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response },
    ]) res.write("event: " + event.type + "\ndata: " + JSON.stringify(event) + "\n\n");
    res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); rmSync(root, { recursive: true, force: true }); });
  const base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  for (const [index, mode] of [undefined, ...RUNTIME_MODES].entries()) {
    writes = 0; modelRequests = []; fixtureError = undefined;
    const mcp = codexGatewayMcpConfig({ type: "http", url: base + "/mcp" });
    // Baseline proves that this CLI reproduces the reported failure.
    if (mode === undefined) delete (mcp as { default_tools_approval_mode?: string }).default_tools_approval_mode;
    mkdirSync(path.join(root, "home-" + index));
    const client = new Codex({
      codexPathOverride: path.resolve("node_modules/.bin/codex"),
      env: { PATH: process.env.PATH || "", HOME: root, CODEX_HOME: path.join(root, "home-" + index), OPENAI_API_KEY: "fixture-only" },
      config: {
        ...codexMcpOnlyConfig(), features: { ...codexMcpOnlyConfig().features, code_mode: false },
        model_provider: "fixture", model_providers: { fixture: { name: "Local fixture", base_url: base + "/v1", wire_api: "responses", requires_openai_auth: false } },
        mcp_servers: { metis_ai: mcp },
      },
    });
    const thread = client.startThread({ model: "fixture-model", workingDirectory: root, skipGitRepoCheck: true, ...RUNTIME_MODE_TO_CODEX[mode || "approval-required"] });
    await thread.run("Use the synthetic fixture_write tool once.", { signal: AbortSignal.timeout(10_000) });
    assert.equal(fixtureError, undefined, fixtureError);
    assert.equal(modelRequests.length, 2, "Function result must return to the local model fixture");
    const second = JSON.stringify((modelRequests[1].input as Array<{ type: string }>).filter(item => item.type === "function_call_output"));
    if (mode === undefined) {
      assert.equal(writes, 0);
      assert.match(second, /requires approval, but approval policy is never/);
    } else {
      assert.equal(writes, 1, mode);
      assert.match(second, /GATEWAY_EXECUTED_FIXTURE/);
      assert.doesNotMatch(second, /requires approval/);
    }
  }
  console.log("CODEX_MCP_APPROVAL_MATRIX_OK baseline-reproduced modes=4");
});
