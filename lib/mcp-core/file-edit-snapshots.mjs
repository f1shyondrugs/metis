import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Shared by gateway and worker, including separate containers mounting CHAT_DATA_DIR.
// Only opaque receipts travel through model transcripts; file bodies stay out of context.
function snapshotPath(id) {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return undefined;
  const root = process.env.AI_CHAT_ROOT?.trim() || process.cwd();
  const state = process.env.AI_CHAT_MCP_STATE_DIR?.trim()
    || path.join(process.env.CHAT_DATA_DIR?.trim() || path.join(root, "data"), "mcp-state");
  const shared=process.env.AI_CHAT_FILE_SNAPSHOT_DIR?.trim();
  if(shared&&!path.isAbsolute(shared))return undefined;
  return path.join(shared||path.join(state,"file-edit-snapshots"),id+".json");
}
function validScope(scope) {
  return !scope?.incognito && ["userId", "chatId", "jobId"].every(key =>
    typeof scope?.[key] === "string" && scope[key].length > 0);
}
function readReceipt(id) {
  const file = snapshotPath(id);
  if (!file) return undefined;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
}
export function storeFileEditSnapshot(result, scope, target = "server") {
  const { fileSnapshot, ...summary } = result;
  if (!fileSnapshot || !validScope(scope)) return summary;
  if (!(typeof fileSnapshot.before === "string" || fileSnapshot.before === null)
    || typeof fileSnapshot.after !== "string") return summary;
  const id = randomUUID(), file = snapshotPath(id);
  try {
    const shared=Boolean(process.env.AI_CHAT_FILE_SNAPSHOT_DIR?.trim());
    // Shared storage is provisioned by the operator. Even mkdir on an existing
    // SGID directory is rejected by systemd RestrictSUIDSGID before lookup.
    if(!shared)fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if(shared&&(fs.lstatSync(path.dirname(file)).isSymbolicLink()||(fs.statSync(path.dirname(file)).mode&0o007)))throw Error("Unsafe shared snapshot directory");
    const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),shared?0o640:0o600);
    try{
    // A hardened service's 0077 umask must not remove the explicitly granted
    // app/worker group read permission from this operator-provisioned store.
    if(shared)fs.fchmodSync(fd,0o640);
    fs.writeFileSync(fd, JSON.stringify({
      userId: scope.userId, chatId: scope.chatId, jobId: scope.jobId,
      path: result.path, target, diff: fileSnapshot,
    }));
    }finally{fs.closeSync(fd);}
    return { ...summary, fileSnapshotRef: id };
  } catch {
    // The write already succeeded. Never report a failed edit and invite a repeat.
    return { ...summary, snapshotWarning: "The file changed, but its historical snapshot could not be staged." };
  }
}
export function readFileEditSnapshot(id, scope) {
  if (!validScope(scope)) return undefined;
  const saved = readReceipt(id);
  if (!saved || ["userId", "chatId", "jobId"].some(key => saved[key] !== scope[key])) return undefined;
  if (typeof saved.path !== "string" || typeof saved.target !== "string"
    || !(typeof saved.diff?.before === "string" || saved.diff?.before === null)
    || typeof saved.diff?.after !== "string") return undefined;
  return { path: saved.path, target: saved.target,
    diff: { before: saved.diff.before === null ? undefined : saved.diff.before, after: saved.diff.after } };
}
// A receipt is staging only. Acknowledge it after the exact contents reached SQLite.
export function acknowledgeFileEditSnapshot(id, chatId, snapshot) {
  const saved = readReceipt(id);
  if (!saved || saved.chatId !== chatId || saved.path !== snapshot.path
    || (saved.diff?.before ?? undefined) !== snapshot.before
    || saved.diff?.after !== snapshot.after) return;
  try { fs.unlinkSync(snapshotPath(id)); } catch { /* Already acknowledged by another checkpoint. */ }
}
