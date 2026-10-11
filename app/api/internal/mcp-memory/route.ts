import { availableMemoryScopes, isMemoryScope } from "@/lib/memory-scopes.mjs";
import { chatMemoryAction } from "@/lib/chat-memory-actions";
import { createMemory, deleteMemory, getChat, listMemories, updateMemory } from "@/lib/db-store";
import {
  getProject,
  createProjectMemory,
  deleteProjectMemory,
  listProjectMemories,
  updateProjectMemory,
} from "@/lib/projects";
import { getJob } from "@/lib/db-jobs";
import { internalRunLeaseAuthorized } from "@/lib/internal-run-lease";
import { bearerTokenMatches } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  return bearerTokenMatches(req, process.env.MCP_BEARER_TOKEN);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
  if (jobId && !internalRunLeaseAuthorized(req, jobId)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = req.headers.get("x-ai-chat-user-id")?.trim() || undefined;
  if (req.headers.get("x-ai-chat-incognito") === "1") {
    return Response.json({ error: "Memory tools are unavailable in Incognito." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "list";
  const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
  // Resolve the live policy from the owned chat on every call, including during
  // a running job. Never fall back to account memory for a missing project/chat.
  if (process.env.NODE_ENV === "production" && (!jobId || !userId)) {
    return Response.json({ error: "A leased owner context is required" }, { status: 401 });
  }
  const chat = chatId ? getChat(chatId, userId) : null;
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });
  if (jobId) {
    const job = getJob(jobId);
    if (!job || job.chatId !== chat.id || job.userId !== userId) {
      return Response.json({ error: "Run context does not match this chat" }, { status: 403 });
    }
  }
  if (chat.incognito) return Response.json({ error: "Memory tools are unavailable in Incognito." }, { status: 403 });
  const project = chat.projectId ? getProject(chat.projectId, userId) : null;
  if (chat.projectId && !project) return Response.json({ error: "Project not found" }, { status: 404 });
  if (body.scope !== undefined && !isMemoryScope(body.scope)) {
    return Response.json({ error: "scope must be chat, project or global" }, { status: 400 });
  }
  const scope = body.scope ?? (project ? "project" : "global");
  const availableScopes = availableMemoryScopes({hasProject: Boolean(project), includeGlobal: project?.memoryMode !== "project_only"});
  if (scope === "chat") return chatMemoryAction(userId, chat.id, action, body, availableScopes);
  if (scope === "project" && !project) return Response.json({ error: "No project is active" }, { status: 400 });
  if (scope === "global" && project?.memoryMode === "project_only") {
    return Response.json({ error: "Global memory access is disabled for this project. Use scope project." }, { status: 403 });
  }
  const projectId = scope === "project" ? project?.id : undefined;
  if (action === "access") return Response.json({ scope, availableScopes });

  if (action === "list") {
    return Response.json({
      scope, availableScopes,
      memories: projectId ? listProjectMemories(projectId, userId) : listMemories(userId),
    });
  }
  if (action === "add") {
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return Response.json({ error: "content is required" }, { status: 400 });
    const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : undefined;
    const memory = projectId
      ? createProjectMemory(projectId, content, tags, userId)
      : createMemory(content, tags, userId);
    return Response.json({ scope, availableScopes, memory });
  }
  if (action === "edit") {
    const id = typeof body.id === "string" ? body.id : "";
    const content = typeof body.content === "string" ? body.content.trim() : undefined;
    const patch = {
      ...(content ? { content } : {}),
      ...(Array.isArray(body.tags) ? { tags: body.tags.filter((tag): tag is string => typeof tag === "string") } : {}),
    };
    const memory = projectId
      ? updateProjectMemory(projectId, id, patch, userId)
      : updateMemory(id, patch, userId);
    if (!memory) return Response.json({ error: "Memory not found" }, { status: 404 });
    return Response.json({ scope, availableScopes, memory });
  }
  if (action === "delete") {
    const id = typeof body.id === "string" ? body.id : "";
    const deleted = projectId ? deleteProjectMemory(projectId, id, userId) : deleteMemory(id, userId);
    if (!deleted) return Response.json({ error: "Memory not found" }, { status: 404 });
    return Response.json({ ok: true, scope, availableScopes, id });
  }
  return Response.json({ error: "Unknown memory action" }, { status: 400 });
}
