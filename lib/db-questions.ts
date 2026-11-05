import { randomUUID } from "node:crypto";
import { getDatabase, transaction } from "@/lib/sqlite";
import { normalizeAskUserInput, normalizeQuestionAnswers, questionSummary, type AgentQuestion, type QuestionInput, type AskUserInput, type QuestionForm, type QuestionValue } from "@/lib/question-contract";

type QuestionStatus = "waiting_for_user" | "answered" | "cancelled" | "expired";

type StoredQuestion = QuestionForm & {
  questionId: string;
  runId?: string;
  jobId?: string;
  version: number;
  status: QuestionStatus;
  expiresAt?: string;
  questions: AgentQuestion[];
  answers?: string[];
  values?: Record<string, QuestionValue>;
  summary?: string;
  /** Explicit form dismissal is a response; cancelling the run is not. */
  cancelled?: true;
};

export function questionLimits() {
  return {
    maxQuestions: 24,
    maxAnswerLength: 4_000,
  };
}

function parseStored(data: unknown): StoredQuestion | null {
  if (!data || typeof data !== "object") return null;
  try {
    const item = JSON.parse(String((data as { data?: unknown }).data || "")) as StoredQuestion;
    return item && typeof item.questionId === "string" && Array.isArray(item.questions) ? item : null;
  } catch {
    return null;
  }
}

function answerFallback(status: QuestionStatus, count: number) {
  const message = status === "expired"
    ? "[No answer received before the question timed out.]"
    : "[The question was cancelled.]";
  return Array.from({ length: count }, () => message);
}

export function createPendingQuestion(
  input: QuestionInput[] | AskUserInput,
  chatId: string,
  userId?: string,
  context: { jobId?: string; runId?: string } = {},
) {
  const normalized = normalizeAskUserInput(Array.isArray(input) ? { questions: input } : input);
  const { questions: fields, ...form } = normalized;
  const questions: AgentQuestion[] = fields.map((item) => ({ ...item, id: randomUUID(), options: item.options as AgentQuestion["options"] }));
  const questionId = randomUUID();
  const version = 1;
  const stored: StoredQuestion = {
    ...form,
    questionId,
    ...(context.jobId ? { jobId: context.jobId } : {}),
    ...(context.runId ? { runId: context.runId } : {}),
    version,
    status: "waiting_for_user",
    questions,
  };
  const timestamp = new Date().toISOString();
  getDatabase().prepare(
    `INSERT INTO pending_questions
      (question_id, chat_id, user_id, data, created_at, run_id, job_id, version, expires_at, status, heartbeat_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    questionId,
    chatId,
    userId ?? null,
    JSON.stringify(stored),
    timestamp,
    context.runId ?? null,
    context.jobId ?? null,
    version,
    null,
    stored.status,
    timestamp,
  );
  let stopped = false;
  const promise = (async () => {
    while (!stopped) {
      const row = getDatabase().prepare(
        "SELECT data, status, expires_at as expiresAt FROM pending_questions WHERE question_id = ?",
      ).get(questionId) as { data?: string; status?: QuestionStatus; expiresAt?: string } | undefined;
      const data = parseStored(row);
      if (!data) return answerFallback("cancelled", questions.length);
      if (data.status === "answered" && data.answers) return data.answers;
      if (data.status === "cancelled" || data.status === "expired") {
        return data.answers || answerFallback(data.status, questions.length);
      }
      getDatabase().prepare(
        "UPDATE pending_questions SET heartbeat_at = ? WHERE question_id = ? AND status = 'waiting_for_user'",
      ).run(new Date().toISOString(), questionId);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return answerFallback("cancelled", questions.length);
  })();
  return {
    ...form,
    questionId,
    questions,
    version,
    promise,
    stop: () => {
      stopped = true;
    },
  };
}

export type ResolvedQuestion = {
  questionId: string;
  chatId: string;
  jobId?: string;
  runId?: string;
  version: number;
  status: QuestionStatus;
  answers: string[];
  values?: Record<string, QuestionValue>;
  summary?: string;
  heartbeatAt?: string;
  cancelled?: true;
};

export function resolveQuestion(
  questionId: string,
  answers: unknown,
  userId?: string,
  expectedVersion?: number,
): ResolvedQuestion | false {
  return transaction(() => {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT chat_id as chatId, data, user_id as userId, version, status, heartbeat_at as heartbeatAt
       FROM pending_questions WHERE question_id = ?`,
    ).get(questionId) as {
      chatId?: string;
      data?: string;
      userId?: string;
      version?: number;
      status?: QuestionStatus;
      heartbeatAt?: string;
    } | undefined;
    if (!row?.data || (userId && row.userId !== userId)) return false;
    const data = parseStored({ data: row.data });
    if (!data || !row.chatId) return false;
    if (data.status === "answered" && data.answers) {
      return { questionId, chatId: row.chatId, ...(data.jobId ? { jobId: data.jobId } : {}), ...(data.runId ? { runId: data.runId } : {}), version: data.version, status: data.status, answers: data.answers, values: data.values, summary: data.summary, heartbeatAt: row.heartbeatAt };
    }
    if (expectedVersion !== undefined && expectedVersion !== (row.version || data.version)) return false;
    if (data.status !== "waiting_for_user") return false;
    let result;
    try { result = normalizeQuestionAnswers(data.questions, answers); } catch { return false; }
    const normalized = result.answers;
    const summary = questionSummary(data, data.questions, result.values);
    const updated: StoredQuestion = { ...data, answers: normalized, values: result.values, summary, status: "answered", version: data.version + 1 };
    const changed = db.prepare(
      `UPDATE pending_questions
       SET data = ?, version = ?, status = ?, heartbeat_at = ?
       WHERE question_id = ? AND status = 'waiting_for_user' AND version = ?`,
    ).run(JSON.stringify(updated), updated.version, updated.status, new Date().toISOString(), questionId, data.version);
    if (!changed.changes) return false;
    return {
      questionId,
      chatId: row.chatId,
      ...(data.jobId ? { jobId: data.jobId } : {}),
      ...(data.runId ? { runId: data.runId } : {}),
      version: updated.version,
      status: updated.status,
      answers: normalized,
      values: result.values,
      summary,
      heartbeatAt: row.heartbeatAt,
    };
  });
}

