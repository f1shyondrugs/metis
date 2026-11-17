import {getCalendarReference} from "@/lib/calendar/reference";
import {DateTime} from "luxon";
import {boundedPreviewText as bounded,documentPreviewSummary as documentSummary} from "@/lib/document-preview";
import { getAutomation, type Automation } from "@/lib/automations";
import { getChat } from "@/lib/db-store";
import { getNote } from "@/lib/shared-context";
import { noteDisplayTitle } from "@/lib/notes-tree";
import { getIssue } from "@/lib/issues";
import { ISSUE_STATUS_LABELS, ISSUE_PRIORITY_LABELS } from "@/lib/issue-types";
import { getInternalWorkspace } from "@/lib/internal-workspace.server";
import type { InternalLinkPreview, InternalLinkTarget } from "@/lib/internal-link";

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

export function getInternalLinkPreview(target: InternalLinkTarget, ownerId: string, chatId?: string, timeZone="UTC"): InternalLinkPreview | null {
  // Never let an absent account widen the canonical stores' optional owner filters.
  if (!ownerId) return null;
  if(target.kind==="calendar-event"){
    try{
      const {event,calendar,occurrence,recurring}=getCalendarReference(ownerId,target.id,timeZone),value=occurrence||event;
      const zone=event.timeZone==="floating"?timeZone:event.timeZone;
      const format=(value:string)=>event.allDay?DateTime.fromISO(value,{zone:"UTC"}).setLocale("en").toFormat("dd LLL yyyy"):dateLabel(value,zone);
      return{...preview(target,event.title,event.description,[
       {label:"Calendar",value:calendar.name},
       {label:recurring?"Next occurrence":"Start",value:occurrence?format(value.start):"No occurrence in the next 10 years"},
       {label:event.allDay?"End (exclusive)":"End",value:occurrence?format(value.end):""},
       {label:"Time zone",value:event.allDay?"All day":zone},
       {label:"Location",value:event.location},
      ]),color:/^#[a-f0-9]{6}$/i.test(calendar.color)?calendar.color:undefined,
      ...(recurring?{description:("Recurring event · "+event.recurrence+"\n"+event.description).slice(0,600)}:{})};
    }catch{return null;}
  }
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
    return {...preview(target, automation.name, automation.prompt, [
      { label: "Status", value: automation.status[0].toUpperCase() + automation.status.slice(1) },
      { label: "Schedule", value: scheduleLabel(automation) },
      { label: "Timezone", value: automation.timezone },
      { label: "Next run", value: dateLabel(automation.nextRunAt, automation.timezone) },
    ]),icon:automation.icon??null};
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
