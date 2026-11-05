import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/auth";
import { getChat } from "@/lib/db-store";
import { documentExportResponse } from "@/lib/document-export-response";
import { RESEARCH_REPORT_MAX_BYTES, workspaceContentError } from "@/lib/workspace-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const exportInput = z.object({
  chatId: z.string().min(1).max(200), workspaceId: z.string().min(1).max(200),
  name: z.string().max(200), content: z.string().max(RESEARCH_REPORT_MAX_BYTES), format: z.enum(["md", "txt", "pdf"]),
});

export async function POST(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const input = exportInput.safeParse(await req.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid export request" }, { status: 400 });
  const { chatId, workspaceId, name, content, format } = input.data;
  const chat = getChat(chatId, ownerId);
  const workspace = chat?.workspaces?.find((item) => item.id === workspaceId);
  const legacyCanvas = chat && !chat.workspaces?.length && chat.canvas && workspaceId === "canvas-default";
  if (!workspace && !legacyCanvas) return Response.json({ error: "Workspace not found" }, { status: 404 });
  const contentError = workspaceContentError(workspace, content);
  if (contentError) return Response.json({ error: contentError }, { status: 400 });
  return documentExportResponse(name, content, format, req.signal);
}
