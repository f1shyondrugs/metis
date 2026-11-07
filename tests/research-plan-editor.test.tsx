import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskListInput } from "../components/task-list-input";
import { researchPlanForm, RESEARCH_WORKFLOW_TOOLS } from "../lib/mcp-core/research-workflow.mjs";
import { normalizeAskUserInput, normalizeStoredQuestions, initialQuestionAnswers, normalizeQuestionAnswers, questionSummary, restoreQuestionDraft } from "../lib/question-contract";
Object.assign(globalThis, { React });

function fixture() {
  const form = normalizeAskUserInput(researchPlanForm({ title: "Vergleich", plan: ["Kosten prüfen", "Quellen vergleichen", "Bericht erstellen"], language: "de" }));
  return { ...form, questionId: "review-fixture", questions: normalizeStoredQuestions(form.questions) };
}
test("JSON plans become numbered read-only lists with a pencil instead of a plaintext textarea", () => {
  const form = fixture();
  const properties = RESEARCH_WORKFLOW_TOOLS[0].inputSchema.properties as { plan: { type: string } };
  assert.equal(properties.plan.type, "array");
  assert.equal(form.language, "en");
  const answers = initialQuestionAnswers(form.questions);
  const html = renderToStaticMarkup(<TaskListInput id="plan" value={answers[0]} language={form.language} onChange={() => {}} />);
  assert.match(html, /<ol/);
  assert.equal((html.match(/<li /g) || []).length, 3);
  assert.match(html, /1\./);
  assert.match(html, /3\./);
  assert.match(html, />Edit</);
  assert.doesNotMatch(html, /Bearbeiten|Schritt hinzufügen/);
  assert.doesNotMatch(html, /<textarea|\[&quot;Kosten/);
  const disabled = renderToStaticMarkup(<TaskListInput id="locked" value={answers[0]} disabled onChange={() => {}} />);
  assert.match(disabled, /disabled=""/);
});
test("reordered, added and edited tasks round-trip through drafts and typed answers without losing order", () => {
  const form = fixture();
  const edited = ["Bericht erstellen", "Nur Hessen prüfen", "Kosten prüfen", "Methodik ergänzen"];
  const answer = normalizeQuestionAnswers(form.questions, { plan: edited, decision: "approve", source_target: 200, minimum_words: 4000 });
  assert.deepEqual(answer.values.plan, edited);
  assert.equal(questionSummary(form, form.questions, answer.values).includes("1. Bericht erstellen\n2. Nur Hessen prüfen"), true);
  const draft = restoreQuestionDraft(form, { questionDraftId: form.questionId, questionAnswers: answer.answers });
  assert.deepEqual(JSON.parse(draft.answers[0]), edited);
  assert.deepEqual(normalizeQuestionAnswers(form.questions, draft.answers).values.plan, edited);
});
test("malformed, blank, oversized and empty step lists cannot be submitted", () => {
  const form = fixture();
  for (const plan of [[], [""], ["  "], [false], [{ text: "forged" }], Array(21).fill("Step"), ["x".repeat(4001)], "not JSON"]) {
    assert.throws(() => normalizeQuestionAnswers(form.questions, { plan, decision: "approve", source_target: 200, minimum_words: 4000 }));
  }
  // The cap applies to actual text, not the transport's JSON quoting overhead.
  const long = ['"'.repeat(3999)];
  assert.deepEqual(normalizeQuestionAnswers(form.questions, { plan: long, decision: "approve", source_target: 200, minimum_words: 4000 }).values.plan, long);
});
test("legacy tool arguments still open the structured editor", () => {
  const form = researchPlanForm({ title: "Older session", plan: "- [ ] Source one\n2. Source two\n- [ ] Report" });
  assert.equal(form.questions[0].type, "task_list");
  assert.deepEqual(form.questions[0].default, ["Source one", "Source two", "Report"]);
});
