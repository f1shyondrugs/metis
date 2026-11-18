import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, realpathSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getDatabase } from "@/lib/sqlite";
import { config } from "@/lib/config";
import type { SkillRecord } from "@/lib/skills";

export type SkillPackageFile = { path: string; content: string; encoding: "utf8" | "base64" };
export const MAX_SKILL_PACKAGE_BYTES = 2_000_000;
export function validSkillId(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9][a-z0-9._-]{1,63}$/.test(id);
}
function accountDirectory(ownerId: string) {
  if (!ownerId) throw new Error("An account is required.");
  return path.join(config.skillRoot, "skills", "personal", createHash("sha256").update(ownerId).digest("hex"));
}
function readLock(ownerId: string): Record<string, { hash: string }> {
  try { return JSON.parse(readFileSync(path.join(accountDirectory(ownerId), "skills.json"), "utf8")); }
  catch { return {}; }
}
export function personalSkills(ownerId?: string): SkillRecord[] {
  if (!ownerId) return [];
  const root = accountDirectory(ownerId);
  return Object.entries(readLock(ownerId)).filter(([id]) => validSkillId(id)).map(([id, item]) => ({
    id, source: "Personal", sourceType: "personal",
    skillPath: path.join(root, id, "SKILL.md"),
    computedHash: item.hash,
  }));
}
export function validateSkillPackage(files: SkillPackageFile[]) {
  if (!Array.isArray(files) || !files.length || files.length > 100) throw new Error("A skill package needs 1–100 files.");
  const paths = new Set<string>(); let size = 0;
  for (const file of files) {
    if (!file || typeof file.path !== "string" || file.path.length > 250 ||
        !/^[a-zA-Z0-9_./ -]+$/.test(file.path) ||
        file.path.split("/").some(part => !part || part === "." || part === ".." || part.startsWith(".")) ||
        typeof file.content !== "string" || !["utf8", "base64"].includes(file.encoding) || paths.has(file.path)) {
      throw new Error("Invalid skill package file.");
    }
    if (file.encoding === "base64" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content)) throw new Error("Invalid file encoding.");
    paths.add(file.path);
    size += Buffer.byteLength(file.content, file.encoding === "base64" ? "base64" : "utf8");
    if (size > MAX_SKILL_PACKAGE_BYTES) throw new Error("Skill package exceeds 2 MB.");
  }
  const entry = files.find(file => file.path === "SKILL.md");
  if (!entry || entry.encoding !== "utf8" || !entry.content.trim() || Buffer.byteLength(entry.content) > 200_000) throw new Error("A SKILL.md text file up to 200 KB is required.");
}
export function addPersonalSkill(ownerId: string, id: string, files: SkillPackageFile[]): SkillRecord {
  if (!validSkillId(id)) throw new Error("Skill id must be 2–64 lowercase letters, numbers, dots, hyphens or underscores.");
  validateSkillPackage(files);
  const root = accountDirectory(ownerId); const lock = readLock(ownerId);
  const access = getDatabase().prepare("SELECT uid, gid FROM user_workspace_access WHERE user_id = ?").get(ownerId) as { uid: number | null; gid: number | null } | undefined;
  const ownershipPaths: string[] = [root];
  if (Object.keys(lock).length >= 200) throw new Error("This account already has 200 personal skills.");
  const directory = path.join(root, id);
  if (lock[id] || existsSync(directory)) throw new Error("A skill with this id already exists. Choose another id.");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const realRoot = realpathSync(root);
  if (realRoot !== path.join(realpathSync(config.skillRoot), "skills", "personal", path.basename(root))) throw new Error("Invalid skill storage.");
  mkdirSync(directory, { mode: 0o700 });
  const temporary = path.join(root, "skills-" + randomUUID() + ".tmp");
  try {
    ownershipPaths.push(directory);
    for (const file of files) {
      const destination = path.join(directory, file.path);
      mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      let parent = path.dirname(destination);
      while (parent.startsWith(directory + path.sep)) { ownershipPaths.push(parent); parent = path.dirname(parent); }
      ownershipPaths.push(destination);
      writeFileSync(destination, Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8"), { flag: "wx", mode: 0o600 });
    }
    if (process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0 && access && Number.isInteger(access.uid) && access.uid! > 0) {
      // Traverse the private collection without listing other accounts.
      for (const parent of [path.dirname(root), path.dirname(path.dirname(root))]) execFileSync("setfacl", ["-m", "u:" + access.uid + ":--x", "--", parent], { timeout: 5000, stdio: "ignore" });
      // Keep server ownership; only this verified account identity can read the package.
      for (const file of [...new Set(ownershipPaths)]) execFileSync("setfacl", ["-m", "u:" + access.uid + ":" + (statSync(file).isDirectory() ? "r-x" : "r--"), "--", file], { timeout: 5000, stdio: "ignore" });
    }
    lock[id] = { hash: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
    writeFileSync(temporary, JSON.stringify(lock), { flag: "wx", mode: 0o600 });
    renameSync(temporary, path.join(root, "skills.json"));
  } catch (error) {
    rmSync(temporary, { force: true });
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return personalSkills(ownerId).find(skill => skill.id === id)!;
}
