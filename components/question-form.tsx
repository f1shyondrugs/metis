"use client";
import { Fragment, useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ChatIcon } from "@/components/chat-icon";
import { TaskListInput } from "@/components/task-list-input";
import { SecureBrowserLoginForm } from "@/components/secure-browser-login-form";
import { QuestionFormFrame } from "@/components/question-form-frame";
import { requiresProtectedCredentials } from "@/lib/mcp-core/credential-question-policy.mjs";
import { cn } from "@/lib/utils";
import {
  normalizeQuestionAnswers, previewQuestionValues, questionKey, questionType,
  optionValue, isQuestionVisible, questionSummary,
  QuestionValidationError, type PendingChatQuestion, type QuestionAnswers,
} from "@/lib/question-contract";

type Props = {
  form: PendingChatQuestion; answers: string[]; custom: string[]; customActive: boolean[];
  disabled?: boolean; error?: string | null; fieldErrors?: Record<string, string>;
  onAnswersChange: (answers: string[]) => void;
  onCustomChange: (custom: string[]) => void;
  onCustomActiveChange: (active: boolean[]) => void;
  onSubmit: (result: QuestionAnswers) => void;
  onCancel: () => void;
};
function selections(answer: string) {
  try { const value: unknown = JSON.parse(answer || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
export function QuestionForm({
  form, answers, custom, customActive, disabled, error, fieldErrors = {},
  onAnswersChange, onCustomChange, onCustomActiveChange, onSubmit, onCancel,
}: Props) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  if(form.secureBrowserInput)return <SecureBrowserLoginForm form={form} disabled={disabled} error={error} onSubmit={onSubmit} onCancel={onCancel}/>;
  if(requiresProtectedCredentials(form))return <div role="alert" className="my-4 rounded-xl border border-border bg-background p-4 text-sm">
    <p>Enter credentials only in the protected login form. This older request is blocked. Start the login again.</p>
    <button type="button" disabled={disabled} onClick={onCancel} className="mt-3 min-h-11 underline">Close blocked request</button>
  </div>;
  const actual = form.questions.map((_, i) => customActive[i] ? custom[i] ?? "" : answers[i] ?? "");
  const values = previewQuestionValues(form.questions, actual);
  const previewReady = form.questions.every((q, i) => !isQuestionVisible(q, values) || q.required === false || (values[questionKey(q, i)] !== null && values[questionKey(q, i)] !== "" && (!Array.isArray(values[questionKey(q, i)]) || (values[questionKey(q, i)] as unknown[]).length > 0)));
  function update(index: number, value: string) {
    const next = [...answers]; next[index] = value; onAnswersChange(next);
    const key = questionKey(form.questions[index], index);
    setErrors(current => { const copy = { ...current }; delete copy[key]; return copy; });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    try {
      const result = normalizeQuestionAnswers(form.questions, actual);
      setErrors({}); onSubmit(result);
    } catch (failure) {
      if (failure instanceof QuestionValidationError) {
        setErrors(failure.fieldErrors);
        const key = Object.keys(failure.fieldErrors)[0];
        const control = event.currentTarget.querySelector<HTMLElement>(`[data-field-key="${key}"] input, [data-field-key="${key}"] textarea, [data-field-key="${key}"] select, [data-field-key="${key}"] button`);
        control?.focus();
      }
    }
  }
  return (
    <QuestionFormFrame title={form.title} description={form.description} submitLabel={form.submitLabel} disabled={disabled} error={error} onSubmit={submit} onCancel={onCancel}>
      <div className={cn("grid min-w-0 grid-cols-1 gap-x-5 gap-y-5", form.columns === 2 && "sm:grid-cols-2")}>
        {form.questions.map((question, index) => {
          if (!isQuestionVisible(question, values)) return null;
          const key = questionKey(question, index);
          const type = questionType(question);
          const id = `field-${form.questionId}-${question.id}`;
          const value = answers[index] ?? "";
          const useCustom = customActive[index] === true;
          const message = errors[key] || fieldErrors[key];
          const options = question.options ?? [];
          const isChoice = ["radio", "select", "multiselect"].includes(type);
          const showGroup = question.group && !form.questions.slice(0, index).reverse().find(q => isQuestionVisible(q, values) && q.group === question.group);
          const common = { id, disabled, "aria-invalid": Boolean(message), "aria-describedby": [question.description && `${id}-description`, message && `${id}-error`].filter(Boolean).join(" ") || undefined };
          return <Fragment key={question.id}>
            {showGroup ? <h4 className="col-span-full border-t border-border pt-4 text-xs font-medium text-muted-foreground first:border-t-0 first:pt-0">{question.group}</h4> : null}
            <div data-field-key={key} className={cn("min-w-0 space-y-2", (question.width === "full" || (form.columns === 2 && !question.width && ["textarea", "radio", "multiselect", "task_list"].includes(type))) && "col-span-full")}>
              <label htmlFor={id} id={`${id}-label`} className="flex items-center gap-2 text-sm font-medium leading-5">
                <ChatIcon name={question.icon} className="size-4 shrink-0 text-muted-foreground" />
                <span>{question.question}{question.required === false ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(optional)</span> : null}</span>
              </label>
              {question.description ? <p id={`${id}-description`} className="text-xs leading-relaxed text-muted-foreground">{question.description}</p> : null}
              {type === "select" ? <div className="relative">
                <select {...common} value={useCustom ? "__metis_custom__" : value} onChange={event => {
                  const active = [...customActive]; active[index] = event.target.value === "__metis_custom__"; onCustomActiveChange(active);
                  if (!active[index]) update(index, event.target.value);
                }} className="h-11 w-full appearance-none rounded-lg border border-input bg-background pl-3 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                  <option value="">{question.placeholder || "Choose an option…"}</option>
                  {options.map((option, oi) => <option key={oi} value={String(optionValue(option))}>{option.label}</option>)}
                  {isChoice ? <option value="__metis_custom__">Custom…</option> : null}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-3.5 size-4 text-muted-foreground" aria-hidden="true" />
              </div> : null}
              {type === "radio" || type === "multiselect" ? <div id={id} role={type === "radio" ? "radiogroup" : "group"} aria-labelledby={`${id}-label`} aria-describedby={common["aria-describedby"]} className="space-y-1">
                {options.map((option, oi) => {
                  const val = optionValue(option);
                  const selected = !useCustom && (type === "multiselect" ? selections(value).includes(val) : value === String(val));
                  return <label key={oi} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted/50 has-disabled:cursor-default">
                    <input type={type === "multiselect" ? "checkbox" : "radio"} name={id} disabled={disabled} checked={selected} value={String(val)} onChange={() => {
                      const active = [...customActive]; active[index] = false; onCustomActiveChange(active);
                      if (type === "multiselect") {
                        const selectedValues = selections(value);
                        update(index, JSON.stringify(selected ? selectedValues.filter(v => v !== val) : [...selectedValues, val]));
                      } else update(index, String(val));
                    }} className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
                    <ChatIcon name={option.icon} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 text-sm leading-5"><span>{option.label}</span>{option.description ? <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{option.description}</span> : null}</span>
                  </label>;
                })}
                {isChoice ? <label className="flex min-h-11 cursor-pointer items-center gap-3 px-2 py-2">
                  <input type="radio" name={type === "radio" ? id : `${id}-custom`} checked={useCustom} disabled={disabled} onChange={() => { const active = [...customActive]; active[index] = true; onCustomActiveChange(active); }} className="size-4 accent-primary" />
                  <span className="text-sm">Custom…</span>
                </label> : null}
              </div> : null}
              {type === "toggle" ? <div className="flex min-h-11 items-center gap-3">
                <Switch {...common} checked={value === "true"} onCheckedChange={checked => update(index, String(checked))} />
                <span className="text-sm text-muted-foreground">{value === "true" ? "Yes" : "No"}</span>
              </div> : null}
              {type === "checkbox" ? <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input {...common} type="checkbox" checked={value === "true"} onChange={event => update(index, String(event.target.checked))} className="size-4 accent-primary" />
                <span className="text-sm text-muted-foreground">{value === "true" ? "Yes" : "No"}</span>
              </label> : null}
              {type === "slider" ? <div className="space-y-2">
                <div className="flex min-h-11 items-center gap-4">
                  <input {...common} type="range" min={question.min} max={question.max} step={question.step ?? 1} value={value || question.min || 0} onChange={event => update(index, event.target.value)} className="min-w-0 flex-1 accent-primary" />
                  <output htmlFor={id} className="min-w-12 text-right text-sm tabular-nums">{value || question.min || 0}{question.unit ? ` ${question.unit}` : ""}</output>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground"><span>{question.min}</span><span>{question.max}</span></div>
              </div> : null}
              {type === "task_list" ? <TaskListInput {...common} language={form.language} value={value} onChange={next => update(index, next)} /> : null}
              {type === "textarea" ? <Textarea {...common} value={value} onChange={event => update(index, event.target.value)} maxLength={question.maxLength ?? 4000} placeholder={question.placeholder || "Type your answer…"} className="min-h-24 text-sm" /> : null}
              {["text", "number", "date", "time"].includes(type) ? <div className="flex items-center gap-2">
                <Input {...common} type={type === "text" ? "text" : type} value={value} onChange={event => update(index, event.target.value)} placeholder={question.placeholder} min={question.min} max={question.max} step={question.step ?? (type === "number" ? "any" : undefined)} maxLength={question.maxLength ?? 4000} className="min-h-11 text-sm" />
                {question.unit ? <span className="shrink-0 text-xs text-muted-foreground">{question.unit}</span> : null}
              </div> : null}
              {isChoice && useCustom ? <Input aria-label={`Custom answer: ${question.question}`} disabled={disabled} maxLength={question.maxLength ?? 4000} aria-invalid={Boolean(message)} aria-describedby={common["aria-describedby"]} value={type === "multiselect" ? String(selections(custom[index] ?? "")[0] ?? "") : custom[index] ?? ""} placeholder="Type your answer…" onChange={event => {
                const next = [...custom]; next[index] = type === "multiselect" ? JSON.stringify([event.target.value]) : event.target.value; onCustomChange(next);
              }} className="min-h-11" /> : null}
              {message ? <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{message}</p> : null}
            </div>
          </Fragment>;
        })}
      </div>
      {form.responseTemplate && previewReady ? <p className="mt-5 whitespace-pre-wrap border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground" aria-label="Your response preview">{questionSummary(form, form.questions, values)}</p> : null}
    </QuestionFormFrame>
  );
}