export function cancelQuestionAsResponse(questionId: string, userId?: string, expectedVersion?: number): ResolvedQuestion | false {
  return transitionQuestion(questionId, "cancelled", userId, { response: true, expectedVersion });
}

export function cancelQuestion(questionId: string, userId?: string): ResolvedQuestion | false {
  return transitionQuestion(questionId, "cancelled", userId);
}

function transitionQuestion(questionId: string, status: "cancelled" | "expired", userId?: string, options: { response?: boolean; expectedVersion?: number } = {}): ResolvedQuestion | false {
  return transaction(() => {
    const db = getDatabase();
    const row = db.prepare(
      "SELECT chat_id as chatId, user_id as userId, data, version, status, heartbeat_at as heartbeatAt FROM pending_questions WHERE question_id = ?",
    ).get(questionId) as { chatId?: string; userId?: string; data?: string; version?: number; status?: QuestionStatus; heartbeatAt?: string } | undefined;
    if (!row?.chatId || !row.data || (userId && row.userId !== userId)) return false;
    const data = parseStored({ data: row.data });
    if (!data) return false;
    if (data.status === status && data.answers && (!options.response || data.cancelled)) {
      return { cancelled: data.cancelled, questionId, chatId: row.chatId, ...(data.jobId ? { jobId: data.jobId } : {}), ...(data.runId ? { runId: data.runId } : {}), version: data.version, status, answers: data.answers, values: data.values, summary: data.summary, heartbeatAt: row.heartbeatAt };
    }
    if (data.status !== "waiting_for_user" || options.expectedVersion !== undefined && options.expectedVersion !== data.version) return false;
    const answers = options.response ? data.questions.map(() => "User cancelled") : answerFallback(status, data.questions.length);
    const updated: StoredQuestion = { ...data, status, version: data.version + 1, answers,
      ...(options.response ? { cancelled: true, values: {}, summary: "User cancelled" } : {}),
    };
    db.prepare(
      "UPDATE pending_questions SET data = ?, version = ?, status = ?, heartbeat_at = ? WHERE question_id = ? AND status = 'waiting_for_user' AND version = ?",
    ).run(JSON.stringify(updated), updated.version, status, new Date().toISOString(), questionId, data.version);
    return {
      questionId,
      chatId: row.chatId,
      ...(data.jobId ? { jobId: data.jobId } : {}),
      ...(data.runId ? { runId: data.runId } : {}),
      version: updated.version,
      status,
      answers,
      cancelled: updated.cancelled,
      values: updated.values,
      summary: updated.summary,
      heartbeatAt: row.heartbeatAt,
    };
  });
}

export function getPendingQuestion(questionId: string, userId?: string) {
  const row = getDatabase().prepare(
    "SELECT chat_id as chatId, user_id as userId, data, heartbeat_at as heartbeatAt FROM pending_questions WHERE question_id = ?",
  ).get(questionId) as { chatId?: string; userId?: string; data?: string; heartbeatAt?: string } | undefined;
  if (!row?.data || (userId && row.userId !== userId)) return null;
  const data = parseStored({ data: row.data });
  return data && row.chatId ? { ...data, chatId: row.chatId, heartbeatAt: row.heartbeatAt } : null;
}

export function deletePendingQuestion(questionId: string) {
  getDatabase().prepare("DELETE FROM pending_questions WHERE question_id = ? AND status <> 'waiting_for_user'").run(questionId);
}
