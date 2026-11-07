import { unlink } from "node:fs/promises";
import { internalRunLeaseAuthorized } from "@/lib/internal-run-lease";
import path from "node:path";
import { getChat } from "@/lib/db-store";
import { getUserAgentCwd } from "@/lib/mcp";
import { resolveAgentPath } from "@/lib/revert";
import { chatUploadDir, saveFileAttachment } from "@/lib/uploads";
import { registerProvidedFile } from "@/lib/provided-files";
import { researchCanvasArtifact } from "@/lib/mcp-core/research-canvas-artifact.mjs";
import { POST as writeWorkspace } from "@/app/api/internal/mcp-workspace/route";
import type { StoredAttachment } from "@/lib/uploads";
import { bearerTokenMatches } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  return bearerTokenMatches(req, process.env.MCP_BEARER_TOKEN);
}

function mimeFromName(name: string) {
  const extension = path.extname(name).toLowerCase();
  return ({
    ".css": "text/css",
    ".csv": "text/csv",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".gif": "image/gif",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript",
    ".json": "application/json",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".py": "text/x-python",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".wav": "audio/wav",
    ".webm": "video/webm",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xml": "application/xml",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
  } as Record<string, string>)[extension] || "application/octet-stream";
}

function providedFileResponse(chatId: string, attachment: StoredAttachment) {
  const url = `/api/uploads/${encodeURIComponent(chatId)}/${encodeURIComponent(attachment.storedName)}`;
  return Response.json({ attachment, downloadUrl: url, markdown: attachment.mimeType.startsWith("image/")
    ? `![${attachment.name}](${url})` : `[Download ${attachment.name}](${url})` });
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
  const userId = req.headers.get("x-ai-chat-user-id")?.trim() || undefined;
  const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
  if (!jobId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!chatId || !jobId) return Response.json({ error: "Invalid chat context" }, { status: 400 });
  if (!internalRunLeaseAuthorized(req, jobId)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const chat = getChat(chatId, userId);
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.researchReport !== undefined) {
    const report = body.researchReport;
    if (!report || typeof report !== "object" || Array.isArray(report)) {
      return Response.json({ error: "A research report title and complete content are required" }, { status: 400 });
    }
    if (req.signal.aborted) return Response.json({ error: "Report delivery was cancelled" }, { status: 499 });
    // Active gateways may still send the previous file-shaped report request.
    // Use the canonical report Canvas writer so auth, leases, limits, Incognito
    // policy and durable retries remain identical to the current gateway path.
    const headers = new Headers(req.headers);
    headers.delete("content-length");
    const response = await writeWorkspace(new Request(req.url, {
      method: "POST", headers, signal: req.signal,
      body: JSON.stringify({ action: "research_report", type: "canvas",
        title: (report as Record<string, unknown>).title, content: (report as Record<string, unknown>).content }),
    }));
    if (!response.ok) return response;
    try {
      const artifact = researchCanvasArtifact(await response.json());
      // Old gateway/workers preserve only downloadUrl in their completed tracker.
      // Carry the canonical Canvas URI there until that runtime has refreshed;
      // this is a workspace destination, never a file download or attachment.
      return Response.json({ ...artifact, downloadUrl: artifact.workspaceLink });
    }
    catch { return Response.json({ error: "Research report Canvas could not be confirmed" }, { status: 503 }); }
  }
  const requestedPath = typeof body.path === "string" ? body.path.trim() : "";
  if (!requestedPath) return Response.json({ error: "path is required" }, { status: 400 });
  if (req.signal.aborted) return Response.json({ error: "File delivery was cancelled." }, { status: 499 });

  let attachment: StoredAttachment | undefined;
  try {
    const agentCwd = getUserAgentCwd(userId);
    const filePath = resolveAgentPath(requestedPath, agentCwd);
    if (!filePath) return Response.json({ error: "File must be inside the agent workspace." }, { status: 400 });
    const root = path.resolve(agentCwd);
    const resolved = path.resolve(filePath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return Response.json({ error: "File must be inside the agent workspace." }, { status: 400 });
    }
    const name = typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : path.basename(resolved);
    attachment = await saveFileAttachment(chatId, resolved, {
      name,
      mimeType: typeof body.mimeType === "string" && body.mimeType.trim()
        ? body.mimeType
        : mimeFromName(name),
    }, userId);
    // Copying is asynchronous: cancellation or a lost run lease must not publish a file.
    if (req.signal.aborted || !internalRunLeaseAuthorized(req, jobId)) {
      await unlink(path.join(chatUploadDir(chatId, userId), attachment.storedName));
      return Response.json({ error: "File delivery was cancelled or the run is no longer active." }, { status: req.signal.aborted ? 499 : 401 });
    }
    registerProvidedFile(chatId, jobId, userId, attachment);
    return providedFileResponse(chatId, attachment);
  } catch (error) {
    if (attachment) await unlink(path.join(chatUploadDir(chatId, userId), attachment.storedName)).catch(() => undefined);
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not provide file." },
      { status: 400 },
    );
  }
}
