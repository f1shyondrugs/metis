import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import { personalSkills } from "@/lib/personal-skills";
import type { GlobalModelSettings, Project } from "@/lib/store";

export type SkillRecord = {
 id: string;
 source: string;
 sourceType: string;
 skillPath: string;
 computedHash: string;
};

export type SkillSettingsView = SkillRecord & {
 title: string;
 description: string;
 license: string;
 category: string;
 tags: string[];
 enabled: boolean;
 alwaysOn: boolean;
 shareable?: boolean;
};

type SkillsLock = {
 version?: number;
 skills?: Record<string, {
 source?: string;
 sourceType?: string;
 skillPath?: string;
 computedHash?: string;
 }>;
};

export const DEFAULT_ALWAYS_ON_SKILL_IDS = ["i-have-adhd", "skill-creator"] as const;

function lockPath() {
 return path.join(config.root, "skills-lock.json");
}

function resolvedSkillPath(id: string, configuredPath: string) {
 const candidates = [
 configuredPath,
 path.join(".agents", "skills", id, "SKILL.md"),
 path.join("skills", "manual", id, "SKILL.md"),
 path.join(".cursor", "skills", id, "SKILL.md"),
 path.join(".claude", "skills", id, "SKILL.md"),
 ].filter(Boolean);
 const root = path.resolve(config.root);
 for (const candidate of candidates) {
 const absolute = path.resolve(root, candidate);
 if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) continue;
 if (existsSync(absolute)) return path.relative(root, absolute);
 }
 return configuredPath;
}

function frontmatterScalar(block: string, key: string, indented = false) {
 const prefix = indented ? "[ \\t]+" : "";
 const quoted = block.match(new RegExp(`^${prefix}${key}:\\s*(['"])([\\s\\S]*?)\\1\\s*$`, "m"));
 if (quoted?.[2]) return quoted[2].replace(/\s+/g, " ").trim();
 const plain = block.match(new RegExp(`^${prefix}${key}:\\s*(.+)$`, "m"));
 return (plain?.[1] || "").replace(/\s+/g, " ").trim();
}

function frontmatterTags(block: string) {
 const raw = frontmatterScalar(block, "tags", true) || frontmatterScalar(block, "tags");
 return raw.split(/[,|]/).map((item) => item.trim()).filter(Boolean);
}

export function parseSkillFrontmatter(content: string) {
 const empty = { title: "", description: "", license: "", category: "", tags: [] as string[] };
 const fence = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
 if (!fence) return empty;
 const block = fence[1];
 const title = frontmatterScalar(block, "name");
 const description = frontmatterScalar(block, "description");
 return {
  title,
  description,
  license: frontmatterScalar(block, "license"),
  category: frontmatterScalar(block, "category", true) || frontmatterScalar(block, "category"),
  tags: frontmatterTags(block),
 };
}

function sharedInstalledSkills(): SkillRecord[] {
 try {
 const lock = JSON.parse(readFileSync(lockPath(), "utf8")) as SkillsLock;
 return Object.entries(lock.skills || {}).map(([id, skill]) => ({
 id,
 source: skill.source || "",
 sourceType: skill.sourceType || "github",
 skillPath: resolvedSkillPath(id, skill.skillPath || ""),
 computedHash: skill.computedHash || "",
 }));
 } catch {
 return [];
 }
}

export function listInstalledSkills(settings?: GlobalModelSettings): SkillRecord[] {
 return [...sharedInstalledSkills(), ...personalSkills(settings?.skillOwnerId)];
}

export function projectSkillSettings(settings: GlobalModelSettings | undefined, project?: Pick<Project, "disabledSkillIds"> | null): GlobalModelSettings | undefined {
 if (!project) return settings;
 const disabled = new Set(project.disabledSkillIds || []);
 const flags = { ...(settings?.enabledSkills || {}) };
 for (const skill of listInstalledSkills(settings)) flags[skill.id] = !disabled.has(skill.id);
 return { ...(settings || {}), enabledSkills: flags };
}

export function skillEnabled(id: string, settings?: GlobalModelSettings) {
 const flags = settings?.enabledSkills;
 if (!flags || !(id in flags)) return true;
 return flags[id] !== false;
}

