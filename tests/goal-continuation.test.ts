import assert from "node:assert/strict";
import test from "node:test";
import { decideGoalContinuation, MAX_GOAL_CONTINUATIONS, type GoalContinuationInput } from "../lib/goal-continuation";
import type { ChatMessage, ToolPart } from "../lib/store";

const taskTool = (id: string, todos: Array<{ content: string; status?: string }>, status = "completed"): ToolPart => ({
  id, name: "write_todos", kind: "todo", status,
  input: JSON.stringify({ todos }),
});
const message = (id: string, tools: ToolPart[]): ChatMessage => ({
  id, role: "assistant", content: "", createdAt: "2026-10-31T10:00:00.000Z", tools,
});
const base = (patch: Partial<GoalContinuationInput> = {}): GoalContinuationInput => ({
  goal: "Deliver the working export",
  currentAssistantMessageId: "current",
  messages: [message("current", [taskTool("tasks", [
    { content: "Implement export", status: "completed" },
    { content: "Verify exported data", status: "in_progress" },
    { content: "Attach the result", status: "pending" },
  ])])],
  jobStatus: "running",
  outcome: "success",
  ...patch,
});

test("a premature successful Goal exit resumes only confirmed remaining work", () => {
  const input = base();
  const before = structuredClone(input);
  const decision = decideGoalContinuation(input);
  assert.equal(decision.shouldContinue, true);
  if (!decision.shouldContinue) return;
  assert.equal(decision.nextContinuationCount, 1);
  assert.deepEqual(decision.remaining.map(todo => todo.content), ["Verify exported data", "Attach the result"]);
  assert.match(decision.prompt, /Verify exported data/);
  assert.doesNotMatch(decision.prompt, /1\. Implement export/);
  assert.deepEqual(input, before);
  assert.equal(decideGoalContinuation(base({ goal: "  " })).reason, "no_goal");
});

test("historic, failed and in-flight checklist writes cannot reopen the latest task", () => {
  const old = message("old", [taskTool("old", [{ content: "Historic task", status: "pending" }])]);
  for (const status of ["error", "running"]) {
    const current = message("current", [taskTool("latest", [{ content: "Unconfirmed", status: "pending" }], status)]);
    assert.equal(decideGoalContinuation(base({ messages: [old, current] })).reason, "no_current_tasks");
  }
  const wrappedError = message("current", [{
    ...taskTool("bad", [{ content: "Unconfirmed", status: "pending" }]),
    result: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ error: "write failed" }) }] }),
  }]);
  assert.equal(decideGoalContinuation(base({ messages: [old, wrappedError] })).reason, "no_current_tasks");
});

test("completed or cleared lists finish; explicit blocked items do not trigger retries", () => {
  for (const todos of [[], [{ content: "Finished", status: "completed" }], [{ content: "Cancelled step", status: "cancelled" }]]) {
    assert.equal(decideGoalContinuation(base({ messages: [message("current", [taskTool("tasks", todos)])] })).reason, "complete");
  }
  const blocked = message("current", [taskTool("tasks", [{ content: "Needs account access", status: "blocked" }])]);
  assert.equal(decideGoalContinuation(base({ messages: [blocked] })).reason, "blocked");
  assert.equal(decideGoalContinuation(base({ blockedReason: "Waiting for the account owner" })).reason, "blocked");
});

test("stops, errors, pauses and approvals always win over unfinished Goal work", () => {
  for (const jobStatus of ["cancelled", "interrupted", "queued", "switching", "completed", "error"] as const) {
    assert.equal(decideGoalContinuation(base({ jobStatus })).shouldContinue, false, jobStatus);
  }
  for (const jobStatus of ["waiting_input", "waiting_for_user"] as const) {
    assert.equal(decideGoalContinuation(base({ jobStatus })).reason, "waiting_for_user");
  }
  assert.equal(decideGoalContinuation(base({ pendingQuestion: { id: "question" } })).reason, "waiting_for_user");
  assert.equal(decideGoalContinuation(base({ pendingApproval: { id: "approval" } })).reason, "waiting_for_user");
  assert.equal(decideGoalContinuation(base({ outcome: "error" })).reason, "error");
  assert.equal(decideGoalContinuation(base({ outcome: "cancelled" })).shouldContinue, false);
});

test("the original deadline and bounded continuation count prevent infinite loops", () => {
  const now = Date.parse("2026-10-31T10:00:00.000Z");
  assert.equal(decideGoalContinuation(base({ now, runtimeDeadlineAt: new Date(now).toISOString() })).reason, "runtime_limit");
  assert.equal(decideGoalContinuation(base({ now, runtimeDeadlineAt: new Date(now - 1).toISOString() })).reason, "runtime_limit");
  assert.equal(decideGoalContinuation(base({ now, runtimeDeadlineAt: "invalid" })).reason, "runtime_limit");
  assert.equal(decideGoalContinuation(base({ continuationCount: MAX_GOAL_CONTINUATIONS })).reason, "continuation_limit");
  for (const continuationCount of [-1, NaN, 0.5]) {
    assert.equal(decideGoalContinuation(base({ continuationCount })).reason, "continuation_limit");
  }
  const finalAllowed = decideGoalContinuation(base({
    now, runtimeDeadlineAt: new Date(now + 1000).toISOString(), continuationCount: MAX_GOAL_CONTINUATIONS - 1,
  }));
  assert.equal(finalAllowed.shouldContinue, true);
  if (finalAllowed.shouldContinue) assert.equal(finalAllowed.nextContinuationCount, MAX_GOAL_CONTINUATIONS);
});

test("normalized successful result parts override stale pending input", () => {
  const pending = taskTool("same", [{ content: "Verify export", status: "pending" }]);
  const completed: ChatMessage = {
    ...message("current", [pending]),
    parts: [{ ...pending, type: "tool", result: JSON.stringify({ todos: [{ content: "Verify export", status: "completed" }] }) }],
  };
  assert.equal(decideGoalContinuation(base({ messages: [completed] })).reason, "complete");
});

test("continuation context is bounded while the decision retains the full task state", () => {
  const tasks = Array.from({ length: 30 }, (_, index) => ({ content: "Task " + index + " " + "x".repeat(1000), status: "pending" }));
  const decision = decideGoalContinuation(base({ goal: "goal-" + "g".repeat(10000), messages: [message("current", [taskTool("tasks", tasks)])] }));
  assert.equal(decision.shouldContinue, true);
  if (!decision.shouldContinue) return;
  assert.equal(decision.remaining.length, 30);
  assert.ok(decision.prompt.length < 16000);
  assert.match(decision.prompt, /Task 19/);
  assert.doesNotMatch(decision.prompt, /Task 20 /);
});
