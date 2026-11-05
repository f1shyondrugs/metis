import { z } from "zod";
import { getChatByShareId } from "@/lib/db-store";
import { chatShareCredential } from "@/lib/chat-share-access";
import { sharedChatWorkspaces } from "@/lib/shared-workspace";
import { documentExportResponse } from "@/lib/document-export-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.object({
  id: z.string().min(1).max(128), workspaceId: z.string().min(1).max(200),
  format: z.enum(["md", "txt", "pdf"]),
}).strict();
const error = (message: string, status: number) => Response.json({ error: message }, {
  status, headers: { "Cache-Control": "private, no-store" },
});

export async function POST(req: Request) {
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error("Invalid export request", 400);
  const { id, workspaceId, format } = parsed.data;
  const credential = chatShareCredential(req, id);
  const result = getChatByShareId(id, undefined, credential);
  if (result.status === "not_found") return error("Share not found", 404);
  if (result.status === "password_required") return error("Password required", 401);
  const workspace = sharedChatWorkspaces(result.chat).find(item => item.id === workspaceId);
  if (!workspace) return error("Workspace not found", 404);
  const response = await documentExportResponse(workspace.name, workspace.content, format, req.signal);
  // PDF rendering is asynchronous. Revocation must also win during an in-flight export.
  const current = getChatByShareId(id, undefined, credential);
  if (current.status !== "ok" || !sharedChatWorkspaces(current.chat).some(item => item.id === workspaceId)) {
    await response.body?.cancel();
    return error("Workspace not found", 404);
  }
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
