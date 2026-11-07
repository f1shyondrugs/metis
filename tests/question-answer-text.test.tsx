import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { QuestionAnswerText, questionAnswerFields } from "../components/question-answer-text";
import { questionAnswerDisplay, type AgentQuestion } from "../lib/question-contract";

Object.assign(globalThis, { React });

test("question context precedes its readable answer, including typed and hidden fields", () => {
  const questions: AgentQuestion[] = [
    { id: "when", key: "when", question: "When: tonight or tomorrow?", type: "radio", options: [{ label: "Tonight: Saturday, 00:00", value: "tonight" }] },
    { id: "active", key: "active", question: "Enabled?", type: "toggle" },
    { id: "hidden", key: "hidden", question: "Hidden follow-up", showWhen: { key: "active", equals: true } },
    { id: "tasks", key: "tasks", question: "Steps", type: "task_list" },
  ];
  const summary = "Custom confirmation.";
  const display = questionAnswerDisplay(questions, { when: "tonight", active: false, hidden: "private", tasks: ["First", "Second"] }, summary);
  assert.deepEqual(display.fields, [
    { question: "When: tonight or tomorrow?", answer: "Tonight: Saturday, 00:00" },
    { question: "Enabled?", answer: "No" },
    { question: "Steps", answer: "1. First\n2. Second" },
  ]);
  const html = renderToStaticMarkup(<QuestionAnswerText content={summary} reference={{ questionId: "q", display }} />);
  assert.ok(html.indexOf("<dt") < html.indexOf("<dd"));
  assert.match(html, /When: tonight or tomorrow\?/);
  assert.match(html, /Tonight: Saturday, 00:00/);
  assert.doesNotMatch(html, /Hidden follow-up|private|Custom confirmation/);
});

test("legacy replies retain colons and multiline answers without styling ordinary messages", () => {
  const content = "Meinst du die kommende Nacht oder heute früh?: Kommende Nacht: Samstag, 07.11., 00:00 Uhr\nhttps://example.test/time";
  assert.deepEqual(questionAnswerFields(content, { questionId: "old" }), [{
    question: "Meinst du die kommende Nacht oder heute früh?",
    answer: "Kommende Nacht: Samstag, 07.11., 00:00 Uhr\nhttps://example.test/time",
  }]);
  assert.equal(questionAnswerFields(content), undefined);
  const ordinary = renderToStaticMarkup(<QuestionAnswerText content={content} />);
  assert.doesNotMatch(ordinary, /<dl/);
  assert.match(ordinary, /Meinst du die kommende Nacht/);
});

test("edited answers and cancellations keep their own content; form text stays escaped", () => {
  const display = { summary: "Original", fields: [{ question: "<script>Question</script>", answer: "<img onerror=alert(1)>" }] };
  assert.equal(questionAnswerFields("Edited answer", { questionId: "q", display }), undefined);
  assert.equal(questionAnswerFields("User cancelled", { questionId: "q" }), undefined);
  const html = renderToStaticMarkup(<QuestionAnswerText content="Original" reference={{ questionId: "q", display }} />);
  assert.match(html, /&lt;script&gt;Question&lt;\/script&gt;/);
  assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script|<img/);
});
