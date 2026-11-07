import { innerToolName } from "./tool-call-display";

type Tool = { id: string; name: string; input?: string; status?: string; result?: string };
type Part = { type: string; content?: string; id?: string; name?: string; input?: string; status?: string; result?: string; transcriptIndex?: number };

export type QuestionTranscriptCursor = { partIndex: number; textOffset?: number };
export type QuestionAnswerAnchor = { assistantMessageId: string; toolCallId?: string; cursor?: QuestionTranscriptCursor };
export type QuestionAnswerReference = { questionId: string; display?: import("./question-contract").QuestionAnswerDisplay } & Partial<QuestionAnswerAnchor>;
type TranscriptMessage = {
  id: string;
  role: string;
  content: string;
  parts?: readonly Part[];
  tools?: readonly Tool[];
  questionAnswer?: QuestionAnswerReference;
  eventOffset?: number;
  eventsUrl?: string;
  contentUrl?: string;
};

function isQuestionTool(part: Part) {
  return /(?:^|__|[/.])(?:ask_user|research_plan)$/.test(innerToolName(part.name ?? "", part.input, part.result));
}

function partsFor(message: TranscriptMessage): Part[] {
  const parts: readonly Part[] = message.parts?.length ? message.parts : [
    ...(message.tools ?? []).map(tool => ({ ...tool, type: "tool" })),
    ...(message.content ? [{ type: "text", content: message.content }] : []),
  ];
  let nextIndex = Math.max(0, message.eventOffset || 0);
  return parts.map(part => {
    const transcriptIndex = Number.isSafeInteger(part.transcriptIndex) && part.transcriptIndex! >= 0
      ? part.transcriptIndex! : nextIndex;
    nextIndex = transcriptIndex + 1;
    return { ...part, transcriptIndex };
  });
}

function resultQuestionId(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return;
  if (typeof value === "string") {
    if (value.length > 256_000) return;
    try { return resultQuestionId(JSON.parse(value), depth + 1); } catch { return; }
  }
  if (!value || typeof value !== "object") return;
  const object = value as { questionId?: unknown; content?: unknown; text?: unknown };
  if (typeof object.questionId === "string") return object.questionId;
  if (Array.isArray(object.content)) {
    for (const item of object.content) {
      const id = resultQuestionId(item, depth + 1);
      if (id) return id;
    }
  }
  if (typeof object.text === "string") return resultQuestionId(object.text, depth + 1);
}

function questionId(message: TranscriptMessage) {
  return message.role === "user"
    ? message.questionAnswer?.questionId || message.id.match(/^question-answer-(.+)$/)?.[1]
    : undefined;
}

/** Part identities remain absolute when reload keeps only a tail or hides provider noise. */
function absolutePartIndex(message: TranscriptMessage, part: Part, index: number) {
  return Number.isSafeInteger(part.transcriptIndex) && part.transcriptIndex! >= 0
    ? part.transcriptIndex! : Math.max(0, message.eventOffset || 0) + index;
}

function cursorPosition(message: TranscriptMessage, cursor: QuestionTranscriptCursor, parts: readonly Part[], positions: readonly number[]) {
  if (!validCursor(cursor)) return;
  const firstIndex = parts.length ? absolutePartIndex(message, parts[0], 0) : Math.max(0, message.eventOffset || 0);
  if (cursor.partIndex < firstIndex) return 0;
  for (let index = 0; index < parts.length; index++) {
    const absolute = absolutePartIndex(message, parts[index], index);
    if (absolute > cursor.partIndex) return positions[index];
    if (absolute === cursor.partIndex) {
      const part = parts[index];
      const offset = part.type === "text" && cursor.textOffset !== undefined
        ? Math.min(cursor.textOffset, partLength(part)) : 0;
      return positions[index] + offset;
    }
  }
  const endIndex = parts.length ? absolutePartIndex(message, parts.at(-1)!, parts.length - 1) + 1 : firstIndex;
  // A cursor after a hidden prefix belongs before the loaded continuation. A
  // genuinely unknown future position must not be clamped to the current end.
  if (cursor.partIndex === endIndex) return positions.at(-1)!;
}

