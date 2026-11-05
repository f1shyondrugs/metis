import assert from "node:assert/strict";
import test from "node:test";
import { projectQuestionTranscript, questionAnswerAnchor } from "../lib/question-transcript";

const text = (content: string) => ({ type: "text", content });
const answer = (questionId: string, anchor: ReturnType<typeof questionAnswerAnchor>) => ({
  id: "question-answer-" + questionId, role: "user", content: "Answer " + questionId,
  questionAnswer: { questionId, ...anchor },
});

test("research plan approval splits the assistant at its real question tool", () => {
  const source = {
    id: "assistant", role: "assistant", content: "Proposed research.Report.",
    parts: [text("Proposed research."), { type: "tool", id: "review", name: "research_plan", status: "running" }, text("Report.")],
  };
  const anchor = questionAnswerAnchor([source], "review-question");
  assert.deepEqual(anchor, { assistantMessageId: "assistant", toolCallId: "review", cursor: { partIndex: 2 } });
  const projected = projectQuestionTranscript([source, answer("review-question", anchor)]);
  assert.deepEqual(projected.map(item => item.content), ["Proposed research.", "Answer review-question", "Report."]);
});

test("submission cursor stays between text before an answer and text later appended to the same part", () => {
  const source = { id: "assistant", role: "assistant", content: "Before.", parts: [text("Before.")], streaming: true };
  const anchor = questionAnswerAnchor([source], "opaque", { cursorFallback: true });
  assert.deepEqual(anchor, { assistantMessageId: "assistant", cursor: { partIndex: 0, textOffset: 7 } });
  const response = answer("opaque", anchor);
  const waiting = projectQuestionTranscript([source, response]);
  assert.deepEqual(waiting.map(item => item.content), ["Before.", "Answer opaque"]);
  source.content = "Before.After.";
  source.parts = [text("Before.After.")];
  const messages = [source, response];
  const projected = projectQuestionTranscript(messages);
  assert.deepEqual(projected.map(item => item.content), ["Before.", "Answer opaque", "After."]);
  assert.equal("streaming" in projected[0] ? projected[0].streaming : undefined, false);
  assert.equal("streaming" in projected[2] ? projected[2].streaming : undefined, true);
  assert.deepEqual(projectQuestionTranscript(JSON.parse(JSON.stringify(messages))), projected);
  assert.equal(source.parts[0].content, "Before.After.");
});

test("questions inside one opaque tool retain answer order before continuation and after reload", () => {
  const source = {
    id: "assistant", role: "assistant", content: "Before.",
    parts: [text("Before."), { type: "tool", id: "orchestration", name: "functions.exec", status: "running" }],
  };
  const anchor = questionAnswerAnchor([source], "first", { cursorFallback: true });
  assert.deepEqual(anchor, { assistantMessageId: "assistant", cursor: { partIndex: 2 } });
  const first = answer("first", anchor), second = answer("second", anchor);
  source.parts.push(text("After.") as typeof source.parts[number]);
  source.content += "After.";
  const messages = [source, first, second];
  const projected = projectQuestionTranscript(messages);
  assert.deepEqual(projected.map(item => item.content), ["Before.", "Answer first", "Answer second", "After."]);
  assert.equal(projected.filter(item => item.id === first.id).length, 1);
  assert.deepEqual(projectQuestionTranscript(JSON.parse(JSON.stringify(messages))), projected);
});

test("missing cursor source and malformed cursors never move or lose an answer", () => {
  const source = { id: "assistant", role: "assistant", content: "After.", parts: [text("After.")] };
  const missing = answer("missing", { assistantMessageId: "not-loaded", cursor: { partIndex: 1 } });
  assert.deepEqual(projectQuestionTranscript([source, missing]), [source, missing]);
  const invalid = answer("invalid", { assistantMessageId: "assistant", cursor: { partIndex: -1 } });
  assert.deepEqual(projectQuestionTranscript([source, invalid]), [source, invalid]);
  assert.equal(questionAnswerAnchor([], "absent", { cursorFallback: true }), undefined);
});
