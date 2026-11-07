import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createResearchWorkflow, researchPlanForm, RESEARCH_WORKFLOW_TOOLS } from "../lib/mcp-core/research-workflow.mjs";
import { normalizeAskUserInput, normalizeStoredQuestions, normalizeQuestionAnswers } from "../lib/question-contract";
import { researchReportAttachment } from "../lib/research-report";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-research-workflow-"));
Object.assign(process.env, { AI_CHAT_ROOT: root, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"),
  AGENT_CWD: root, AI_CHAT_MCP_STATE_DIR: path.join(root, "mcp"), AI_CHAT_INTERNAL_ORIGIN: "http://127.0.0.1:1", MCP_BEARER_TOKEN: "research-test" });
for (const key of ["AI_CHAT_INTERNAL_URL", "AI_CHAT_FILE_URL", "AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[key];
test.after(() => rmSync(root, { recursive: true, force: true }));
const context = { userId: "owner", chatId: "chat", jobId: "run", modeId: "deep-research" };
const args = { title: "Energievergleich", plan: ["Kosten prüfen", "Primärquellen vergleichen", "Bericht erstellen"], language: "de" };
const reportCanvas = { canvasId: "report-canvas", workspaceLink: "workspace://canvas/report-canvas", markdown: "[Open report in Canvas](workspace://canvas/report-canvas)" };

test("review form is editable, has no preselected decision and validates through the real form contract", () => {
  const form = normalizeAskUserInput(researchPlanForm(args));
  const questions = normalizeStoredQuestions(form.questions);
  // Product controls stay English while researcher/user content keeps its original language.
  assert.deepEqual(researchPlanForm(args), researchPlanForm({ ...args, language: "en" }));
  assert.equal(form.language, "en");
  assert.equal(form.title, "Review research plan");
  assert.equal(form.description, args.title);
  assert.equal(form.submitLabel, "Submit decision");
  assert.deepEqual(questions.map(question => question.question), ["Research steps", "Decision", "Sources to actually read", "Report: minimum words"]);
  assert.deepEqual(questions[1].options?.map(option => option.label), ["Approve and research", "Revise", "Deny"]);
  assert.equal(questions[0].type, "task_list");
  assert.deepEqual(questions[0].default, args.plan);
  assert.equal(questions[1].default, undefined);
  assert.deepEqual(questions[1].options?.map(o => o.value), ["approve", "revise", "deny"]);
  assert.throws(() => normalizeQuestionAnswers(questions, [JSON.stringify(args.plan), ""]));
  const result = normalizeQuestionAnswers(questions, { plan: ["Nur Hessen untersuchen"], decision: "approve", source_target: 200, minimum_words: 4000 });
  assert.deepEqual(result.values.plan, ["Nur Hessen untersuchen"]);
  assert.equal(RESEARCH_WORKFLOW_TOOLS[0].inputSchema["x-metis-waits-for-user"], true);
  assert.throws(() => researchPlanForm({ ...args, plan: ["x".repeat(4001)] }), /4000/);
});

test("research waits for submission, preserves user edits and durable approval, and isolates runs", async () => {
  let submit!: (value: unknown) => void;
  const waiting = new Promise(resolve => { submit = resolve; });
  const workflow = createResearchWorkflow({ stateDir: path.join(root, "approval"), ask: () => waiting, attachReport: async () => reportCanvas });
  await assert.rejects(workflow.assertAllowed("web_search", context), /locked/);
  await workflow.assertAllowed("web_search", { ...context, modeId: "agent" });
  const reviewing = workflow.plan(args, context);
  await new Promise(resolve => setTimeout(resolve, 30));
  await assert.rejects(workflow.assertAllowed("research_search", context), /locked/);
  await assert.rejects(workflow.plan(args, context), /already awaiting/);
  submit({ questionId: "actual-submission", values: { plan: ["Edited by user"], decision: "approve" } });
  const approved = await reviewing;
  assert.deepEqual(approved.plan, ["Edited by user"]);
  const restored = createResearchWorkflow({ stateDir: path.join(root, "approval") });
  for (const name of ["research_search", "research_open", "research_sources", "browser_navigate", "call_mcp_tool"]) await restored.assertAllowed(name, context);
  for (const identity of ["userId", "chatId", "jobId"]) await assert.rejects(restored.assertAllowed("web_search", { ...context, [identity]: "foreign" }), /locked/);
  assert.equal((await workflow.report({ title: "Report", content: "Evidence" }, context)).status, "report_attached");
});

test("deny, revision, missing submission, cancellation and failed attachment never count as approval", async () => {
  for (const decision of ["deny", "revise", undefined, "custom answer"]) {
    const stateDir = path.join(root, randomUUID());
    const workflow = createResearchWorkflow({ stateDir, ask: async () => ({ questionId: "submitted", values: { plan: ["Edited"], decision } }) });
    const result = await workflow.plan(args, context);
    assert.equal(result.status, decision === "revise" ? "revision_requested" : "denied");
    await assert.rejects(workflow.assertAllowed("research_search", context), /locked/);
    await assert.rejects(workflow.report({ title: "x", content: "x" }, context), /locked/);
  }
  const noSubmission = createResearchWorkflow({ stateDir: path.join(root, randomUUID()), ask: async () => ({ values: { plan: ["x"], decision: "approve" } }) });
  assert.equal((await noSubmission.plan(args, context)).status, "denied");
  const cancelled = createResearchWorkflow({ stateDir: path.join(root, randomUUID()), ask: async () => { throw new Error("cancelled"); } });
  await assert.rejects(cancelled.plan(args, context), /cancelled/);
  await assert.rejects(cancelled.assertAllowed("web_fetch", context), /locked/);
  let attempt = 0;
  const retry = createResearchWorkflow({ stateDir: path.join(root, randomUUID()), ask: async () => ({ questionId: "q", values: { plan: ["p"], decision: "approve" } }),
    attachReport: async () => { if (!attempt++) throw new Error("storage failed"); return reportCanvas; } });
  await retry.plan(args, context);
  await assert.rejects(retry.report({ title: "Report", content: "Findings" }, context), /storage failed/);
  assert.equal((await retry.report({ title: "Report", content: "Findings" }, context)).workspaceLink, reportCanvas.workspaceLink);
});

test("invalid typed plan submissions never unlock a structured review", async () => {
  for (const plan of [[], [""], [true], ["x".repeat(4001)], "forged plaintext", Array(21).fill("Step")]) {
    const workflow = createResearchWorkflow({ stateDir: path.join(root, randomUUID()), ask: async () => ({ questionId: "submitted", values: { plan, decision: "approve" } }) });
    assert.equal((await workflow.plan(args, context)).status, "denied");
    await assert.rejects(workflow.assertAllowed("research_search", context), /locked/);
  }
});

test("Incognito approval remains in memory and report output is bounded Markdown without a path", async () => {
  const stateDir = path.join(root, "private");
  const workflow = createResearchWorkflow({ stateDir, ask: async () => ({ questionId: "q", values: { plan: ["private"], decision: "approve" } }) });
  await workflow.plan(args, { ...context, incognito: true });
  assert.equal(readdirSync(root).includes("private"), false);
  await assert.rejects(createResearchWorkflow({ stateDir }).assertAllowed("web_search", { ...context, incognito: true }), /locked/);
  const file = researchReportAttachment({ title: "../../Recherche\n2026", content: "## Ergebnis\n[Beleg](https://example.org)" });
  assert(!file.name.includes("/"));
  assert(file.name.endsWith(".md"));
  assert.equal(file.mimeType, "text/markdown");
  assert.match(Buffer.from(file.data, "base64").toString(), /## Ergebnis/);
  assert.throws(() => researchReportAttachment({ title: "x", content: "ä".repeat(250001) }), /500000/);
});

test("gateway review -> typed answer -> research -> real report canvas and owner-only export", async t => {
  const { createUser, authenticateUser } = await import("../lib/auth");
  const store = await import("../lib/db-store");
  const jobs = await import("../lib/db-jobs");
  const question = await import("../app/api/internal/mcp-question/route");
  const answer = await import("../app/api/chat/answer/route");
  const workspace = await import("../app/api/internal/mcp-workspace/route");
  const exportApi = await import("../app/api/workspace-export/route");
  const owner = createUser("research-owner", "test-password"), foreign = createUser("research-foreign", "test-password");
  const cookie = "ai_chat_auth=" + authenticateUser("research-owner", "test-password")!.token;
  const foreignCookie = "ai_chat_auth=" + authenticateUser("research-foreign", "test-password")!.token;
  const chat = store.createChat("Research", undefined, owner.id);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: owner.id, message: "Research" });
  const lease = jobs.claimNextJob({ workerId: "research-worker" })!;
  const messageId = randomUUID();
  store.appendMessage(chat.id, { id: messageId, role: "assistant", content: "" }, owner.id);
  jobs.appendRunEvent(job.id, chat.id, owner.id, "assistantId", { messageId });
  const ctx = { ...context, userId: owner.id, chatId: chat.id, jobId: job.id, workerId: lease.leaseOwner, leaseToken: lease.leaseToken,
    runtimeMode: "full-access", isHostAdmin: true, modePolicy: JSON.stringify({ allowedCategories: ["read", "browser", "plan"], toolOverrides: { research_report: true, create_canvas: false, edit_canvas: false } }) };
  const { dispatchGatewayTool, modeToolCategory } = await import("../lib/mcp-core/gateway-core.mjs");
  let webCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/internal/mcp-question")) {
      const req = new Request(url, init);
      return init?.method === "POST" ? question.POST(req) : question.GET(req);
    }
    if (url.endsWith("/api/internal/mcp-workspace")) return workspace.POST(new Request(url, init));
    webCalls++;
    return Response.json({ results: [{ ok: true, title: "Evidence", content: "Verifiable evidence." }] });
  });
  const call = (name: string, input = {}) => dispatchGatewayTool(name, input, { context: ctx, auditCall: false });
  assert.equal(modeToolCategory("research_plan"), "plan");
  assert.equal(modeToolCategory("research_report"), "write");
  assert.equal((await call("research_open", { url: "https://example.org" })).isError, true);
  assert.equal(webCalls, 0);
  assert.equal((await call("write_file", { path: "/tmp/no", content: "no" })).isError, true);
  const reviewing = call("research_plan", args);
  let pending = store.getChat(chat.id, owner.id)?.pendingQuestion;
  for (let i = 0; i < 100 && !pending; i++) { await new Promise(resolve => setTimeout(resolve, 10)); pending = store.getChat(chat.id, owner.id)?.pendingQuestion; }
  assert(pending);
  const submit = (session: string) => answer.POST(new Request("http://test/api/chat/answer", { method: "POST", headers: { cookie: session, "content-type": "application/json" },
    body: JSON.stringify({ questionId: pending!.questionId, values: { plan: ["Only 2026 data", "Check methodology", "Attach the report"], decision: "approve", source_target: 1, minimum_words: 500 } }) }));
  assert.equal((await submit(foreignCookie)).status, 404);
  assert.equal((await submit(cookie)).status, 200);
  const approved = await reviewing;
  assert.notEqual(approved.isError, true, JSON.stringify(approved));
  assert.deepEqual(JSON.parse(approved.content[0].text).plan, ["Only 2026 data", "Check methodology", "Attach the report"]);
  const evidence = await call("research_open", { url: "https://example.org/evidence" });
  assert.notEqual(evidence.isError, true, JSON.stringify(evidence));
  assert(webCalls > 0);
  assert.equal((await call("create_canvas", { title: "Not an approved report", content: "No" })).isError, true);
  const reportContent = "## Befund\n" + "Verifiable evidence. ".repeat(6000) + "[Beleg](https://example.org/evidence)\nREPORT_END";
  assert.ok(reportContent.length > 100_000);
  const reportInput = { title: "Recherche 2026", content: reportContent };
  const report = await call("research_report", reportInput);
  assert.notEqual(report.isError, true, JSON.stringify(report));
  const result = JSON.parse(report.content[0].text);
  assert.equal(result.status, "report_attached");
  assert.equal(result.type, "canvas");
  assert.equal(result.canvasId, result.id);
  assert.equal(result.workspaceLink, "workspace://canvas/" + result.id);
  assert.equal(result.markdown, "[Open report in Canvas](" + result.workspaceLink + ")");
  assert.equal(result.content, undefined, "the full report is read from Canvas, not echoed in tool metadata");
  assert.equal(result.downloadUrl, undefined);
  assert.equal(result.attachment, undefined);
  assert.ok(report.content[0].text.length < 8000);
  const saved = store.getChat(chat.id, owner.id)!;
  const canvas = saved.workspaces!.find(item => item.id === result.id)!;
  assert.equal(canvas.content, reportContent);
  assert.equal(canvas.idempotencyKey, job.id + ":research_report");
  assert.equal(saved.messages[0].attachments?.length || 0, 0);
  const repeated = JSON.parse((await call("research_report", reportInput)).content[0].text);
  assert.equal(repeated.canvasId, result.id);
  assert.equal(store.getChat(chat.id, owner.id)!.workspaces!.filter(item => item.id === result.id).length, 1);
  const download = (session: string) => exportApi.POST(new Request("http://test/api/workspace-export", { method: "POST", headers: { cookie: session, "content-type": "application/json" }, body: JSON.stringify({ chatId: chat.id, workspaceId: canvas.id, name: canvas.name, content: canvas.content, format: "md" }) }));
  assert.equal((await download(foreignCookie)).status, 404);
  const response = await download(cookie);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), reportContent);
  jobs.updateJob(job.id, { status: "completed" });
});