function anchorPosition(message: TranscriptMessage, anchor: QuestionAnswerAnchor, parts = partsFor(message)) {
  const positions = [0];
  for (const part of parts) positions.push(positions.at(-1)! + partLength(part));
  if (anchor.toolCallId) {
    const index = parts.findIndex(part => part.type === "tool" && part.id === anchor.toolCallId);
    if (index >= 0) return positions[index + 1];
  }
  if (anchor.cursor) return cursorPosition(message, anchor.cursor, parts, positions);
}

function answerAnchors(messages: readonly TranscriptMessage[], options: { recoverDeferred?: boolean } = {}) {
  const calls = messages.flatMap((message, messageIndex) => message.role === "assistant"
    ? partsFor(message).flatMap((part, partIndex) => part.type === "tool" && part.id && isQuestionTool(part)
      ? [{ assistantMessageId: message.id, toolCallId: part.id, cursor: { partIndex: absolutePartIndex(message, part, partIndex) + 1 }, messageIndex, questionId: resultQuestionId(part.result), failed: part.status === "error" }]
      : [])
    : []);
  const used = new Set<string>();
  const anchors = new Map<string, QuestionAnswerAnchor>();
  const key = (call: QuestionAnswerAnchor) => JSON.stringify([call.assistantMessageId, call.toolCallId]);
  // Explicit persisted links and tool results win over historical chronological matching.
  for (const message of messages) {
    const id = questionId(message);
    if (!id) continue;
    const ref = message.questionAnswer;
    const call = calls.find(call => ref?.assistantMessageId && ref.toolCallId
      ? call.assistantMessageId === ref.assistantMessageId && call.toolCallId === ref.toolCallId
      : call.questionId === id);
    if (call && !used.has(key(call))) {
      anchors.set(message.id, { assistantMessageId: call.assistantMessageId, toolCallId: call.toolCallId, cursor: call.cursor });
      used.add(key(call));
      continue;
    }
    const source = ref?.assistantMessageId
      ? messages.find(source => source.role === "assistant" && source.id === ref.assistantMessageId) : undefined;
    if (source && validCursor(ref?.cursor)) {
      const anchor = { assistantMessageId: source.id, ...(ref.toolCallId ? { toolCallId: ref.toolCallId } : {}), cursor: ref.cursor };
      if (anchorPosition(source, anchor) !== undefined) anchors.set(message.id, anchor);
    } else if (source && ref?.toolCallId && (source.eventOffset || 0) > 0) {
      // Old answers only stored a tool ID. The referenced call is outside this
      // loaded tail; keep its answer before the visible continuation until the
      // reader expands the earlier activity, where the exact tool wins again.
      anchors.set(message.id, { assistantMessageId: source.id, toolCallId: ref.toolCallId, cursor: { partIndex: source.eventOffset! } });
    }
  }
  messages.forEach((message, index) => {
    if (!questionId(message) || anchors.has(message.id) || message.questionAnswer?.assistantMessageId) return;
    // Older transcripts defer raw tool results. Pair each answer with the first
    // remaining ask_user in the nearest preceding assistant turn, never another chat.
    const eligible = calls.filter(call => call.messageIndex < index && !call.failed && !used.has(key(call)));
    const nearest = eligible.at(-1)?.messageIndex;
    const call = eligible.find(call => call.messageIndex === nearest);
    if (call) {
      anchors.set(message.id, { assistantMessageId: call.assistantMessageId, toolCallId: call.toolCallId, cursor: call.cursor });
      used.add(key(call));
      return;
    }
    // Generated answer IDs identify historical form submissions even before
    // explicit references were persisted. Only the nearest assistant in this
    // user turn may supply a hidden-prefix boundary; never cross a new prompt.
    const preceding = messages.slice(0, index).reverse().find(source => source.role === "assistant" || (source.role === "user" && !questionId(source)));
    if (options.recoverDeferred !== false && preceding?.role === "assistant" && (preceding.eventOffset || 0) > 0) {
      anchors.set(message.id, { assistantMessageId: preceding.id, cursor: { partIndex: preceding.eventOffset! } });
    }
  });
  return anchors;
}

function validCursor(value: QuestionTranscriptCursor | undefined): value is QuestionTranscriptCursor {
  return Boolean(value && Number.isSafeInteger(value.partIndex) && value.partIndex >= 0 &&
    (value.textOffset === undefined || (Number.isSafeInteger(value.textOffset) && value.textOffset >= 0)));
}

