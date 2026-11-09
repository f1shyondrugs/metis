import { readNotesRichBlock, type EditorNode } from "@/lib/notes-editor-format";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { getAutomation, type Automation } from "@/lib/automations";
import { getChat } from "@/lib/db-store";
import { getNote } from "@/lib/shared-context";
import { noteDisplayTitle } from "@/lib/notes-tree";
import { getIssue } from "@/lib/issues";
import { ISSUE_STATUS_LABELS, ISSUE_PRIORITY_LABELS } from "@/lib/issue-types";
import { getInternalWorkspace } from "@/lib/internal-workspace.server";
import type { InternalLinkPreview, InternalLinkTarget } from "@/lib/internal-link";

const parser = unified().use(remarkParse).use(remarkGfm);

function bounded(value: string, limit: number) {
  const text = value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

/** Parse GFM so code examples do not count as completed tasks. */
function documentSummary(content: string) {
  type Node = { type: string; lang?: string | null; value?: string; alt?: string | null; checked?: boolean | null; children?: Node[] };
  const nodes: Node[] = [parser.parse(content.slice(0, 100_000)) as Node];
  const text: string[] = [];
  let tasks = 0, completed = 0, steps = 0;
  while (nodes.length) {
    const node = nodes.pop()!;
    if (node.type === "listItem") {
      steps += 1;
      if (typeof node.checked === "boolean") {
        tasks += 1;
        if (node.checked) completed += 1;
      }
    }
    if (node.type === "code") {
      if (node.lang === "metis-block") {
        const rich = readNotesRichBlock(node.value || "");
        const collect = (item: EditorNode) => {
          if (item.type === "codeBlock" || item.type === "sourceBlock") return;
          if (item.text) text.push(item.text);
          if (item.type === "toggleBlock" && typeof item.attrs?.title === "string") text.push(item.attrs.title);
          if (item.type === "taskItem") { tasks++; steps++; if (item.attrs?.checked) completed++; }
          for (const child of item.content || []) collect(child);
        };
        if (rich) collect(rich);
      }
      continue;
    }
    if (["text", "inlineCode"].includes(node.type) && node.value) text.push(node.value);
    if (node.type === "image" && node.alt) text.push(node.alt);
    if (node.children) for (let index = node.children.length - 1; index >= 0; index -= 1) nodes.push(node.children[index]);
  }
  return { description: bounded(text.join(" "), 600), tasks, completed, steps };
}

function dateLabel(value: string | undefined, timezone = "UTC") {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  try {
    return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  }
}

function scheduleLabel(automation: Automation) {
  const schedule = automation.schedule;
  if (schedule.kind === "once") return "Once · " + dateLabel(schedule.at, automation.timezone);
  if (schedule.kind === "monthly") return "Monthly on day " + schedule.dayOfMonth;
  if (schedule.kind === "days") return schedule.everyDays === 1 ? "Every day" : "Every " + schedule.everyDays + " days";
  const minutes = schedule.everyMinutes;
  if (minutes % 1440 === 0) return minutes === 1440 ? "Every day" : "Every " + minutes / 1440 + " days";
  if (minutes % 60 === 0) return "Every " + minutes / 60 + (minutes === 60 ? " hour" : " hours");
  return "Every " + minutes + " minutes";
}

function preview(target: InternalLinkTarget, title: string, description: string, details: InternalLinkPreview["details"]): InternalLinkPreview {
  return {
    ...target,
    title: bounded(title, 200) || target.kind[0].toUpperCase() + target.kind.slice(1),
    description: bounded(description, 600),
    details: details.filter(item => item.value).slice(0, 5).map(item => ({
      label: bounded(item.label, 40), value: bounded(item.value, 200),
    })),
  };
}

export function getInternalLinkPreview(target: InternalLinkTarget, ownerId: string, chatId?: string): InternalLinkPreview | null {
  // Never let an absent account widen the canonical stores' optional owner filters.
  if (!ownerId) return null;
  if (target.kind === "issue") {
    const issue = getIssue(target.id, ownerId);
    if (!issue) return null;
    return preview(target, issue.key + " · " + issue.title, documentSummary(issue.description).description, [
      { label: "Status", value: ISSUE_STATUS_LABELS[issue.status] },
      { label: "Priority", value: ISSUE_PRIORITY_LABELS[issue.priority] },
      { label: "Updated", value: dateLabel(issue.updatedAt) },
    ]);
  }
  if (target.kind === "note") {
    const note = getNote(target.id, ownerId);
    if (!note) return null;
    const todos = note.todos || [];
    return { ...preview(target, noteDisplayTitle(note.title), documentSummary(note.content).description, [
      { label: "Scope", value: note.scope[0].toUpperCase() + note.scope.slice(1) },
      ...(todos.length ? [{ label: "Tasks", value: todos.filter(todo => todo.status === "completed").length + "/" + todos.length + " completed" }] : []),
      { label: "Updated", value: dateLabel(note.updatedAt) },
    ]), icon: note.icon || null };
  }
  if (target.kind === "automation") {
    const automation = getAutomation(target.id, ownerId, false);
    if (!automation) return null;
    return preview(target, automation.name, automation.prompt, [
      { label: "Status", value: automation.status[0].toUpperCase() + automation.status.slice(1) },
      { label: "Schedule", value: scheduleLabel(automation) },
      { label: "Timezone", value: automation.timezone },
      { label: "Next run", value: dateLabel(automation.nextRunAt, automation.timezone) },
    ]);
  }
  const resolved = getInternalWorkspace({ kind: target.kind, id: target.id }, ownerId, chatId);
  if (!resolved) return null;
  const chat = getChat(resolved.chatId, ownerId);
  if (!chat) return null;
  const { workspace } = resolved;
  const summary = documentSummary(workspace.content);
  return preview(target, workspace.name, summary.description, [
    ...(target.kind === "plan" && summary.tasks
      ? [{ label: "Tasks", value: summary.completed + "/" + summary.tasks + " completed" }]
      : target.kind === "plan" && summary.steps ? [{ label: "Steps", value: String(summary.steps) }] : []),
    { label: "Chat", value: chat.title },
    { label: "Updated", value: dateLabel(workspace.updatedAt) },
  ]);
}
