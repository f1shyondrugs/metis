import assert from "node:assert/strict";
import test from "node:test";
import { projectQuestionTranscript, questionAnswerAnchor } from "../lib/question-transcript";
import { reconcileChatMessageWindow } from "../lib/chat-message-window";
import { chatNavigationSnapshot } from "../lib/chat-navigation-snapshot";
import type { ChatMessage, MessagePart } from "../lib/store";
type TranscriptMessage = Parameters<typeof projectQuestionTranscript>[0][number];
type IndexedMessage = Omit<ChatMessage, "parts"> & { parts?: Array<MessagePart & { transcriptIndex?: number }> };

const text = (content: string, transcriptIndex?: number) => ({ type: "text" as const, content, ...(transcriptIndex === undefined ? {} : { transcriptIndex }) });
const response = (id: string, anchor?: ReturnType<typeof questionAnswerAnchor>) => ({ id: "question-answer-" + id, role: "user", content: "Answer " + id, ...(anchor ? { questionAnswer: { questionId: id, ...anchor } } : {}) });
const contents = (messages: Parameters<typeof projectQuestionTranscript>[0]) => projectQuestionTranscript(messages).map(item => item.content).filter(Boolean);

test("persisted tool anchors include an absolute cursor, including already windowed sources", () => {
  const source = { id: "assistant", role: "assistant", content: "Before.", eventOffset: 10, parts: [text("Before."), { type: "tool", id: "ask", name: "ask_user" }] };
  assert.deepEqual(questionAnswerAnchor([source], "q"), { assistantMessageId: source.id, toolCallId: "ask", cursor: { partIndex: 12 } });
});

test("legacy tool-only anchors remain before a partial continuation and regain their exact position on expansion", () => {
  const source = { id: "assistant", role: "assistant", content: "Before.After.", parts: [text("Before."), { type: "tool", id: "ask", name: "research_plan" }, ...Array.from({length: 30}, (_, index) => ({ type: "tool", id: "read-" + index, name: "read_file" })), text("After.")] };
  const answer = response("q", { assistantMessageId: source.id, toolCallId: "ask" });
  const tail = { ...source, content: "After.", parts: source.parts.slice(9), eventOffset: 9, eventsUrl: "/earlier" };
  assert.deepEqual(contents([tail, answer]), ["Answer q", "After."]);
  assert.deepEqual(contents([source, answer]), ["Before.", "Answer q", "After."]);
  tail.parts.push(text(" Continued.")); tail.content += " Continued.";
  assert.deepEqual(contents(JSON.parse(JSON.stringify([tail, answer]))), ["Answer q", "After. Continued."]);
});

test("absolute cursors resolve within a loaded tail and after filtered provider parts", () => {
  const tail = { id: "assistant", role: "assistant", content: "Before.After.", eventOffset: 20, parts: [text("Before.", 23), {type: "tool", id: "hidden-provider", name: "functions.exec", transcriptIndex: 25}, text("After.", 30)] };
  const afterTool = response("tool", { assistantMessageId: tail.id, cursor: {partIndex: 26} });
  assert.deepEqual(contents([tail, afterTool]), ["Before.", "Answer tool", "After."]);
  const withinText = response("text", { assistantMessageId: tail.id, cursor: {partIndex: 30, textOffset: 2} });
  assert.deepEqual(contents([tail, withinText]), ["Before.Af", "Answer text", "ter."]);
  const hiddenPrefix = response("prefix", { assistantMessageId: tail.id, cursor: {partIndex: 2} });
  assert.deepEqual(contents([tail, hiddenPrefix]), ["Answer prefix", "Before.After."]);
});

test("visible tool identity beats a stale cursor and hidden-prefix answers retain submission order", () => {
  const source = { id: "assistant", role: "assistant", content: "Before.After.", eventOffset: 10, parts: [text("Before.",10), {type:"tool",id:"ask",name:"ask_user",transcriptIndex:11}, text("After.",12)] };
  const answer = response("q", {assistantMessageId:source.id,toolCallId:"ask",cursor:{partIndex:0}});
  assert.deepEqual(contents([source,answer]), ["Before.","Answer q","After."]);
  const first = response("first", {assistantMessageId:source.id,cursor:{partIndex:2}}), second = response("second", {assistantMessageId:source.id,cursor:{partIndex:5}});
  assert.deepEqual(contents([source,first,second]), ["Answer first","Answer second","Before.After."]);
});

