import { z } from "zod";
import { ASK_USER_INPUT_SCHEMA } from "./mcp-core/question-schema.mjs";
import { normalizeTaskList } from "./mcp-core/task-list.mjs";

export type QuestionScalar = string | number | boolean;
export type QuestionValue = QuestionScalar | QuestionScalar[] | null;
export type QuestionType = "text" | "textarea" | "number" | "select" | "radio" | "multiselect" | "checkbox" | "toggle" | "slider" | "date" | "time" | "task_list";
export type QuestionOption = { label: string; value?: QuestionScalar; description?: string; icon?: string };
export type QuestionInput = {
  question: string; key?: string; type?: QuestionType; multiple?: boolean;
  options?: Array<QuestionOption | string>; required?: boolean; allowCustom?: boolean;
  default?: QuestionValue; description?: string; placeholder?: string; icon?: string;
  unit?: string; group?: string; width?: "half" | "full";
  min?: number; max?: number; step?: number; maxLength?: number;
  showWhen?: { key: string; equals: QuestionScalar };
};
export type AgentQuestion = Omit<QuestionInput, "options"> & { id: string; options?: QuestionOption[] };
export type QuestionForm = { language?: string; title?: string; description?: string; submitLabel?: string; responseTemplate?: string; columns?: 1 | 2 };
export type AskUserInput = QuestionForm & { questions: QuestionInput[] };
export type PendingChatQuestion = QuestionForm & {
  questionId: string; runId?: string; jobId?: string; version?: number; expiresAt?: string;
  status?: "waiting_for_user" | "answered" | "cancelled" | "expired"; questions: AgentQuestion[];
};
export type QuestionAnswers = { answers: string[]; values: Record<string, QuestionValue> };
export type QuestionAnswerDisplay = { summary: string; fields: Array<{ question: string; answer: string }> };
export class QuestionValidationError extends Error {
  constructor(message: string, public fieldErrors: Record<string, string> = {}) { super(message); this.name = "QuestionValidationError"; }
}
const inputValidator = z.fromJSONSchema(ASK_USER_INPUT_SCHEMA as Parameters<typeof z.fromJSONSchema>[0]);
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
export function questionKey(question: AgentQuestion, index: number) { return question.key || `question_${index + 1}`; }
export function questionType(question: Pick<QuestionInput, "type" | "multiple" | "options">): QuestionType {
  return question.type || (question.multiple ? "multiselect" : question.options?.length ? "radio" : "textarea");
}
export function questionAllowsCustom(question: Pick<QuestionInput, "type" | "multiple" | "options">) {
  return ["select", "radio", "multiselect"].includes(questionType(question));
}
export function optionValue(option: QuestionOption): QuestionScalar { return option.value ?? option.label; }
export function encodeQuestionValue(value: QuestionValue | undefined): string {
  return value === null || value === undefined ? "" : Array.isArray(value) ? JSON.stringify(value) : String(value);
}
export function initialQuestionAnswers(questions: AgentQuestion[]) {
  return questions.map((q) => encodeQuestionValue(q.default ?? (["checkbox", "toggle"].includes(questionType(q)) ? false : questionType(q) === "slider" ? q.min : undefined)));
}
export function normalizeAskUserInput(input: unknown): AskUserInput {
  const parsed = inputValidator.safeParse(input);
  if (!parsed.success) {
    throw new QuestionValidationError(parsed.error.issues.map(issue => `${issue.path.join(".") || "form"}: ${issue.message}`).slice(0, 5).join("; "));
  }
  const data = parsed.data as AskUserInput;
  const seen = new Set<string>();
  data.questions = data.questions.map((item, index) => {
    const key = item.key || `question_${index + 1}`;
    if (unsafeKeys.has(key) || seen.has(key)) throw new QuestionValidationError(`Duplicate or invalid field key: ${key}`);
    if (!item.question.trim()) throw new QuestionValidationError(`Field ${key} needs a label.`);
    const type = questionType(item);
    if (item.multiple !== undefined && item.type && item.multiple !== (type === "multiselect")) throw new QuestionValidationError(`Conflicting type and multiple flag for ${key}.`);
    if (item.showWhen && !seen.has(item.showWhen.key)) throw new QuestionValidationError(`Field ${key} must depend on an earlier field.`);
    seen.add(key);
    if (["select", "radio", "multiselect"].includes(type) && !item.options?.length) throw new QuestionValidationError(`Field ${key} needs options.`);
    const options = item.options?.map(o => typeof o === "string" ? { label: o, value: o } : { ...o, value: o.value ?? o.label });
    if (options?.some(o => !o.label.trim() || String(optionValue(o)) === "__metis_custom__") || new Set(options?.map(o => String(optionValue(o)))).size !== (options?.length ?? 0)) throw new QuestionValidationError(`Field ${key} has empty or duplicate options.`);
    if (item.min !== undefined && item.max !== undefined && item.min > item.max) throw new QuestionValidationError(`Invalid range for ${key}.`);
    if (type === "slider" && (item.min === undefined || item.max === undefined)) throw new QuestionValidationError(`Slider ${key} needs min and max.`);
    const normalized = { ...item, key, type, question: item.question.trim(), options,
      required: item.required ?? true, allowCustom: questionAllowsCustom(item) || (item.allowCustom ?? !item.type) };
    if (item.default !== undefined && item.default !== null) {
      try {
        normalized.default = decode({ ...normalized, id: key }, item.default);
        validateValue({ ...normalized, id: key }, normalized.default);
      } catch (error) { throw new QuestionValidationError(`Invalid default for ${key}: ${error instanceof Error ? error.message : "invalid value"}`); }
    }
    return normalized;
  });
  if (data.responseTemplate) {
    for (const match of data.responseTemplate.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g)) {
      if (!seen.has(match[1])) throw new QuestionValidationError(`Unknown template field: ${match[1]}`);
    }
  }
  return data;
}
// Preserve stored IDs while applying the same contract to SSE and old persisted questions.
export function normalizeStoredQuestions(input: unknown): AgentQuestion[] {
  if (!Array.isArray(input)) return [];
  try {
    const fields = input.map(item => {
      const { id: _id, ...field } = item as AgentQuestion;
      void _id;
      return field;
    });
    const normalized = normalizeAskUserInput({ questions: fields });
    return normalized.questions.map((q, i) => ({ ...q, id: typeof input[i]?.id === "string" ? input[i].id : `question-${i + 1}`, options: q.options as QuestionOption[] | undefined }));
  } catch { return []; }
}
function decode(question: AgentQuestion, raw: unknown): QuestionValue {
  if (raw === null || raw === undefined || raw === "") return null;
  const type = questionType(question);
  if (type === "number" || type === "slider") {
    if (typeof raw !== "string" && typeof raw !== "number") throw new Error("Enter a number.");
    if (typeof raw === "string" && !raw.trim()) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error("Enter a valid number.");
    return value;
  }
  if (type === "checkbox" || type === "toggle") {
    if (raw === true || raw === "true") return true;
    if (raw === false || raw === "false") return false;
    throw new Error("Choose yes or no.");
  }
  if (type === "task_list") {
    try { return normalizeTaskList(typeof raw === "string" ? JSON.parse(raw) : raw); }
    catch (error) { throw new Error(error instanceof Error ? error.message : "Enter valid research steps."); }
  }
  if (type === "multiselect") {
    let values: unknown = raw;
    if (typeof raw === "string") {
      try { values = JSON.parse(raw); }
      catch { if (questionAllowsCustom(question)) values = [raw]; else throw new Error("Select one or more options."); }
    }
    if (!Array.isArray(values)) throw new Error("Select one or more options.");
    return values.map(value => matchOption(question, value));
  }
  if (type === "select" || type === "radio") return matchOption(question, raw);
  if (typeof raw !== "string") throw new Error("Enter text.");
  return raw.trim();
}
function matchOption(question: AgentQuestion, raw: unknown): QuestionScalar {
  const option = question.options?.find(o => raw === optionValue(o) || (typeof raw === "string" && raw === String(optionValue(o))));
  if (option) return optionValue(option);
  if ((questionAllowsCustom(question)) && typeof raw === "string" && raw.trim()) return raw.trim();
  throw new Error("Choose an available option.");
}
function validateValue(question: AgentQuestion, value: QuestionValue) {
  if (value === null || value === "" || (Array.isArray(value) && !value.length)) {
    if (question.required !== false) throw new Error("Answer this question.");
    return;
  }
  const type = questionType(question);
  const number = type === "number" || type === "slider";
  if (number && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("Enter a valid number.");
  if ((type === "checkbox" || type === "toggle") && typeof value !== "boolean") throw new Error("Choose yes or no.");
  if (type === "multiselect" && !Array.isArray(value)) throw new Error("Select one or more options.");
  if (type === "task_list") { normalizeTaskList(value); return; }
  if (Array.isArray(value) && (value.length > 100 || new Set(value.map(v => JSON.stringify(v))).size !== value.length)) throw new Error("Select each option once.");
  if (typeof value === "number" && number) {
    if (question.min !== undefined && value < question.min) throw new Error(`Minimum: ${question.min}.`);
    if (question.max !== undefined && value > question.max) throw new Error(`Maximum: ${question.max}.`);
    if (question.step !== undefined) {
      const steps = (value - (question.min ?? 0)) / question.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error(`Use increments of ${question.step}.`);
    }
  }
  if (typeof value === "string") {
    if (value.length > (question.maxLength ?? 4000)) throw new Error(`Maximum ${question.maxLength ?? 4000} characters.`);
    if (type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error("Enter a valid date.");
    if (type === "time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("Enter a valid time.");
  }
  if (["select", "radio", "multiselect"].includes(type)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      matchOption(question, item);
      if (typeof item === "string" && item.length > (question.maxLength ?? 4000)) throw new Error(`Maximum ${question.maxLength ?? 4000} characters.`);
    }
  }
  if (["text", "textarea", "date", "time"].includes(type) && typeof value !== "string") throw new Error("Enter text.");
}
export function isQuestionVisible(question: AgentQuestion, values: Record<string, QuestionValue>) {
  if (!question.showWhen) return true;
  const current = values[question.showWhen.key];
  return Array.isArray(current) ? current.includes(question.showWhen.equals) : current === question.showWhen.equals;
}
export function previewQuestionValues(questions: AgentQuestion[], answers: string[]) {
  const values: Record<string, QuestionValue> = Object.create(null);
  questions.forEach((q, i) => {
    const key = questionKey(q, i);
    if (!isQuestionVisible(q, values)) { values[key] = null; return; }
    try { values[key] = decode(q, answers[i]); } catch { values[key] = null; }
  });
  return values;
}
export function normalizeQuestionAnswers(questions: AgentQuestion[], input: unknown): QuestionAnswers {
  if (!Array.isArray(input) && (!input || typeof input !== "object")) throw new QuestionValidationError("Invalid answers.");
  if (Array.isArray(input) && input.length !== questions.length) throw new QuestionValidationError("Answer every visible question.");
  const allowed = new Set(questions.map(questionKey));
  if (!Array.isArray(input) && Object.keys(input as object).some(key => !allowed.has(key))) throw new QuestionValidationError("Unknown answer field.");
  const values: Record<string, QuestionValue> = Object.create(null);
  const errors: Record<string, string> = Object.create(null);
  const answers = questions.map((q, i) => {
    const key = questionKey(q, i);
    if (!isQuestionVisible(q, values)) { values[key] = null; return ""; }
    try {
      const value = decode(q, Array.isArray(input) ? input[i] : (input as Record<string, unknown>)[key]);
      validateValue(q, value);
      if (questionType(q) !== "task_list" && encodeQuestionValue(value).length > 4000) throw new Error("Keep this answer under 4,000 characters.");
      values[key] = value;
      return encodeQuestionValue(value);
    } catch (error) {
      values[key] = null; errors[key] = error instanceof Error ? error.message : "Invalid answer."; return "";
    }
  });
  if (Object.keys(errors).length) throw new QuestionValidationError("Check the highlighted fields.", errors);
  return { answers, values };
}
export function readableQuestionValue(question: AgentQuestion, value: QuestionValue): string {
  if (value === null) return "";
  if (questionType(question) === "task_list" && Array.isArray(value)) return value.map((item, index) => `${index + 1}. ${item}`).join("\n");
  const display = (v: QuestionScalar) => question.options?.find(o => optionValue(o) === v)?.label ?? (typeof v === "boolean" ? v ? "Yes" : "No" : String(v));
  const text = Array.isArray(value) ? value.map(display).join(", ") : display(value);
  return text && question.unit ? `${text} ${question.unit}` : text;
}
export function questionAnswerDisplay(questions: AgentQuestion[], values: Record<string, QuestionValue>, summary: string): QuestionAnswerDisplay {
  return {
    summary,
    fields: questions.flatMap((question, index) => {
      if (!isQuestionVisible(question, values)) return [];
      const answer = readableQuestionValue(question, values[questionKey(question, index)] ?? null);
      return answer ? [{ question: question.question, answer }] : [];
    }),
  };
}

export function questionSummary(form: QuestionForm, questions: AgentQuestion[], values: Record<string, QuestionValue>): string {
  const labels = Object.fromEntries(questions.map((q, i) => [questionKey(q, i), readableQuestionValue(q, values[questionKey(q, i)] ?? null)]));
  if (form.responseTemplate) return form.responseTemplate.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g, (_, key: string) => labels[key] ?? "").slice(0, 16000);
  return questions.map((q, i) => {
    if (!isQuestionVisible(q, values)) return "";
    const text = labels[questionKey(q, i)];
    return text ? `${q.question}: ${text}` : "";
  }).filter(Boolean).join("\n").slice(0, 16000);
}

export function restoreQuestionDraft(form: PendingChatQuestion | null | undefined, extra?: Record<string, unknown>) {
  if (!form) return { answers: [] as string[], custom: [] as string[], customActive: [] as boolean[] };
  const defaults = initialQuestionAnswers(form.questions);
  const sameForm = extra?.questionDraftId === form.questionId;
  const strings = (input: unknown, fallback: string[]) => sameForm && Array.isArray(input) && input.length === form.questions.length && input.every(v => typeof v === "string") ? input as string[] : fallback;
  return {
    answers: strings(extra?.questionAnswers, defaults),
    custom: strings(extra?.questionCustom, form.questions.map(() => "")),
    customActive: sameForm && Array.isArray(extra?.questionCustomActive) && extra.questionCustomActive.length === form.questions.length && extra.questionCustomActive.every(v => typeof v === "boolean") ? extra.questionCustomActive as boolean[] : form.questions.map(() => false),
  };
}
