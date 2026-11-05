import assert from "node:assert/strict";
import test from "node:test";
import { projectQuestionTranscript, questionAnswerAnchor } from "../lib/question-transcript";
import { projectChatTranscript } from "../lib/chat-program-events";

type Message = Parameters<typeof projectQuestionTranscript>[0][number] & { streaming?: boolean; runMetadata?: { completedAt: string }; attachments?: unknown[]; transcriptSourceId?: string };
const answer = (id: string): Message => ({ id: "question-answer-" + id, role: "user", content: "Answer " + id });
const text = (content: string) => ({ type: "text", content });
const ask = (id: string, questionId?: string) => ({ type: "tool", id, name: "mcp__metis_ai__ask_user", status: "completed", ...(questionId ? { result: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ questionId }) }] }) } : {}) });

test("answer sits immediately after ask_user, before later tools and final text, without mutating stored messages", () => {
  const original: Message[] = [
    { id: "prompt", role: "user", content: "Diagnose" },
    { id: "assistant", role: "assistant", content: "Before.After.", parts: [text("Before."), ask("call", "q"), { type: "tool", id: "read", name: "read_file" }, text("After.")], runMetadata: { completedAt: "now" }, attachments: [{ id: "image" }] },
    answer("q"), { id: "next", role: "user", content: "Continue" },
  ];
  const copy = structuredClone(original);
  const projected = projectQuestionTranscript(original);
  assert.deepEqual(projected.map(m => m.id), ["prompt", "assistant", "question-answer-q", "assistant:after:question-answer-q", "next"]);
  assert.equal(projected[1].content, "Before.");
  assert.equal(projected[3].content, "After.");
  assert.equal(projected[1].runMetadata, undefined);
  assert.equal(projected[1].attachments, undefined);
  assert.deepEqual(projected[3].runMetadata, { completedAt: "now" });
  assert.equal(projected[3].transcriptSourceId, "assistant");
  assert.deepEqual(projected[3].tools?.map(t => t.id), ["read"]);
  assert.deepEqual(original, copy);
  assert.equal(projectChatTranscript(projected).filter(item => item.kind === "message").length, 5);
});

test("wrapped MCP questions split live continuation before the result arrives and survive reload", () => {
  for (const tool of [
    { ...ask("wrapped"), name: "mcp", input: JSON.stringify({ toolName: "ask_user", arguments: { questions: [{ question: "Which option?" }] } }) },
    { ...ask("wrapped"), name: "CallMcpTool", input: JSON.stringify({ CallMcpTool: { toolName: "ask_user", arguments: {} } }) },
  ]) {
    const message: Message = { id: "assistant", role: "assistant", content: "Before", parts: [text("Before"), tool], streaming: true };
    const anchor = questionAnswerAnchor([message], "wrapped-q");
    assert.deepEqual(anchor, { assistantMessageId: "assistant", toolCallId: "wrapped", cursor: { partIndex: 2 } });
    const response = { ...answer("wrapped-q"), questionAnswer: { questionId: "wrapped-q", ...anchor } };
    const waiting = projectQuestionTranscript([message, response]);
    assert.deepEqual(waiting.map(m => m.id), ["assistant", response.id]);
    message.content += "Continued";
    message.parts = [...message.parts!, { type: "tool", id: "read", name: "read_file" }, text("Continued")];
    const continued = projectQuestionTranscript([message, response]);
    assert.deepEqual(continued.map(m => m.content), ["Before", "Answer wrapped-q", "Continued"]);
    assert.equal(continued[0].streaming, false);
    assert.equal(continued[2].streaming, true);
    assert.equal(continued[2].transcriptSourceId, message.id);
    assert.deepEqual(projectQuestionTranscript(JSON.parse(JSON.stringify([message, response]))), continued);
  }
});