test("legacy generated answers can recover a deferred boundary but never cross a new user prompt", () => {
  const source={id:"assistant",role:"assistant",content:"After.",eventOffset:24,parts:[text("After.")]};
  assert.deepEqual(contents([source,response("legacy")]), ["Answer legacy","After."]);
  const prompt={id:"normal-user",role:"user",content:"Unrelated next prompt"};
  assert.deepEqual(contents([source,prompt,response("legacy")]), ["After.","Unrelated next prompt","Answer legacy"]);
  const normal={id:"normal-reply",role:"user",content:"A normal reply"};
  assert.deepEqual(contents([source,normal]), ["After.","A normal reply"]);
});

test("unloaded sources and unknown future cursor positions do not lose or clamp answers", () => {
  const source={id:"assistant",role:"assistant",content:"After.",eventOffset:20,parts:[text("After.")]};
  const future=response("future",{assistantMessageId:source.id,cursor:{partIndex:999}});
  assert.deepEqual(projectQuestionTranscript([source,future]),[source,future]);
  const absent=response("absent",{assistantMessageId:"not-loaded",toolCallId:"ask",cursor:{partIndex:2}});
  assert.deepEqual(projectQuestionTranscript([source,absent]),[source,absent]);
});

test("fresh streaming parts follow preserved indexes after compatibility events were filtered", () => {
  const raw: ChatMessage = { id: "assistant", role: "assistant", createdAt: "2026-01-01", eventOffset: 8, content: "Hidden.Before.", parts: [
    {type: "tool", id: "noise", name: "noise", status: "completed"}, text("Before.")
  ] };
  const source = { ...raw, ...reconcileChatMessageWindow(raw, part => part.type !== "tool" || part.id !== "noise") };
  source.parts.push({type: "tool", id: "opaque", name: "functions.exec", status: "running"}, text("After."));
  source.content += "After.";
  const answer = response("q", {assistantMessageId: source.id, cursor: {partIndex: 11}});
  assert.deepEqual(contents([source, answer]), ["Before.", "Answer q", "After."]);
  assert.deepEqual(questionAnswerAnchor([source], "next", {cursorFallback: true}), {assistantMessageId: source.id, cursor: {partIndex: 11, textOffset: 6}});
});

test("navigation cache cursors follow the first retained canonical event after filtering", () => {
  const source: IndexedMessage = { id: "assistant", role: "assistant", createdAt: "2026-01-01", content: "Result.", eventOffset: 10,
    parts: [...Array.from({length: 30}, (_, index) => ({type: "tool" as const, id: "read-" + index, name: "read_file", status: "completed", transcriptIndex: index + 10 + (index >= 2 ? 3 : 0)})), {type: "text", content: "Result.", transcriptIndex: 43}]
  };
  const cached = chatNavigationSnapshot({messages: [source]}, "chat").messages[0];
  assert.equal(cached.eventOffset, 20);
  assert.match(cached.eventsUrl!, /before=20$/);
  const restored = {...cached, ...reconcileChatMessageWindow(cached)};
  const answer = response("q", {assistantMessageId: source.id, cursor: {partIndex: 24}});
  const view = projectQuestionTranscript([restored, answer]);
  assert.equal(view.filter(message => message.id === answer.id).length, 1);
  assert.ok(view.findIndex(message => message.id === answer.id) < view.findIndex(message => message.content === "Result."));
});

test("only the original assistant segment keeps history controls", () => {
  const source={id:"assistant",role:"assistant",content:"Before.After.",eventsUrl:"/earlier",contentUrl:"/full",eventOffset:20,parts:[text("Before."),text("After.")]};
  const answer=response("q",{assistantMessageId:source.id,cursor:{partIndex:21}});
  const projected=projectQuestionTranscript<TranscriptMessage>([source,answer]);
  assert.equal(projected[0].eventsUrl,"/earlier"); assert.equal(projected[0].contentUrl,"/full");
  assert.equal(projected[2].eventsUrl,undefined); assert.equal(projected[2].contentUrl,undefined);
  assert.equal(projected[2].id,source.id+":after:"+answer.id);
});
