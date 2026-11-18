import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import type { GlobalModelSettings } from "@/lib/store";
import { listInstalledSkills } from "@/lib/skills";

const textExtensions = new Set([".md", ".txt", ".py", ".js", ".mjs", ".ts", ".json", ".yaml", ".yml", ".toml", ".sh"]);
const imageExtensions = new Map([[".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".svg", "image/svg+xml"]]);
export type SkillFile = { path: string; kind: "text" | "image"; size: number };

export function skillPackageRoot(id: string, settings?: GlobalModelSettings) {
  const skill = listInstalledSkills(settings).find(item => item.id === id);
  if (!skill) throw new Error("Skill not found");
  const root = realpathSync(config.skillRoot);
  const entry = path.resolve(root, skill.skillPath);
  if (!existsSync(entry)) throw new Error("Skill package is unavailable");
  const directory = realpathSync(path.dirname(entry));
  if (skill.sourceType === "personal" && directory !== path.dirname(entry)) throw new Error("Invalid personal skill storage");
  if (!directory.startsWith(root + path.sep)) throw new Error("Skill package is outside the workspace");
  return directory;
}

export function listSkillFiles(id: string, settings?: GlobalModelSettings): SkillFile[] {
  const root = skillPackageRoot(id, settings);
  const files: SkillFile[] = [];
  function visit(directory: string, depth: number) {
    if (depth > 6 || files.length >= 300) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink() || ["node_modules", "__pycache__"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, depth + 1);
      else if (entry.isFile()) {
        const extension = path.extname(entry.name).toLowerCase();
        if (!textExtensions.has(extension) && !imageExtensions.has(extension)) continue;
        files.push({ path: path.relative(root, absolute).split(path.sep).join("/"), kind: imageExtensions.has(extension) ? "image" : "text", size: statSync(absolute).size });
      }
      if (files.length >= 300) break;
    }
  }
  visit(root, 0);
  return files.sort((a, b) => a.path === "SKILL.md" ? -1 : b.path === "SKILL.md" ? 1 : a.path.localeCompare(b.path));
}

export function readSkillFile(id: string, relativePath: string, settings?: GlobalModelSettings) {
  const root = skillPackageRoot(id, settings);
  const file = listSkillFiles(id, settings).find(item => item.path === relativePath);
  if (!file || file.size > 1_000_000) throw new Error("File not found or too large");
  const absolute = realpathSync(path.resolve(root, relativePath));
  if (!absolute.startsWith(root + path.sep)) throw new Error("File is outside the skill package");
  if (file.kind === "image") {
    return { ...file, content: readFileSync(absolute).toString("base64"), mimeType: imageExtensions.get(path.extname(file.path).toLowerCase()) };
  }
  if (file.size > 200_000) throw new Error("Text file is too large to preview");
  return { ...file, content: readFileSync(absolute, "utf8") };
}