test("legacy wrapped questions match only real question tools, including multiple answers", () => {
  const wrapped = (id: string) => ({ ...ask(id), name: "mcp", input: JSON.stringify({ toolName: "ask_user", arguments: {} }) });
  const messages: Message[] = [
    { id: "assistant", role: "assistant", content: "OneTwoThree", parts: [text("One"), wrapped("first"), text("Two"), wrapped("second"), text("Three")] },
    answer("first-q"), answer("second-q"),
  ];
  assert.deepEqual(projectQuestionTranscript(messages).map(m => m.content), ["One", "Answer first-q", "Two", "Answer second-q", "Three"]);
  const unrelated: Message[] = [{ id: "other", role: "assistant", content: "Result", parts: [
    { type: "tool", id: "read", name: "mcp", input: JSON.stringify({ toolName: "read_file", arguments: { questionId: "q", text: "ask_user" } }) },
  ] }, answer("q")];
  assert.deepEqual(projectQuestionTranscript(unrelated), unrelated);
});

test("old persisted chats with deferred raw results anchor multiple answers in the same assistant turn", () => {
  const messages: Message[] = [
    { id: "assistant", role: "assistant", content: "OneTwoThree", parts: [text("One"), ask("first"), text("Two"), ask("second"), text("Three")], streaming: true },
    answer("first-q"), answer("second-q"),
  ];
  const projected = projectQuestionTranscript(messages);
  assert.deepEqual(projected.map(m => m.content), ["One", "Answer first-q", "Two", "Answer second-q", "Three"]);
  assert.equal(projected.filter(m => m.streaming).length, 1);
  assert.deepEqual(questionAnswerAnchor(messages.slice(0, 2), "second-q"), { assistantMessageId: "assistant", toolCallId: "second", cursor: { partIndex: 4 } });
  assert.deepEqual(projectQuestionTranscript(JSON.parse(JSON.stringify(messages))), projected);
});

test("persisted anchors win over ambiguous history and remain usable before the result arrives", () => {
  const messages: Message[] = [
    { id: "assistant", role: "assistant", content: "", parts: [ask("cancelled"), ask("answered"), text("Next")] },
    { ...answer("q"), questionAnswer: { questionId: "q", assistantMessageId: "assistant", toolCallId: "answered" } },
  ];
  const projected = projectQuestionTranscript(messages);
  assert.equal(projected[0].parts?.length, 2);
  assert.equal(projected[1].id, "question-answer-q");
  assert.equal(projected[2].content, "Next");
  const missing = { ...messages[1], questionAnswer: { questionId: "q", assistantMessageId: "not-loaded", toolCallId: "answered" } };
  assert.deepEqual(projectQuestionTranscript([messages[0], missing]), [messages[0], missing]);
});

test("answers for other chats, normal user messages, failed tools and unknown results remain in place", () => {
  const messages: Message[] = [
    { id: "assistant", role: "assistant", content: "ask_user in prose", parts: [{ ...ask("failed"), status: "error", result: "not JSON" }, { type: "tool", id: "other", name: "read_file", result: '{"questionId":"q"}' }] },
    answer("q"), { id: "normal-user", role: "user", content: "Answer q" },
  ];
  assert.deepEqual(projectQuestionTranscript(messages), messages);
  assert.equal(questionAnswerAnchor([], "q"), undefined);
});

test("legacy flat tools and an ask at the end render one answer, with stable segment IDs as streaming continues", () => {
  const flat: Message[] = [{ id: "flat", role: "assistant", content: "Result", tools: [ask("flat-call", "q")] }, answer("q")];
  assert.deepEqual(projectQuestionTranscript(flat).map(m => m.content), ["", "Answer q", "Result"]);
  const message: Message = { id: "assistant", role: "assistant", content: "Before", parts: [text("Before"), ask("call")] };
  assert.deepEqual(projectQuestionTranscript([message, answer("q")]).map(m => m.id), ["assistant", "question-answer-q"]);
  message.parts = [...message.parts!, text("Continued")];
  const projected = projectQuestionTranscript([message, answer("q")]);
  assert.equal(projected[2].id, "assistant:after:question-answer-q");
  assert.equal(projected.filter(m => m.id === "question-answer-q").length, 1);
});