export function isAlwaysOnSkill(id: string, settings?: GlobalModelSettings) {
 const flags = settings?.alwaysOnSkills;
 if (flags && id in flags) return flags[id] !== false;
 return (DEFAULT_ALWAYS_ON_SKILL_IDS as readonly string[]).includes(id);
}

export function enabledSkills(settings?: GlobalModelSettings): SkillRecord[] {
 return listInstalledSkills(settings).filter((skill) => skillEnabled(skill.id, settings));
}

export function readSkillMarkdown(id: string, settings?: GlobalModelSettings) {
 return readInstalledSkillMarkdown(listInstalledSkills(settings).find((item) => item.id === id));
}

function readInstalledSkillMarkdown(skill?: SkillRecord) {
 if (!skill?.skillPath) return null;
 try {
 return readFileSync(path.resolve(config.root, skill.skillPath), "utf8").slice(0, 20_000);
 } catch {
 return null;
 }
}

export function listSkillSettings(settings?: GlobalModelSettings, installed = listInstalledSkills(settings)): SkillSettingsView[] {
 return installed.map((skill) => {
 const meta = parseSkillFrontmatter(readInstalledSkillMarkdown(skill) || "");
 return {
 ...skill,
 title: meta.title || skill.id,
 description: meta.description,
 license: meta.license,
 category: meta.category,
 tags: meta.tags,
 enabled: skillEnabled(skill.id, settings),
 alwaysOn: isAlwaysOnSkill(skill.id, settings),
 };
 });
}

export function addManualSkill(id: string, content: string): SkillRecord {
 const normalizedId = id.trim().toLowerCase();
 if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(normalizedId)) {
 throw new Error("Skill id must be 2-64 characters using letters, numbers, dots, hyphens, or underscores.");
 }
 if (!content.trim()) throw new Error("SKILL.md content is required.");
 const relativePath = path.join("skills", "manual", normalizedId, "SKILL.md");
 const absolutePath = path.join(config.root, relativePath);
 mkdirSync(path.dirname(absolutePath), { recursive: true });
 writeFileSync(absolutePath, content, "utf8");

 let lock: SkillsLock = { version: 1, skills: {} };
 try { lock = JSON.parse(readFileSync(lockPath(), "utf8")) as SkillsLock; } catch { /* create it below */ }
 lock.version = lock.version || 1;
 lock.skills = lock.skills || {};
 const record = {
 source: "manual",
 sourceType: "local",
 skillPath: relativePath,
 computedHash: createHash("sha256").update(content).digest("hex"),
 };
 lock.skills[normalizedId] = record;
 const temporary = `${lockPath()}.tmp-${process.pid}`;
 writeFileSync(temporary, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
 renameSync(temporary, lockPath());
 return { id: normalizedId, ...record };
}

export function skillsCatalogPrompt(settings?: GlobalModelSettings, installed = enabledSkills(settings)) {
 const skills = installed.filter((skill) => !isAlwaysOnSkill(skill.id, settings));
 if (!skills.length) return "";
 return [
 "Installed skills (enabled in Agent Hub → Skills). Read a listed SKILL.md with the read_file tool when the task matches; do not invent skills that are not listed.",
 skills.map((skill) => `- ${skill.id} (${skill.source}): ${skill.skillPath}`).join("\n"),
 ].join("\n");
}

export function alwaysOnSkillsPrompt(settings?: GlobalModelSettings, installed = enabledSkills(settings)) {
 const skills = installed.filter((skill) => isAlwaysOnSkill(skill.id, settings));
 if (!skills.length) return "";
 return skills.map((skill) => {
 const content = readInstalledSkillMarkdown(skill)?.trim();
 if (!content) return "";
 return [
 `Always-on skill ${skill.id} is active for every response in this run.`,
 "Treat the rules below as already loaded; do not spend a tool call re-reading this SKILL.md unless asked.",
 "To disable always-on, turn it off for this skill in Agent Hub → Skills.",
 content,
 ].join("\n");
 }).filter(Boolean).join("\n\n");
}
