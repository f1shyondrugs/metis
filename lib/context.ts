import {resolveAutomationReference} from "./automation-reference";
import {resolveCalendarReference} from "./calendar/reference";
import { projectRole } from "@/lib/project-access";
import { getChatMetadata, getChatNotePins, getGlobalModelSettings } from "@/lib/db-store";
import { listNotes, getNote } from "@/lib/shared-context";
import { listSkillReferences } from "./skill-reference";

export type ReferenceKind = import("./reference-search").ReferenceKind;

export type ContextReference = {
  kind: ReferenceKind;
  id: string;
  label: string;
  source?: "explicit" | "pinned";
  detail?: string;
  chatId?: string;
  path?: string;
  content?: string;
};

export function getPinnedNoteIds(ownerId: string | undefined, chatId: string) {
  const global = getGlobalModelSettings(ownerId).pinnedNoteIds || [];
  const session = getChatNotePins(chatId, ownerId);
  const excluded = new Set(session?.unpinnedGlobalNoteIds || []);
  const chat = session?.pinnedNoteIds || [];
  return [...new Set([...global.filter((id) => !excluded.has(id)), ...chat])].slice(0, 20);
}

export function getPinnedNotes(ownerId: string | undefined, chatId: string) {
  const chat = getChatMetadata(chatId, ownerId);
  if (!chat || chat.incognito) return [];
  ownerId ??= chat.ownerId;
  const allowed = new Map(listNotes({ ownerId, chatId }).filter((note) => note.ownerId === ownerId || (note.kind!=="learned_fact" && projectRole(note.projectId,ownerId))).map((note) => [note.id, note]));
  return getPinnedNoteIds(ownerId, chatId)
    .map((id) => allowed.get(id))
    .filter((note): note is NonNullable<typeof note> => Boolean(note))
    .map((note): ContextReference => ({
      kind: "note",
      id: note.id,
      label: note.title || "Untitled note",
      detail: "Pinned note",
      chatId: note.chatId,
      content: note.content.slice(0, 8_000),
      source: "pinned",
    }));
}

export function resolveReferences(
  ownerId: string | undefined,
  chatId: string,
  references: ContextReference[],
) {
  const chat = getChatMetadata(chatId, ownerId);
  if (!chat) return [];
  const resolvedOwnerId = ownerId ?? chat.ownerId;
  const accessibleNotes = new Map(listNotes({ ownerId: resolvedOwnerId, chatId }).filter((note) => note.ownerId === resolvedOwnerId || (note.kind!=="learned_fact" && projectRole(note.projectId,resolvedOwnerId))).map((note) => [note.id, note]));
  const skillIds = new Set(references.slice(0, 20).filter(reference => reference.kind === "skill").map(reference => reference.id));
  const skillRefs = resolvedOwnerId && !chat.incognito && skillIds.size
    ? new Map(listSkillReferences(resolvedOwnerId, chatId, undefined, skillIds).map(item => [item.id, item])) : undefined;
  return references
    .slice(0, 20)
    .map((reference): ContextReference | null => {
      if (reference.kind === "skill") {
        const skill = skillRefs?.get(reference.id);
        return skill ? { ...skill, source: "explicit" } : null;
      }
      if(reference.kind==="automation")return chat.incognito?null:resolveAutomationReference(resolvedOwnerId,reference.id);
      if(reference.kind==="calendar-event")return chat.incognito?null:resolveCalendarReference(resolvedOwnerId,reference.id);
      if (reference.kind !== "note") return { ...reference, source: reference.source || "explicit" };
      const note = accessibleNotes.get(reference.id) || getNote(reference.id, resolvedOwnerId, { chatId });
      if (!note || (note.ownerId !== resolvedOwnerId && (note.kind==="learned_fact" || !projectRole(note.projectId,resolvedOwnerId)))) return null;
      return {
        kind: "note",
        id: note.id,
        label: note.title || "Untitled note",
        detail: reference.detail || "Referenced note",
        chatId: note.chatId,
        content: note.content.slice(0, 8_000),
        source: reference.source || "explicit",
      };
    })
    .filter((reference): reference is ContextReference => Boolean(reference));
}

