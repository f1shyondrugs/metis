import { officePreviewResponse } from "@/lib/office-preview";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getChat } from "@/lib/db-store";
import { findChatAttachmentForPreview } from "@/lib/chat-attachment-preview-store";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ chatId: string; name: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { chatId, name } = await params;
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  const chat = getChat(chatId, ownerId);
  if (!chat) return Response.json({ error: "Not found" }, { status: 404 });

  const storedName = decodeURIComponent(name);
  const attachment = findChatAttachmentForPreview(chat, storedName, ownerId);
  const filePath = resolveUploadPath(chatId, storedName, ownerId);
  if (!attachment || !filePath) return Response.json({ error: "File not found" }, { status: 404 });

  return officePreviewResponse(filePath, attachment.mimeType);
}
