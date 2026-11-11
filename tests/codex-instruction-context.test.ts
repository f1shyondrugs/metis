import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCodexInstructionFile } from "../lib/providers/codex-instructions";

test("real Codex keeps current base policy once across resume and applies corrections", { timeout: 30_000, skip: process.platform === "win32" }, async (t) => {
  const { Codex } = await import("@openai/codex-sdk");
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-native-context-"));
  const requests: Array<{ instructions: string; input: Array<{ role?: string; content?: unknown }> }> = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (!req.url?.endsWith("/responses")) { res.writeHead(404).end(); return; }
    requests.push(JSON.parse(body));
    const id = "response-" + requests.length;
    const message = { type: "message", id: "msg-" + requests.length, role: "assistant", status: "completed", content: [{ type: "output_text", text: "fixture response", annotations: [] }] };
    const response = { id, object: "response", created_at: 0, status: "completed", output: [message], usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 105 } };
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    for (const event of [
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } },
      { type: "response.output_item.done", output_index: 0, item: message },
      { type: "response.completed", response },
    ]) res.write("event: " + event.type + "\ndata: " + JSON.stringify(event) + "\n\n");
    res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); rmSync(root, { recursive: true, force: true }); });
  const address = server.address() as { port: number };
  const policyFiles: string[] = [];
  function client(policy: string) {
    const policyFile = createCodexInstructionFile(policy, root);
    assert.equal(statSync(policyFile).mode & 0o777, 0o600);
    policyFiles.push(policyFile);
    return new Codex({
      codexPathOverride: path.resolve("node_modules/.bin/codex"),
      env: { PATH: process.env.PATH || "", CODEX_HOME: root, OPENAI_API_KEY: "fixture-only-not-a-secret" },
      config: {
        model_provider: "fixture",
        model_providers: { fixture: { name: "Local fixture", base_url: "http://127.0.0.1:" + address.port + "/v1", wire_api: "responses", requires_openai_auth: false } },
        model_instructions_file: policyFile, web_search: "disabled", features: { shell_tool: false },
      },
    });
  }
  const options = { model: "fixture-model", workingDirectory: root, skipGitRepoCheck: true, sandboxMode: "danger-full-access" as const, approvalPolicy: "never" as const };
  const first = client("PERSISTENT_POLICY_MARKER").startThread(options);
  await first.run("FIRST_TASK_MARKER", { signal: AbortSignal.timeout(8000) });
  assert.ok(first.id);
  rmSync(policyFiles[0]);
  await client("PERSISTENT_POLICY_MARKER").resumeThread(first.id!, options).run("SECOND_TASK_MARKER", { signal: AbortSignal.timeout(8000) });
  rmSync(policyFiles[1]);
  await client("CORRECTED_POLICY_MARKER").resumeThread(first.id!, options).run("THIRD_TASK_MARKER", { signal: AbortSignal.timeout(8000) });
  assert.equal(requests.length, 3);
  const second = JSON.stringify(requests[1].input);
  assert.equal(JSON.stringify(requests[1]).split("PERSISTENT_POLICY_MARKER").length - 1, 1);
  assert.match(second, /FIRST_TASK_MARKER/);
  assert.match(second, /SECOND_TASK_MARKER/);
  assert.equal(requests[1].instructions, "PERSISTENT_POLICY_MARKER");
  assert.equal(requests[2].instructions, "CORRECTED_POLICY_MARKER");
  assert.doesNotMatch(JSON.stringify(requests[2].input), /PERSISTENT_POLICY_MARKER/);
  const userMessages = requests[1].input.filter(item => item.role === "user");
  assert.ok(userMessages.every(item => !JSON.stringify(item).includes("PERSISTENT_POLICY_MARKER")));
  console.log("NATIVE_INSTRUCTIONS_RESUME_OK", JSON.stringify({ requests: requests.length, stablePolicyCopies: 1 }));
});
