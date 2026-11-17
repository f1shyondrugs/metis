import path from "node:path";
import { readBoundedUpdateJson } from "./installer-update-log";
export function sanitizePackageDiagnostics(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const tag = typeof input.tag === "string" && /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(input.tag) ? input.tag : null;
  const phases = /^(?:lookup|download|preparing|prepared|stopped|activated|complete|recovered|rolled-back|rollback-failed|failed|database-backup|cleanup-deferred|cleanup-\d+)$/;
  const codes = new Set(["INTEGRITY_CHECK_FAILED","HEALTH_CHECK_FAILED","DISK_FULL","ASSET_UNAVAILABLE","ROLLBACK_RECOVERY_REQUIRED","UPDATE_FAILED","EACCES","EPERM","ENOSPC","ENOENT"]);
  const events = (Array.isArray(input.events) ? input.events : []).slice(-100).flatMap(event => {
    if (!event || typeof event !== "object") return [];
    const item = event as Record<string, unknown>;
    if (typeof item.phase !== "string" || !phases.test(item.phase) || typeof item.time !== "string" || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(item.time)) return [];
    return [{ time:item.time,phase:item.phase,...(typeof item.code==="string" && codes.has(item.code) ? {code:item.code} : {}) }];
  });
  return {schemaVersion:1,tag,platform:["linux","darwin","win32"].includes(String(input.platform))?input.platform:null,arch:["x64","arm64"].includes(String(input.arch))?input.arch:null,events};
}
export async function readPackageDiagnostics(dataDir:string) {
  try { return sanitizePackageDiagnostics(JSON.parse(await readBoundedUpdateJson(path.join(dataDir,"metis-package-diagnostics.json"),256*1024))); }
  catch { return sanitizePackageDiagnostics(null); }
}