/** Persist the link while the provider's tool result is still in flight. */
export function questionAnswerAnchor(
  messages: readonly TranscriptMessage[],
  id: string,
  options: { cursorFallback?: boolean } = {},
): QuestionAnswerAnchor | undefined {
  const answer = { id: "question-answer-" + id, role: "user", content: "" };
  const linked = answerAnchors([...messages, answer], { recoverDeferred: false }).get(answer.id);
  if (linked || !options.cursorFallback) return linked;
  // Some providers expose only an opaque orchestration tool, or persist its
  // tool part after the user answers. Save the actual submission position.
  const source = [...messages].reverse().find(message => message.role === "assistant");
  if (!source) return;
  const parts = partsFor(source);
  const last = parts.at(-1);
  return {
    assistantMessageId: source.id,
    cursor: last?.type === "text"
      ? { partIndex: absolutePartIndex(source, last, parts.length - 1), textOffset: (last.content ?? "").length }
      : { partIndex: last ? absolutePartIndex(source, last, parts.length - 1) + 1 : Math.max(0, source.eventOffset || 0) },
  };
}

function partLength(part: Part) {
  return part.type === "text" ? (part.content ?? "").length : 1;
}

function sliceParts(parts: readonly Part[], start: number, end: number) {
  const selected: Part[] = [];
  let position = 0;
  for (const part of parts) {
    const next = position + partLength(part);
    if (part.type === "text") {
      const content = (part.content ?? "").slice(Math.max(0, start - position), Math.max(0, end - position));
      if (content) selected.push({ ...part, content });
    } else if (position >= start && next <= end) selected.push(part);
    position = next;
    if (position >= end) break;
  }
  return selected;
}

/** Display-only splitting: keep the persisted/provider transcript unchanged. */
export function projectQuestionTranscript<T extends TranscriptMessage>(messages: readonly T[]): T[] {
  const anchors = answerAnchors(messages);
  if (!anchors.size) return [...messages];
  const answers = new Map<string, Array<{ answer: T; anchor: QuestionAnswerAnchor }>>();
  for (const message of messages) {
    const anchor = anchors.get(message.id);
    if (!anchor) continue;
    const entries = answers.get(anchor.assistantMessageId) ?? [];
    entries.push({ answer: message, anchor });
    answers.set(anchor.assistantMessageId, entries);
  }
  const result: T[] = [];
  for (const message of messages) {
    if (anchors.has(message.id)) continue;
    if (message.role !== "assistant") { result.push(message); continue; }
    const parts = partsFor(message);
    const positions = [0];
    for (const part of parts) positions.push(positions.at(-1)! + partLength(part));
    const total = positions.at(-1)!;
    const boundaries = (answers.get(message.id) ?? []).flatMap(({ answer, anchor }) => {
      const position = anchorPosition(message, anchor, parts);
      return position !== undefined ? [{ position, answer }] : [];
    }).sort((a, b) => a.position - b.position);
    if (!boundaries.length) { result.push(message); continue; }
    let start = 0;
    let segmentId = message.id;
    const segment = (end: number, last: boolean) => {
      const slice = sliceParts(parts, start, end);
      result.push({
        ...message, id: segmentId, transcriptSourceId: message.id, parts: slice,
        content: slice.filter(part => part.type === "text").map(part => part.content ?? "").join(""),
        tools: slice.filter(part => part.type === "tool"),
        thinking: undefined, thinkingDone: undefined, thinkingDurationMs: undefined,
        ...(segmentId === message.id ? {} : { eventsUrl: undefined, contentUrl: undefined }),
        ...(last ? {} : { streaming: false, runMetadata: undefined, suggestions: undefined, attachments: undefined }),
      } as T);
    };
    for (const boundary of boundaries) {
      // Several questions can be answered inside the same opaque provider call.
      // Their submission order stays stable even when their positions coincide.
      if (boundary.position > start || segmentId === message.id) segment(boundary.position, boundary.position === total);
      result.push(boundary.answer);
      start = boundary.position;
      segmentId = message.id + ":after:" + boundary.answer.id;
    }
    if (start < total) segment(total, true);
  }
  return result;
}
