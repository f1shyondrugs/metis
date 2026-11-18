import { getChatMetadata, getGlobalModelSettings } from "@/lib/db-store";
import { getProject } from "@/lib/projects";
import { enabledSkills, listSkillSettings, projectSkillSettings } from "@/lib/skills";
import { DEEP_RESEARCH_MODE_ID } from "@/lib/deep-research";
import type { ReferenceResult } from "@/lib/reference-search";

/** Only display metadata leaves the catalog; provider paths are resolved separately. */
export function listSkillReferences(ownerId: string, chatId?: string, draftProjectId?: string, ids?: ReadonlySet<string>): ReferenceResult[] {
  const chat = chatId ? getChatMetadata(chatId, ownerId) : null;
  if (chatId && (!chat || chat.incognito)) return [];
  const projectId = chatId ? chat?.projectId : draftProjectId;
  const project = projectId ? getProject(projectId, ownerId) : null;
  if (projectId && !project) return [];
  const settings = projectSkillSettings(getGlobalModelSettings(ownerId), project);
  const installed = enabledSkills(settings).filter(skill => skill.id !== DEEP_RESEARCH_MODE_ID && (!ids || ids.has(skill.id)));
  return listSkillSettings(settings, installed)
    .map(skill => ({
      kind: "skill",
      id: skill.id,
      label: (skill.title || skill.id).slice(0, 160),
      ...(skill.description ? { detail: skill.description.slice(0, 240) } : {}),
    }));
}
