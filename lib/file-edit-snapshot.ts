import path from "node:path";
import { editedFileFromTool } from "@/lib/edited-files";
import { unwrapToolRecord } from "@/lib/tool-call-display";
import { readFileEditSnapshot, type FileSnapshotScope } from "@/lib/mcp-core/file-edit-snapshots.mjs";
import type { ToolPart } from "@/lib/store";

type Receipt = { ref: string; scope: string; path: string; target: string; diff: NonNullable<ToolPart["diff"]> };
// A symbol cannot cross native JSON IPC. Object spreads retain it inside this
// trusted process, while persistence and SSE serialization intentionally omit it.
const verifiedReceipt = Symbol("metis.verified-file-edit-receipt");
type VerifiedTool = ToolPart & { [verifiedReceipt]?: Readonly<Receipt> };

function scopeKey(scope?: FileSnapshotScope) {
  if (scope?.incognito || ![scope?.userId, scope?.chatId, scope?.jobId].every(value => typeof value === "string" && value.length)) return undefined;
  return JSON.stringify([scope!.userId, scope!.chatId, scope!.jobId]);
}
function withoutFileClaims(tool: ToolPart): VerifiedTool {
  const result: VerifiedTool = { ...tool, path: undefined, diff: undefined, editedFile: null };
  delete result[verifiedReceipt];
  return result;
}

/** Only a canonical gateway receipt can establish a filesystem change. */
export function withEditedFileTracking(tool: ToolPart, agentCwd: string, previous?: ToolPart, scope?: FileSnapshotScope): ToolPart {
  const clean = withoutFileClaims(tool);
  if (tool.status !== "completed") return clean;
  const key = scopeKey(scope);
  if (!key) return clean;
  const result = unwrapToolRecord(tool.result);
  const ref = result?.fileSnapshotRef;
  const saved = readFileEditSnapshot(ref, scope);
  const earlier = (previous as VerifiedTool | undefined)?.[verifiedReceipt];
  const receipt: Readonly<Receipt> | undefined = saved && typeof ref === "string"
    ? Object.freeze({ ref, scope: key, path: saved.path, target: saved.target, diff: Object.freeze({ ...saved.diff }) })
    : earlier && earlier.scope === key && earlier.ref === ref && previous?.id === tool.id ? earlier : undefined;
  if (!receipt) return clean;
  const output: VerifiedTool = { ...clean, kind: "edit", path: receipt.path, diff: { ...receipt.diff },
    editedFile: { path: receipt.path, target: receipt.target }, [verifiedReceipt]: receipt };
  const file = editedFileFromTool(output);
  output.editedFile = file ? { ...file,
    path: file.target === "server" ? path.resolve(agentCwd, file.path) : file.path } : null;
  return output;
}

/** Native lifecycle reports cannot request privileged parent filesystem reads.
 * Kept as the adapter seam; trusted gateway receipts are handled above.
 */
export function withLocalFileEditSnapshot(tool: ToolPart, _previous: ToolPart | undefined, _agentCwd: string): ToolPart {
  return withoutFileClaims(tool);
}
