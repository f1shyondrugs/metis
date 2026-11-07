import { canAccessChat, chatActor, chatForUser, chatIndexForUser, projectRole, sharedChatForStorage } from "@/lib/project-access";
import { getChatActivity, recordMessageActivity, recordAttentionActivity, acknowledgeChatActivity } from "@/lib/chat-activity-server";
import { projectModelOverride } from "@/lib/project-model-server";
import { isChatWaitingForUser } from "@/lib/user-input-resume";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { hashSharePassword, verifySharePassword } from "@/lib/share-password";
import { createChatShareAccess, validChatShareAccess } from "@/lib/chat-share-access";
import { chatShareAssets } from "@/lib/chat-share-assets";
import { getDatabase, parseData, transaction } from "@/lib/sqlite";
import { config } from "@/lib/config";
import {ensureSafeDirectory,copySafeFile} from "@/lib/safe-file-read";
import { recordAccountUsage, syncAccountUsage } from "@/lib/account-usage";
import type {
  BrowserContext,
  Chat,
  ChatBadge,
  ChatIndexEntry,
  ChatMessage,
  ChatRunStatus,
  ChatSessionState,
  ChatShare,
  GlobalModelSettings,
  Memory,
  PendingChatQuestion,
  ToolPart,
  WorkspaceItem,
} from "@/lib/store";
import { chatUploadDir, resolveUploadPath } from "@/lib/uploads";
import { BoundedSnapshotCache } from "@/lib/snapshot-cache";
import { RUNTIME_MODES } from "@/lib/runtime-mode";
import { applyChatCheckpoints } from "@/lib/chat-checkpoints";
import { pageIsReady, pageState, readChatPage, rebuildChatPage, syncChatPage, syncChatCheckpointPage, syncChatAppendedPage } from "@/lib/chat-page-store";
import { recordChatSyncEvent, type ChatSyncEventKind } from "@/lib/chat-sync";

const now = () => new Date().toISOString();

function workerProjectionLeaseValid(chatId?: string) {
  const jobId = process.env.AI_CHAT_JOB_ID?.trim();
  const workerId = process.env.AI_CHAT_WORKER_ID?.trim();
  const leaseToken = process.env.AI_CHAT_JOB_LEASE_TOKEN?.trim();
  if (!jobId || !workerId || !leaseToken) return true;
  const conditions = chatId ? "AND j.chat_id = ?" : "";
  const params = chatId
    ? [jobId, chatId, workerId, leaseToken, now()]
    : [jobId, workerId, leaseToken, now()];
  return Boolean(getDatabase().prepare(
    `SELECT 1
     FROM job_leases l
     JOIN jobs j ON j.id = l.job_id
     WHERE l.job_id = ? ${conditions}
       AND l.worker_id = ? AND l.lease_token = ? AND l.expires_at > ?`,
  ).get(...params));
}
// These are optional copies of durable data, bounded independently in every process.
const chatCache = new BoundedSnapshotCache<string, { updatedAt: string; revision: number; chat: Chat }>(() => [], 8, 64 * 1024 * 1024);
const MAX_CHAT_KEYWORDS = 24;
const MAX_CHAT_KEYWORD_LENGTH = 80;
const MAX_CHAT_TITLE_LENGTH = 48;

export function clearStoreCaches() {
  chatCache.clear();
  chatIndexCache = null;
}
let chatIndexCache: { key: string; expiresAt: number; chats: ChatIndexEntry[] } | null = null;

export type PublicChatShare = Omit<ChatShare, "passwordHash" | "accessKey"> & { passwordProtected: boolean };

function publicShare(share?: ChatShare): PublicChatShare | undefined {
  if (!share) return undefined;
  return {
    id: share.id,
    active: share.active,
    passwordProtected: Boolean(share.passwordHash),
    content: {
      attachments: share.content?.attachments ?? true,
      thinking: share.content?.thinking ?? false,
      tools: share.content?.tools ?? false,
      suggestions: share.content?.suggestions ?? false,
      sources: share.content?.sources ?? false,
      workspaces: share.content?.workspaces ?? false,
    },
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
  };
}

function publicChat(chat: Chat): Omit<Chat, "ownerId"> & { share?: PublicChatShare; assets: Record<string,string> } {
  const { ownerId: _ownerId, share, ...rest } = chat;
  const content = {
    attachments: share?.content?.attachments ?? true,
    thinking: share?.content?.thinking ?? false,
    tools: share?.content?.tools ?? false,
    suggestions: share?.content?.suggestions ?? false,
    sources: share?.content?.sources ?? false,
    workspaces: share?.content?.workspaces ?? false,
  };
  const messages = rest.messages.map((message) => ({
    ...message,
    content:
      !content.sources && message.role === "assistant"
        ? message.content.replace(/```sources\s*[\s\S]*?```/gi, "").replace(/\n{3,}/g, "\n\n").trim()
        : message.content,
    ...(content.attachments ? {} : { attachments: undefined }),
    ...(content.thinking ? {} : { thinking: undefined }),
    ...(content.tools
      ? {}
      : {
          tools: content.workspaces
            ? message.tools?.filter((tool) => tool.kind === "plan" || tool.kind === "canvas" || tool.kind === "todo")
            : undefined,
        }),
    ...(content.suggestions ? {} : { suggestions: undefined }),
  }));
  return {
    ...rest,
    messages,
    assets: content.attachments && share ? chatShareAssets(chat.id,share.id,messages) : {},
    ...(content.workspaces ? {} : { workspaces: undefined, canvas: undefined }),
    ...(publicShare(share) ? { share: publicShare(share) } : {}),
  };
}

function rowChat(row: unknown): Chat | null {
  const chat = parseData<Chat>(row);
  return chat ? applyChatCheckpoints(getDatabase(), chat) : null;
}

function parseJsonField<T>(value: unknown): T | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function normalizeChatKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const keyword = item.trim().replace(/\s+/g, " ").slice(0, MAX_CHAT_KEYWORD_LENGTH);
    const key = keyword.toLocaleLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
    if (keywords.length >= MAX_CHAT_KEYWORDS) break;
  }
  return keywords;
}

export function normalizeChatTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/\s+/g, " ").trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!cleaned) return "";
  if (cleaned.length <= MAX_CHAT_TITLE_LENGTH) return cleaned;
  const slice = cleaned.slice(0, MAX_CHAT_TITLE_LENGTH);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace >= 12 ? slice.slice(0, lastSpace) : slice;
  return `${base.replace(/[.,;:]+$/, "")}…`;
}

function syncChatList(chat: Chat) {
  getDatabase()
    .prepare(
      `INSERT INTO chat_list (
        id, owner_id, title, keywords, last_message_sent, created_at, updated_at,
        agent_id, model_id, run_status, run_updated_at, queue_message, queued_message_count,
        pending_question, pending_approval, badge, pinned, archived, share,
        automation_run_id, incognito, project_id, agent_title_locked, expires_at, note_pins
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id=excluded.owner_id,
        title=excluded.title,
        keywords=excluded.keywords,
        last_message_sent=excluded.last_message_sent,
        created_at=excluded.created_at,
        updated_at=excluded.updated_at,
        agent_id=excluded.agent_id,
        model_id=excluded.model_id,
        run_status=excluded.run_status,
        run_updated_at=excluded.run_updated_at,
        queue_message=excluded.queue_message,
        queued_message_count=excluded.queued_message_count,
        pending_question=excluded.pending_question,
        pending_approval=excluded.pending_approval,
        badge=excluded.badge,
        pinned=excluded.pinned,
        archived=excluded.archived,
        share=excluded.share,
        automation_run_id=excluded.automation_run_id,
        incognito=excluded.incognito,
        project_id=excluded.project_id,
        agent_title_locked=excluded.agent_title_locked,
        expires_at=excluded.expires_at,
        note_pins=excluded.note_pins`,
    )
    .run(
      chat.id,
      chat.ownerId ?? null,
      chat.title || "New chat",
      chat.keywords?.length ? JSON.stringify(chat.keywords) : null,
      chat.lastMessageSent ?? null,
      chat.createdAt,
      chat.updatedAt,
      chat.agentId ?? null,
      chat.modelId ?? null,
      chat.runStatus ?? null,
      chat.runUpdatedAt ?? null,
      chat.queueMessage ?? null,
      chat.queuedMessages?.length || 0,
      chat.pendingQuestion ? JSON.stringify(chat.pendingQuestion) : null,
      chat.pendingApproval ? JSON.stringify(chat.pendingApproval) : null,
      chat.badge ?? null,
      chat.pinned ? 1 : 0,
      chat.archived ? 1 : 0,
      chat.share ? JSON.stringify(chat.share) : null,
      chat.automationRunId ?? null,
      chat.incognito ? 1 : 0,
      chat.projectId ?? null,
      chat.agentTitleLocked ? 1 : 0,
      chat.expiresAt ?? null,
      JSON.stringify({ pinnedNoteIds: chat.sessionState?.pinnedNoteIds, unpinnedGlobalNoteIds: chat.sessionState?.unpinnedGlobalNoteIds }),
    );
}

function persistAssistantMessage(chat: Chat, index: number, message: ChatMessage, mode: "set" | "append", previous?: ChatMessage) {
  const updatedAt = now();
  chat.updatedAt = updatedAt;
  const db = getDatabase();
  if (mode === "append") {
    db.prepare(
      `UPDATE chats
       SET data = json_insert(
             json_set(
               CASE json_type(data, '$.messages') WHEN 'array' THEN data ELSE json_set(data, '$.messages', json('[]')) END,
               '$.updatedAt', ?
             ),
             '$.messages[#]',
             json(?)
           ),
           updated_at = ?
       WHERE id = ?`,
    ).run(updatedAt, JSON.stringify(message), updatedAt, chat.id);
  } else {
    db.prepare(
      `UPDATE chats
       SET data = json_set(
             CASE json_type(data, '$.messages') WHEN 'array' THEN data ELSE json_set(data, '$.messages', json('[]')) END,
             ?, json(?),
             '$.updatedAt', ?
           ),
           updated_at = ?
       WHERE id = ?`,
    ).run(`$.messages[${index}]`, JSON.stringify(message), updatedAt, updatedAt, chat.id);
  }
  // Another process may have patched chat metadata (for example projectId)
  // while this worker was streaming. The SQL above intentionally updates
  // only the message and timestamp, so refresh the cache from that canonical
  // row instead of putting the worker's stale pre-run Chat object back.
  const persisted = rowChat(db.prepare("SELECT data FROM chats WHERE id = ?").get(chat.id)) || chat;
  syncChatPage(db, persisted, { message, position: index });
  recordMessageActivity(chat.id, previous ? [previous] : [], [message]);
  syncChatList(persisted);
  chatIndexCache = null;
  Object.assign(persisted, getChatActivity(chat.id));
  recordAccountUsage(chatActor(chat) || persisted.ownerId, message);
  chatCache.set(chat.id, { updatedAt, revision:pageState(db,chat.id)?.revision ?? 0, chat: persisted });
  recordChatSyncEvent({
    ownerId: persisted.ownerId,
    chatId: chat.id,
    kind: "updated",
    chatUpdatedAt: updatedAt,
  });
  return persisted;
}

/** Small, account-scoped pin settings; never loads message history. */
export function getChatNotePins(chatId: string, userId?: string): Pick<ChatSessionState, "pinnedNoteIds" | "unpinnedGlobalNoteIds"> | null {
  if (!canAccessChat(chatId, userId)) return null;
  const db = getDatabase();
  const row = db.prepare("SELECT owner_id AS ownerId, project_id AS projectId, note_pins AS pins, expires_at AS expiresAt, incognito FROM chat_list WHERE id=?").get(chatId) as
    { ownerId: string; projectId: string | null; pins: string | null; expiresAt: string | null; incognito: number } | undefined;
  if (!row || (row.incognito && row.expiresAt && Date.parse(row.expiresAt) <= Date.now())) return null;
  let pins: Record<string, unknown> = {};
  // A legacy worker can create a row without the new column during rolling deploys.
  // Read only its pins on demand, without hydrating or caching the transcript.
  const raw = row.pins ?? (db.prepare(`SELECT json_object('pinnedNoteIds', json_extract(data, '$.sessionState.pinnedNoteIds'),
    'unpinnedGlobalNoteIds', json_extract(data, '$.sessionState.unpinnedGlobalNoteIds')) AS pins FROM chats WHERE id=?`).get(chatId) as { pins: string } | undefined)?.pins;
  try { pins = JSON.parse(raw || "{}"); } catch {}
  if (userId && row.projectId) {
    if (row.ownerId !== userId) pins = {};
    const own = parseData<{ sessionState?: Record<string, unknown> }>(db.prepare("SELECT data FROM chat_user_settings WHERE chat_id=? AND user_id=?").get(chatId, userId));
    if (own?.sessionState) pins = own.sessionState;
  }
  const ids = (value: unknown) => Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  return { pinnedNoteIds: ids(pins.pinnedNoteIds), unpinnedGlobalNoteIds: ids(pins.unpinnedGlobalNoteIds) };
}

export function listChatsForUser(
  ownerId?: string,
  options: { includeArchived?: boolean } = {},
): ChatIndexEntry[] {
  // Expiry deletion runs in the background worker; sidebar reads never wait for a writer.
  const db = getDatabase();
  const dataVersion=JSON.stringify(db.prepare("PRAGMA data_version").get());
  const cacheKey = `${ownerId || "*"}:${options.includeArchived ? "all" : "active"}:${dataVersion}`;
  if (chatIndexCache?.key === cacheKey && chatIndexCache.expiresAt > Date.now()) {
    return ownerId ? chatIndexCache.chats.filter(chat => canAccessChat(chat.id,ownerId)).map(chat => chatIndexForUser(chat,ownerId)) : chatIndexCache.chats;
  }
  const rows = ownerId
    ? db.prepare(
      `SELECT id, owner_id AS ownerId, created_at AS createdAt, updated_at AS updatedAt,
                last_message_sent AS lastMessageSent, title, keywords, agent_id AS agentId,
                model_id AS modelId, run_status AS runStatus, run_updated_at AS runUpdatedAt,
                queue_message AS queueMessage, queued_message_count AS queuedMessageCount, pending_question AS pendingQuestion,
                pending_approval AS pendingApproval, badge, pinned, archived, share,
                COALESCE((SELECT revision FROM chat_activity WHERE chat_id = chat_list.id), 0) AS activityRevision,
                COALESCE((SELECT read_revision FROM chat_activity WHERE chat_id = chat_list.id), 0) AS readRevision,
                automation_run_id AS automationRunId, incognito, project_id AS projectId,
                agent_title_locked AS agentTitleLocked
         FROM chat_list
         WHERE (owner_id = ? OR EXISTS(SELECT 1 FROM projects p WHERE p.id=chat_list.project_id AND
           (p.owner_id=? OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?))))
           AND incognito = 0
           AND (automation_run_id IS NULL OR automation_run_id = '')
           AND (? = 1 OR archived = 0)
         ORDER BY pinned DESC, COALESCE(last_message_sent, created_at) DESC`,
      ).all(ownerId, ownerId, ownerId, options.includeArchived ? 1 : 0)
    : db.prepare(
      `SELECT id, owner_id AS ownerId, created_at AS createdAt, updated_at AS updatedAt,
                last_message_sent AS lastMessageSent, title, keywords, agent_id AS agentId,
                model_id AS modelId, run_status AS runStatus, run_updated_at AS runUpdatedAt,
                queue_message AS queueMessage, queued_message_count AS queuedMessageCount, pending_question AS pendingQuestion,
                pending_approval AS pendingApproval, badge, pinned, archived, share,
                COALESCE((SELECT revision FROM chat_activity WHERE chat_id = chat_list.id), 0) AS activityRevision,
                COALESCE((SELECT read_revision FROM chat_activity WHERE chat_id = chat_list.id), 0) AS readRevision,
                automation_run_id AS automationRunId, incognito, project_id AS projectId,
                agent_title_locked AS agentTitleLocked
         FROM chat_list
         WHERE incognito = 0
           AND (automation_run_id IS NULL OR automation_run_id = '')
           AND (? = 1 OR archived = 0)
         ORDER BY pinned DESC, COALESCE(last_message_sent, created_at) DESC`,
      ).all(options.includeArchived ? 1 : 0);
  const result: ChatIndexEntry[] = rows.flatMap((row) => {
      const item = row as Record<string, unknown>;
      const archived = Boolean(item.archived);
      const pendingQuestion = parseJsonField<PendingChatQuestion>(item.pendingQuestion);
      const pendingApproval = parseJsonField<ChatIndexEntry["pendingApproval"]>(item.pendingApproval);
      const share = parseJsonField<ChatShare>(item.share);
      const keywords = normalizeChatKeywords(
        parseJsonField<unknown>(item.keywords) ?? item.keywords,
      );
      return [{
        id: String(item.id || ""),
        ownerId: typeof item.ownerId === "string" ? item.ownerId : undefined,
        title: typeof item.title === "string" ? item.title : "New chat",
        queuedMessageCount: Number(item.queuedMessageCount) || 0,
        activityRevision: Number(item.activityRevision) || 0,
        readRevision: Number(item.readRevision) || 0,
        unread: Number(item.activityRevision) > Number(item.readRevision),
        ...(item.agentTitleLocked === 1 || item.agentTitleLocked === true ? { agentTitleLocked: true } : {}),
        ...(keywords.length ? { keywords } : {}),
        updatedAt: String(item.updatedAt || ""),
        createdAt: String(item.createdAt || ""),
        ...(typeof item.lastMessageSent === "string" ? { lastMessageSent: item.lastMessageSent } : {}),
        ...(typeof item.agentId === "string" ? { agentId: item.agentId } : {}),
        ...(typeof item.modelId === "string" ? { modelId: item.modelId } : {}),
        ...(typeof item.runStatus === "string" ? { runStatus: item.runStatus as ChatRunStatus } : {}),
        ...(typeof item.runUpdatedAt === "string" ? { runUpdatedAt: item.runUpdatedAt } : {}),
        ...(typeof item.queueMessage === "string" ? { queueMessage: item.queueMessage } : {}),
        ...(pendingQuestion ? { pendingQuestion } : {}),
        ...(pendingApproval ? { pendingApproval } : {}),
        ...(typeof item.badge === "string" ? { badge: item.badge as ChatBadge } : {}),
        ...(item.pinned === 1 || item.pinned === true ? { pinned: true } : {}),
        ...(archived ? { archived: true } : {}),
        ...(share ? { share: publicShare(share) as ChatIndexEntry["share"] } : {}),
    ...(typeof item.projectId === "string" && item.projectId ? { projectId: item.projectId } : {}),
      }];
    });
  chatIndexCache = { key: cacheKey, expiresAt: Date.now() + 1_000, chats: result };
  return ownerId ? result.filter(chat => canAccessChat(chat.id,ownerId)).map(chat => chatIndexForUser(chat,ownerId)) : result;
}

export type ChatSearchResult = {
  chatId: string;
  chatTitle: string;
  updatedAt: string;
  messageId?: string;
  role?: ChatMessage["role"];
  snippet: string;
  matchedKeywords?: string[];
};

export async function searchChatsForUser(
  query: string,
  ownerId?: string,
  limit = 30,
): Promise<ChatSearchResult[]> {
  const { searchOffThread } = await import("@/lib/chat-search");
  const deadline=Date.now()+30_000;
  let data=await searchOffThread(query,ownerId,limit);
  while(data.indexing){
    if(Date.now()>deadline)throw new Error("Search index is still preparing. Retry shortly.");
    data=await searchOffThread(query,ownerId,limit);
  }
  return data.results;
}

export function getChat(id: string, ownerId?: string): Chat | null {
  if (!id || id.includes("/") || id.includes("..") || !canAccessChat(id,ownerId)) return null;
  const db = getDatabase();
  // Check the tiny revision row before transferring a potentially huge transcript.
  const identity = ownerId
    ? db.prepare("SELECT updated_at AS updatedAt FROM chats WHERE id = ?").get(id)
    : db.prepare("SELECT updated_at AS updatedAt FROM chats WHERE id = ?").get(id);
  const updatedAt = (identity as { updatedAt?: string } | undefined)?.updatedAt;
  if (!updatedAt) return null;
  const revision=pageState(db,id)?.revision ?? 0;
  const cached = chatCache.get(id);
  if (cached && cached.updatedAt === updatedAt && cached.revision===revision) {
    if (cached.chat.incognito && cached.chat.expiresAt && new Date(cached.chat.expiresAt).getTime() <= Date.now()) {
      getDatabase().prepare("DELETE FROM chats WHERE id = ?").run(id);
      chatCache.delete(id);
      chatIndexCache = null;
      return null;
    }
    return chatForUser({ ...cached.chat, ...getChatActivity(id) },ownerId);
  }
  const row = ownerId
    ? db.prepare("SELECT data FROM chats WHERE id = ?").get(id)
    : db.prepare("SELECT data FROM chats WHERE id = ?").get(id);
  const chat = rowChat(row);
  if (chat?.incognito && chat.expiresAt && new Date(chat.expiresAt).getTime() <= Date.now()) {
    getDatabase().prepare("DELETE FROM chats WHERE id = ?").run(id);
    chatCache.delete(id);
    chatIndexCache = null;
    return null;
  }
  if (chat && updatedAt) chatCache.set(id, { updatedAt, revision, chat });
  return chat ? chatForUser({ ...chat, ...getChatActivity(id) },ownerId) : null;
}

export function getChatPage(
  id: string, ownerId: string | undefined, messageLimit: number, messageOffset: number, before?: number,
) {
  if (!id || id.includes("/") || id.includes("..") || !canAccessChat(id,ownerId)) return null;
  const db=getDatabase();
  // Synchronous internal callers retain their contract. HTTP callers await
  // ensureChatPage first, which performs large legacy recovery off-thread.
  if(!pageIsReady(db,id)) {
    const size=db.prepare("SELECT length(CAST(data AS BLOB)) AS bytes FROM chats WHERE id=?").get(id) as {bytes:number}|undefined;
    if(!size || size.bytes>64*1024)return null;
    rebuildChatPage(db,id);
  }
  const page=readChatPage(db,id,messageLimit,messageOffset,before);
  if(!page)return null;
  if(page.chat.incognito && page.chat.expiresAt && Date.parse(page.chat.expiresAt)<=Date.now())return null;
  return {...page,chat:chatForUser({...page.chat,...getChatActivity(id)},ownerId)};
}

/** Read only metadata even when the canonical transcript exceeds the worker heap. */
export function getChatMetadata(id: string, ownerId?: string): Chat | null {
  if (!id || id.includes("/") || id.includes("..") || !canAccessChat(id, ownerId)) return null;
  const db = getDatabase(), state = pageState(db,id);
  const chat = state?.metadata && state.ready_revision===state.revision
    ? JSON.parse(state.metadata) as Chat
    : rowChat(db.prepare("SELECT json_remove(data,'$.messages') AS data FROM chats WHERE id=?").get(id));
  if (!chat) return null;
  if (chat.incognito && chat.expiresAt && Date.parse(chat.expiresAt) <= Date.now()) return null;
  return chatForUser({ ...chat, ...getChatActivity(id), messages: [] }, ownerId);
}

function saveChatInternal(chat: Chat, options?: { touchUpdatedAt?: boolean; syncKind?: ChatSyncEventKind; metadataProjection?: boolean; pageChange?: { message?: ChatMessage; position?: number; metadataOnly?: boolean } }) {
  // `updated_at` is also the cache revision used by getChat/getChatPage.
  // Every JSON mutation must advance it, including workspace/session changes
  // that do not necessarily change the chat title or message activity.
  const before = options?.metadataProjection ? getChatMetadata(chat.id) : options?.pageChange?.metadataOnly
    ? rowChat(getDatabase().prepare("SELECT json_set(data,\'$.messages\',json(\'[]\')) AS data FROM chats WHERE id = ?").get(chat.id))
    : rowChat(getDatabase().prepare("SELECT data FROM chats WHERE id = ?").get(chat.id));
  const actor = chatActor(chat);
  if (actor && !canAccessChat(chat.id, actor)) throw new Error("Project chat access has been revoked.");
  const updated = { ...sharedChatForStorage(chat,before), ...(options?.touchUpdatedAt === false ? {} : { updatedAt: now() }) };
  // Removal wins over delayed browser autosaves and stale worker projections.
  // Keep tombstones outside the JSON projection so an old snapshot cannot erase them.
  const removed = new Set((getDatabase().prepare(
    "SELECT message_id FROM queue_message_removals WHERE chat_id = ?",
  ).all(updated.id) as Array<{ message_id: string }>).map((row) => row.message_id));
  if (removed.size) updated.removedQueuedMessageIds = [...removed];
  else delete updated.removedQueuedMessageIds;
  if (updated.queuedMessages?.length) {
    const remaining = updated.queuedMessages.filter((message) => !removed.has(message.id));
    if (remaining.length) updated.queuedMessages = remaining;
    else delete updated.queuedMessages;
  }
  if (options?.metadataProjection) {
    const db = getDatabase();
    const state = pageState(db, updated.id);
    const { messages: _messages, ...metadata } = updated;
    // Bind whole top-level values rather than JSON Merge Patch: nested nulls
    // are legitimate session/workspace data, and messages must never be replaced.
    const removedKeys = Object.keys(before || {}).filter(key => key !== "messages" && metadata[key as keyof typeof metadata] === undefined);
    const changedKeys = Object.keys(metadata).filter(key => metadata[key as keyof typeof metadata] !== undefined &&
      JSON.stringify(metadata[key as keyof typeof metadata]) !== JSON.stringify(before?.[key as keyof Chat]));
    let expression = "data";
    const values: string[] = [];
    if (removedKeys.length) {
      expression = "json_remove(" + expression + "," + removedKeys.map(() => "?").join(",") + ")";
      values.push(...removedKeys.map(key => "$." + JSON.stringify(key)));
    }
    if (changedKeys.length) {
      expression = "json_set(" + expression + "," + changedKeys.map(() => "?,json(?)").join(",") + ")";
      for (const key of changedKeys) values.push("$." + JSON.stringify(key), JSON.stringify(metadata[key as keyof typeof metadata]));
    }
    db.prepare("UPDATE chats SET data=" + expression + ",updated_at=? WHERE id=?").run(...values, updated.updatedAt, updated.id);
    // Metadata writes leave message/search rows unchanged. Advance only indexes
    // that were already current; stale/legacy pages still require their backfill.
    db.prepare("UPDATE chat_search_state SET ready_revision=ready_revision+1 WHERE chat_id=? AND ready_revision=?")
      .run(updated.id, state?.revision ?? -1);
    if (state?.metadata && state.ready_revision === state.revision) {
      db.prepare("UPDATE chat_page_state SET metadata=?,ready_revision=revision WHERE chat_id=?")
        .run(JSON.stringify(metadata), updated.id);
    }
  } else getDatabase()
    .prepare(
      `INSERT INTO chats (id, owner_id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id, data=excluded.data,
       created_at=excluded.created_at, updated_at=excluded.updated_at`,
    )
    .run(
      updated.id,
      updated.ownerId ?? null,
      JSON.stringify(updated),
      updated.createdAt,
      updated.updatedAt,
    );
  if (!options?.metadataProjection) {
    getDatabase().prepare("DELETE FROM chat_message_checkpoints WHERE chat_id=?").run(updated.id);
    syncChatPage(getDatabase(), updated, options?.pageChange);
  }
  if(!options?.pageChange?.metadataOnly) recordMessageActivity(updated.id, before?.messages ?? [], updated.messages);
  recordAttentionActivity(updated.id, before, updated);
  Object.assign(updated, getChatActivity(updated.id));
  syncChatList(updated);
  recordChatSyncEvent({
    ownerId: updated.ownerId,
    chatId: updated.id,
    kind: options?.syncKind || "updated",
    chatUpdatedAt: updated.updatedAt,
  });
  if (options?.metadataProjection) chatCache.delete(updated.id);
  else chatCache.set(updated.id, { updatedAt: updated.updatedAt, revision:pageState(getDatabase(),updated.id)?.revision ?? 0, chat: updated });
  chatIndexCache = null;
  return chatForUser(updated,actor);
}

export function createChat(
  title = "New chat",
  browserContext?: BrowserContext,
  ownerId?: string,
  model?: { id?: string; params?: Array<{ id: string; value: string }> },
  options?: { incognito?: boolean; projectId?: string },
): Chat {
  return transaction(() => {
    if (!workerProjectionLeaseValid()) {
      throw new Error("Stale worker lease cannot create a chat projection.");
    }
    if(options?.projectId && ownerId && !projectRole(options.projectId,ownerId)) throw new Error("Project not found");
    if(options?.projectId && options.incognito) throw new Error("Private chats cannot be shared in projects.");
    const timestamp = now();
    const chat: Chat = {
      id: randomUUID(),
      ...(ownerId ? { ownerId } : {}),
      ...(options?.incognito
        ? { incognito: true, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
        : {}),
      ...(options?.projectId ? { projectId: options.projectId } : {}),
      title: title.trim() || "New chat",
      titleSource: "default",
      ...(model?.id ? { modelId: model.id } : {}),
      ...(Array.isArray(model?.params) ? { modelParams: model.params } : {}),
      messages: [],
      ...(browserContext ? { browserContext: { ...browserContext, updatedAt: timestamp } } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const projectModel = projectModelOverride(chat.projectId, chat.ownerId);
    if (projectModel) Object.assign(chat, projectModel);
    saveChatInternal(chat, { syncKind: "created" });
    return chat;
  });
}

export function cleanupExpiredIncognitoChats() {
  const db = getDatabase(), timestamp = now();
  // A no-op DELETE still takes SQLite's writer lock. Sidebar polling is read-only
  // unless there is actual expired data to remove.
  if (!db.prepare("SELECT 1 FROM chat_list WHERE incognito=1 AND expires_at IS NOT NULL AND expires_at<=? LIMIT 1").get(timestamp)) return 0;
  const result = db.prepare(
    `DELETE FROM chats WHERE id IN (
      SELECT id FROM chat_list
      WHERE incognito = 1 AND expires_at IS NOT NULL AND expires_at <= ?
    )`,
  ).run(timestamp);
  if (result.changes > 0) {
    chatIndexCache = null;
    for (const id of [...chatCache.keys()]) {
      const chat = chatCache.get(id)?.chat;
      if (chat?.incognito) chatCache.delete(id);
    }
  }
  return result.changes;
}

export function saveChat(chat: Chat) {
  return transaction(() => saveChatInternal(chat));
}

export function updateChat(
  id: string,
  patch: {
    title?: string;
    titleSource?: "default" | "user" | "agent";
    agentTitleLocked?: boolean;
    keywords?: string[] | null;
    agentId?: string | null;
    modelId?: string | null;
    modelParams?: Array<{ id: string; value: string }> | null;
    mergeQueuedMessages?: boolean;
    queuedMessages?: Array<{
      id: string;
      text: string;
      referenceText?: string;
      references?: ChatMessage["references"];
        attachments?: ChatMessage["attachments"];
      }> | null;
    pinned?: boolean;
    archived?: boolean;
    canvas?: string | null;
    workspaces?: WorkspaceItem[] | null;
    browserContext?: BrowserContext | null;
    sessionState?: ChatSessionState | null;
    runStatus?: ChatRunStatus;
    runUpdatedAt?: string | null;
    queueMessage?: string | null;
    pendingQuestion?: PendingChatQuestion | null;
    runtimeMode?: string | null;
    pendingApproval?: Chat["pendingApproval"] | null;
    approvedPatterns?: string[] | null;
    badge?: ChatBadge | null;
    readRevision?: number;
    touchUpdatedAt?: boolean;
    projectId?: string | null;
  },
  ownerId?: string,
  options?: { metadataProjection?: boolean },
) {
  return transaction(() => {
    if (!workerProjectionLeaseValid(id)) return null;
    const chat = options?.metadataProjection ? getChatMetadata(id, ownerId) : getChat(id, ownerId);
    if (!chat) return null;
    if(patch.projectId && ownerId && (!projectRole(patch.projectId,ownerId) || chat.incognito)) throw new Error("Project not found or chat is private.");
    if (patch.projectId !== undefined && patch.projectId !== chat.projectId && ownerId && chat.ownerId !== ownerId && !(patch.projectId===null && projectRole(chat.projectId,ownerId)==="owner")) throw new Error("Only the chat creator can move this chat.");
    const next = { ...chat };
    if (patch.title !== undefined) {
      const title = normalizeChatTitle(patch.title);
      if (title) next.title = title;
    }
    if (patch.titleSource) next.titleSource = patch.titleSource;
    if (patch.agentTitleLocked !== undefined) {
      next.agentTitleLocked = patch.agentTitleLocked;
    }
    if (patch.keywords === null) {
      delete next.keywords;
    } else if (patch.keywords) {
      const keywords = normalizeChatKeywords(patch.keywords);
      if (keywords.length) next.keywords = keywords;
      else delete next.keywords;
    }
    if (patch.agentId === null) delete next.agentId;
    else if (patch.agentId !== undefined) next.agentId = patch.agentId.trim() || undefined;
    if (patch.modelId === null) delete next.modelId;
    else if (patch.modelId !== undefined) next.modelId = patch.modelId.trim() || undefined;
    if (patch.runtimeMode === null) delete next.runtimeMode;
    else if (patch.runtimeMode !== undefined) {
      const requested = patch.runtimeMode.trim();
      if ((RUNTIME_MODES as readonly string[]).includes(requested)) next.runtimeMode = requested;
    }
    if (patch.modelParams === null) delete next.modelParams;
    else if (patch.modelParams) next.modelParams = patch.modelParams;
    if (patch.queuedMessages === null) delete next.queuedMessages;
    else if (patch.queuedMessages) {
      const queued = patch.queuedMessages
        .filter((item) => item && typeof item.id === "string" && typeof item.text === "string")
        .map((item) => ({
          id: item.id.slice(0, 200),
          text: item.text.slice(0, 100_000),
          ...(typeof item.referenceText === "string" && item.referenceText.trim()
            ? { referenceText: item.referenceText.slice(0, 100_000) }
            : {}),
          ...(Array.isArray(item.references)
            ? {
                references: item.references
                  .filter((reference) => reference && typeof reference.id === "string" && typeof reference.kind === "string" && typeof reference.label === "string")
                  .slice(0, 20)
                  .map((reference) => ({
                    kind: reference.kind.slice(0, 40),
                    id: reference.id.slice(0, 300),
                    label: reference.label.slice(0, 300),
                    ...(reference.source === "explicit" || reference.source === "pinned" ? { source: reference.source } : {}),
                    ...(typeof reference.detail === "string" ? { detail: reference.detail.slice(0, 500) } : {}),
                    ...(typeof reference.path === "string" ? { path: reference.path.slice(0, 4_000) } : {}),
                    ...(typeof reference.content === "string" ? { content: reference.content.slice(0, 8_000) } : {}),
                  })),
              }
            : {}),
        
          ...(Array.isArray(item.attachments)
            ? {
                attachments: item.attachments
                  .filter((attachment) => attachment && typeof attachment.id === "string" && typeof attachment.storedName === "string")
                  .slice(0, 10)
                  .map((attachment) => ({
                    id: String(attachment.id).slice(0, 200),
                    name: String(attachment.name || "file").slice(0, 200),
                    mimeType: String(attachment.mimeType || "application/octet-stream").slice(0, 120),
                    kind: attachment.kind === "image" ? "image" as const : "file" as const,
                    storedName: String(attachment.storedName).slice(0, 200),
                    size: Math.max(0, Math.floor(Number(attachment.size) || 0)),
                  })),
              }
            : {}),
        }))
        .filter((item) => item.text.trim() || (Array.isArray(item.attachments) && item.attachments.length))
        .slice(0, 50);
      const consumedIds = new Set(
        options?.metadataProjection
          ? (getDatabase().prepare(`SELECT json_extract(value,'$.id') AS id FROM chats,json_each(chats.data,'$.messages')
              WHERE chats.id=? AND json_extract(value,'$.role')='user'`).all(id) as Array<{ id: string }>).map(row => row.id)
          : next.messages.filter((message) => message.role === "user").map((message) => message.id),
      );
      // Browser snapshots can arrive out of order (including an empty snapshot
      // captured before enqueue). Absence is not deletion: DELETE owns removal.
      // Honor explicit queue reordering, then retain items absent from a stale
      // snapshot so another save cannot silently delete a queued follow-up.
      const merged = new Map(queued.map((item) => [item.id, item]));
      if (patch.mergeQueuedMessages) {
        for (const item of next.queuedMessages ?? []) {
          if (!merged.has(item.id)) merged.set(item.id, item);
        }
      }
      const pending = [...merged.values()].filter((item) => !consumedIds.has(item.id)).slice(0, 50);
      if (pending.length) next.queuedMessages = pending;
      else delete next.queuedMessages;
    }
    if (patch.pinned !== undefined) {
      if (patch.pinned) next.pinned = true;
      else delete next.pinned;
    }
    if (patch.archived !== undefined) {
      if (patch.archived) next.archived = true;
      else delete next.archived;
    }
    if (patch.projectId === null) delete next.projectId;
    else if (typeof patch.projectId === "string") {
      const id = patch.projectId.trim();
      if (id) next.projectId = id;
      else delete next.projectId;
    }
    if (patch.canvas === null) delete next.canvas;
    else if (patch.canvas !== undefined) next.canvas = patch.canvas;
    if (patch.workspaces === null) {
      delete next.workspaces;
    } else if (patch.workspaces) {
      const names = new Set<string>();
      for (const workspace of patch.workspaces) {
        const key = workspace.name.trim().toLocaleLowerCase();
        if (!key) continue;
        if (names.has(key)) {
          const error = new Error("A workspace with this name already exists.");
          error.name = "WorkspaceNameConflict";
          throw error;
        }
        names.add(key);
      }
      // The browser sends the complete current workspace list. Replacing it
      // is important here: omitted items were explicitly deleted by the user
      // and must not be resurrected from the previous chat snapshot.
      next.workspaces = [...patch.workspaces].slice(-20);
    }
    if (patch.browserContext === null) delete next.browserContext;
    else if (patch.browserContext) {
      const incomingTs = Date.parse(patch.browserContext.updatedAt || "") || 0;
      const existingTs = Date.parse(next.browserContext?.updatedAt || "") || 0;
      if (!existingTs || incomingTs >= existingTs) {
        next.browserContext = {
          ...patch.browserContext,
          updatedAt: patch.browserContext.updatedAt || now(),
        };
      }
    }
    if (patch.sessionState === null) delete next.sessionState;
    else if (patch.sessionState) {
      const previous = next.sessionState || {};
      const merged = { ...previous, ...patch.sessionState };
      const incomingInputTs = Date.parse(patch.sessionState.inputUpdatedAt || "") || 0;
      const existingInputTs = Date.parse(previous.inputUpdatedAt || "") || 0;
      if ("input" in patch.sessionState && existingInputTs && incomingInputTs && incomingInputTs < existingInputTs) {
        merged.input = previous.input;
        merged.inputUpdatedAt = previous.inputUpdatedAt;
      }
      const incomingUrlTs = Date.parse(patch.sessionState.browserUrlUpdatedAt || "") || 0;
      const existingUrlTs = Date.parse(previous.browserUrlUpdatedAt || "") || 0;
      if ("browserUrl" in patch.sessionState && existingUrlTs && incomingUrlTs && incomingUrlTs < existingUrlTs) {
        merged.browserUrl = previous.browserUrl;
        merged.browserUrlUpdatedAt = previous.browserUrlUpdatedAt;
      }
      if ("goal" in patch.sessionState) {
        const goal = typeof patch.sessionState.goal === "string" ? patch.sessionState.goal.trim().slice(0, 4_000) : "";
        if (goal) merged.goal = goal;
        else {
          delete merged.goal;
          delete merged.goalReferences;
          delete merged.goalOriginChatId;
        }
      }
      if ("goalReferences" in patch.sessionState && merged.goal) {
        const references = Array.isArray(patch.sessionState.goalReferences)
          ? patch.sessionState.goalReferences.slice(0, 20).filter((reference) =>
              reference && typeof reference.kind === "string" && typeof reference.id === "string" && typeof reference.label === "string",
            ).map((reference) => ({
              kind: reference.kind.slice(0, 40),
              id: reference.id.slice(0, 500),
              label: reference.label.slice(0, 200),
              ...(reference.detail ? { detail: reference.detail.slice(0, 500) } : {}),
              ...(reference.path ? { path: reference.path.slice(0, 2_000) } : {}),
              ...(reference.content ? { content: reference.content.slice(0, 12_000) } : {}),
            }))
          : [];
        if (references.length) merged.goalReferences = references;
        else delete merged.goalReferences;
      }
      next.sessionState = merged;
    }
    const projectModel = projectModelOverride(next.projectId, next.ownerId);
    if (projectModel) Object.assign(next, projectModel);
    if (patch.runStatus) {
      const previousStatus = next.runStatus || "idle";
      if (!canTransitionRunStatus(previousStatus, patch.runStatus)) {
        const error = new Error(`Invalid run state transition: ${previousStatus} -> ${patch.runStatus}`);
        error.name = "InvalidRunStateTransition";
        throw error;
      }
      next.runStatus = patch.runStatus;
      next.runUpdatedAt = patch.runUpdatedAt || now();
    } else if (patch.runUpdatedAt === null) delete next.runUpdatedAt;
    if (patch.queueMessage === null) delete next.queueMessage;
    else if (patch.queueMessage !== undefined) next.queueMessage = patch.queueMessage.trim().slice(0, 200) || undefined;
    if (patch.pendingQuestion === null) delete next.pendingQuestion;
    else if (patch.pendingQuestion) next.pendingQuestion = patch.pendingQuestion;
    if (patch.pendingApproval === null) delete next.pendingApproval;
    else if (patch.pendingApproval) {
      next.pendingApproval = {
        id: String(patch.pendingApproval.id || "").slice(0, 200),
        title: String(patch.pendingApproval.title || "").slice(0, 500),
        ...(typeof patch.pendingApproval.command === "string" && patch.pendingApproval.command.trim()
          ? { command: patch.pendingApproval.command.slice(0, 20_000) }
          : {}),
        ...(Array.isArray(patch.pendingApproval.files)
          ? {
              files: patch.pendingApproval.files
                .map((file) => ({
                  path: String(file?.path || "").slice(0, 2_000),
                  status: String(file?.status || "").slice(0, 100),
                }))
                .filter((file) => file.path)
                .slice(0, 100),
            }
          : {}),
        createdAt: String(patch.pendingApproval.createdAt || now()),
      };
    }
    if (patch.approvedPatterns === null) delete next.approvedPatterns;
    else if (patch.approvedPatterns !== undefined) {
      const approvedPatterns = [...new Set(
        patch.approvedPatterns.map((pattern) => String(pattern || "").trim()).filter(Boolean),
      )].slice(0, 100);
      if (approvedPatterns.length) next.approvedPatterns = approvedPatterns;
      else delete next.approvedPatterns;
    }
    if (patch.readRevision !== undefined && Number.isSafeInteger(patch.readRevision) && patch.readRevision >= 0) {
      Object.assign(next, acknowledgeChatActivity(id, patch.readRevision));
    }
    if (patch.badge === null && (patch.readRevision === undefined || patch.readRevision >= getChatActivity(id).activityRevision)) delete next.badge;
    else if (patch.badge) next.badge = patch.badge;
    return saveChatInternal(next, { touchUpdatedAt: patch.touchUpdatedAt !== false, metadataProjection: options?.metadataProjection, pageChange: { metadataOnly: true } });
  });
}

const RUN_STATUS_TRANSITIONS: Record<ChatRunStatus, readonly ChatRunStatus[]> = {
  idle: ["idle", "running", "paused", "waiting_for_user", "waiting_input", "cancelled", "interrupted", "completed", "failed", "error"],
  running: ["running", "paused", "waiting_for_user", "waiting_input", "completed", "cancelled", "interrupted", "failed", "error"],
  paused: ["paused", "running", "cancelled", "interrupted", "failed", "error"],
  // The worker may finish immediately after the answer is persisted while
  // another process still observes the previous durable chat snapshot.
  waiting_for_user: ["waiting_for_user", "running", "completed", "cancelled", "interrupted", "failed", "error"],
  waiting_input: ["waiting_input", "running", "cancelled", "interrupted", "failed", "error"],
  completed: ["completed", "running", "cancelled"],
  cancelled: ["cancelled", "running"],
  failed: ["failed", "running", "cancelled"],
  interrupted: ["interrupted", "running", "cancelled", "failed"],
  error: ["error", "running", "cancelled"],
};

export function canTransitionRunStatus(from: ChatRunStatus, to: ChatRunStatus) {
  return RUN_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function deleteChat(id: string, ownerId?: string) {
  return transaction(() => {
    const chat = getChat(id, ownerId);
    if (!chat || (ownerId && chat.ownerId !== ownerId && projectRole(chat.projectId,ownerId)!=="owner")) return false;
    if (chat.ownerId) syncAccountUsage(chat.ownerId);
    recordChatSyncEvent({
      ownerId: chat.ownerId,
      chatId: id,
      kind: "deleted",
      chatUpdatedAt: now(),
    });
    const deleted = getDatabase().prepare("DELETE FROM chats WHERE id = ?").run(id).changes > 0;
    if (deleted) {
      chatCache.delete(id);
      chatIndexCache = null;
    }
    return deleted;
  });
}

export function updateChatShare(
  chatId: string,
  patch: {
    active?: boolean;
    password?: string | null;
    content?: ChatShare["content"];
  },
  ownerId?: string,
) {
  return transaction(() => {
    const chat = getChat(chatId, ownerId);
    if (!chat || (chat.projectId && ownerId && projectRole(chat.projectId,ownerId)!=="owner")) return null;
    const timestamp = now();
    const current = chat.share;
    const share: ChatShare = {
      id: current?.id || randomUUID(),
      accessKey: randomUUID(),
      active: patch.active ?? current?.active ?? true,
      createdAt: current?.createdAt || timestamp,
      updatedAt: timestamp,
      ...(current?.passwordHash ? { passwordHash: current.passwordHash } : {}),
      ...(!current ? { content: { attachments: true, thinking: true, tools: true, suggestions: true, sources: true, workspaces: true } }
        : current.content ? { content: { ...current.content } } : {}),
    };
    if (patch.password !== undefined) {
      if (patch.password?.trim()) share.passwordHash = hashSharePassword(patch.password.trim());
      else delete share.passwordHash;
    }
    if (patch.content) {
      share.content = {
        attachments: Boolean(patch.content.attachments),
        thinking: Boolean(patch.content.thinking),
        tools: Boolean(patch.content.tools),
        suggestions: Boolean(patch.content.suggestions),
        sources: Boolean(patch.content.sources),
        workspaces: Boolean(patch.content.workspaces),
      };
    }
    chat.share = share;
    return saveChatInternal(chat);
  });
}

export function deleteChatShare(chatId: string, ownerId?: string) {
  return transaction(() => {
    const chat = getChat(chatId, ownerId);
    if (!chat) return null;
    if (!chat.share) return chat;
    delete chat.share;
    return saveChatInternal(chat);
  });
}

function findChatByShareId(shareId: string) {
  const trimmed = shareId.trim();
  if (!trimmed) return null;
  const row = getDatabase()
    .prepare(
      `SELECT data FROM chats WHERE json_extract(data, '$.share.id') = ? LIMIT 1`,
    )
    .get(trimmed);
  const chat = rowChat(row);
  return chat?.share?.id === trimmed && chat.share.active ? chat : null;
}

export function getChatByShareId(shareId: string, password?: string, credential?: string) {
  if (!shareId.trim()) return { status: "not_found" as const };
  const chat = findChatByShareId(shareId);
  if (!chat?.share || !chat.share.active) return { status: "not_found" as const };
  if (chat.share.passwordHash && (!password || !verifySharePassword(password, chat.share.passwordHash)) && !validChatShareAccess(chat.share,credential)) {
    return { status: "password_required" as const, share: publicShare(chat.share) };
  }
  return { status: "ok" as const, chat: publicChat(chat), ownerId: chat.ownerId };
}

export function unlockChatShare(shareId: string, password: string) {
  const chat = findChatByShareId(shareId);
  if (!chat?.share || (chat.share.passwordHash && !verifySharePassword(password,chat.share.passwordHash))) return null;
  return createChatShareAccess(chat.share);
}

export function cloneChatByShareId(shareId: string, password: string | undefined, ownerId: string) {
  return transaction(() => {
    if (!shareId.trim() || !ownerId) return { status: "not_found" as const };
    const source = findChatByShareId(shareId);
    if (!source?.share || (source.share.passwordHash && (!password || !verifySharePassword(password, source.share.passwordHash)))) {
      return { status: "not_found" as const };
    }

    const timestamp = now();
    const clonedId = randomUUID();
    const cloned: Chat = {
      ...source,
      id: clonedId,
      ownerId,
      createdAt: timestamp,
      updatedAt: timestamp,
      runStatus: "idle",
    };
    delete cloned.share;
    delete cloned.agentId;
    delete cloned.runUpdatedAt;
    delete cloned.pendingQuestion;
    delete cloned.pendingApproval;
    delete cloned.approvedPatterns;

    const attachments = cloned.messages.flatMap((message) => message.attachments || []);
    if (attachments.length) {
      const targetDir = chatUploadDir(clonedId, ownerId);
      ensureSafeDirectory(targetDir);
      for (const attachment of attachments) {
        const sourcePath = resolveUploadPath(source.id, attachment.storedName, source.ownerId);
        if (sourcePath && existsSync(sourcePath)) {
          copySafeFile(sourcePath,path.join(targetDir,path.basename(attachment.storedName)),{exclusive:true,mode:0o644});
        }
      }
    }
    saveChatInternal(cloned);
    return { status: "ok" as const, chat: cloned };
  });
}


export function removeQueuedMessage(chatId: string, messageId: string, ownerId?: string) {
  return transaction(() => {
    const chat = getChat(chatId, ownerId);
    if (!chat) return null;
    // Record the intent even if the first queue PATCH has not arrived yet.
    getDatabase().prepare(
      "INSERT OR IGNORE INTO queue_message_removals (chat_id, message_id) VALUES (?, ?)",
    ).run(chatId, messageId);
    const nextQueue = (chat.queuedMessages ?? []).filter((message) => message.id !== messageId);
    const next = { ...chat };
    if (nextQueue.length) next.queuedMessages = nextQueue;
    else delete next.queuedMessages;
    return saveChatInternal(next);
  });
}

export function claimQueuedMessageInTransaction(chatId: string, ownerId?: string) {
  const chat = getChat(chatId, ownerId);
  const message = chat?.queuedMessages?.[0];
  if (!chat || !message || isChatWaitingForUser(chat)) return null;
  const next = { ...chat };
  const remaining = chat.queuedMessages!.slice(1);
  if (remaining.length) next.queuedMessages = remaining;
  else delete next.queuedMessages;
  next.messages = [
    ...next.messages,
    {
      id: message.id,
      role: "user",
      content: message.text.trim() || (message.attachments?.length
        ? `Attached ${message.attachments.length} file${message.attachments.length === 1 ? "" : "s"}`
        : ""),
      ...(message.referenceText ? { referenceText: message.referenceText } : {}),
      ...(message.references?.length ? { references: message.references } : {}),
      ...(message.attachments?.length ? { attachments: message.attachments } : {}),
      createdAt: now(),
    },
  ];
  next.runStatus = "running";
  next.runUpdatedAt = now();
  delete next.queueMessage;
  return { chat: saveChatInternal(next), message };
}

export function listChatsWithQueuedMessages() {
  const rows = getDatabase().prepare(
    `SELECT data FROM chats
     WHERE json_type(data, '$.queuedMessages') = 'array'
       AND json_array_length(json_extract(data, '$.queuedMessages')) > 0
     ORDER BY updated_at ASC`,
  ).all();
  return rows
    .map((row) => rowChat(row))
    .filter((chat): chat is Chat => Boolean(chat?.queuedMessages?.length));
}

/** Submission only needs the appended message, not a multi-megabyte Chat return.
 * All durable effects remain in the caller's enqueue transaction. */
export function appendIndexedMessageInTransaction(
 chatId:string,
 message:Omit<ChatMessage,"id"|"createdAt"> & {id?:string;createdAt?:string},
 ownerId?:string,
):ChatMessage|null {
 if(!workerProjectionLeaseValid(chatId) || !getChatMetadata(chatId,ownerId))return null;
 const db=getDatabase(),state=pageState(db,chatId);
 const search=db.prepare("SELECT ready_revision FROM chat_search_state WHERE chat_id=?").get(chatId) as {ready_revision:number}|undefined;
 const id=message.id || randomUUID();
 if(!state?.metadata || state.ready_revision!==state.revision || search?.ready_revision!==state.revision) {
  return appendMessageInTransaction(chatId,{...message,id},ownerId)?.messages.find(item=>item.id===id) ?? null;
 }
 const existing=db.prepare("SELECT data FROM chat_page_messages WHERE chat_id=? AND message_id=?").get(chatId,id) as {data:string}|undefined;
 if(existing)return JSON.parse(existing.data) as ChatMessage;
 const next={...message,id,createdAt:message.createdAt || now()} as ChatMessage;
 const before=JSON.parse(state.metadata) as Chat;
 const updated={...before,updatedAt:now(),messages:[next]};
 if(next.role==="user")updated.lastMessageSent=next.createdAt;
 db.prepare("UPDATE chats SET data=json_set(data,'$.updatedAt',?,'$.lastMessageSent',json(?),'$.messages[#]',json(?)),updated_at=? WHERE id=?")
  .run(updated.updatedAt,JSON.stringify(updated.lastMessageSent ?? null),JSON.stringify(next),updated.updatedAt,chatId);
 // Existing streaming deltas stay durable and current; this only adds one turn.
 syncChatAppendedPage(db,updated,next,state.total);
 recordMessageActivity(chatId,[],[next]);
 recordAttentionActivity(chatId,before,updated);
 syncChatList(updated);
 chatCache.delete(chatId);chatIndexCache=null;
 recordChatSyncEvent({ownerId:updated.ownerId,chatId,kind:"updated",chatUpdatedAt:updated.updatedAt});
 return next;
}

export function appendMessageInTransaction(
  chatId: string,
  message: Omit<ChatMessage, "id" | "createdAt"> & { id?: string; createdAt?: string },
  ownerId?: string,
) {
  if (!workerProjectionLeaseValid(chatId)) return null;
  const chat = getChat(chatId, ownerId);
  if (!chat) return null;
  const id = message.id || randomUUID();
  if (chat.messages.some((item) => item.id === id)) return chat;
  chat.messages.push({
    ...message,
    id,
    createdAt: message.createdAt || now(),
  });
  if (message.role === "user") {
    chat.lastMessageSent = message.createdAt || chat.messages.at(-1)?.createdAt || now();
  }
  return saveChatInternal(chat, { pageChange: { message: chat.messages.at(-1)!, position: chat.messages.length - 1 } });
}

export function appendMessage(
  chatId: string,
  message: Omit<ChatMessage, "id" | "createdAt"> & { id?: string; createdAt?: string },
  ownerId?: string,
) {
  return transaction(() => appendMessageInTransaction(chatId, message, ownerId));
}

/** Persist only this streaming message; full saves consolidate the durable deltas. */
export function checkpointAssistantMessage(chatId: string, message: Omit<ChatMessage, "createdAt"> & { createdAt?: string }): ChatMessage | null {
  return transaction(() => {
    if (!workerProjectionLeaseValid(chatId)) return null;
    const db=getDatabase(), state=pageState(db,chatId);
    const search=db.prepare("SELECT ready_revision FROM chat_search_state WHERE chat_id=?").get(chatId) as {ready_revision:number}|undefined;
    const row=state?.metadata && state.ready_revision===state.revision && search?.ready_revision===state.revision
      ? db.prepare("SELECT position,data FROM chat_page_messages WHERE chat_id=? AND message_id=?").get(chatId,message.id) as {position:number;data:string}|undefined
      : undefined;
    if (!row || message.role!=="assistant") {
      const saved=upsertMessage(chatId,message);
      return saved?.messages.find(item=>item.id===message.id) ?? null;
    }
    const previous=JSON.parse(row.data) as ChatMessage;
    const next=mergeMessageForPersistence(message,previous);
    const updatedAt=now();
    const chat={...JSON.parse(state!.metadata!) as Chat,updatedAt,messages:[next]};
    db.prepare("INSERT INTO chat_message_checkpoints VALUES(?,?,?,?,?) ON CONFLICT(chat_id,message_id) DO UPDATE SET position=excluded.position,data=excluded.data,updated_at=excluded.updated_at")
      .run(chatId,next.id,row.position,JSON.stringify(next),updatedAt);
    syncChatCheckpointPage(db,chat,next,row.position);
    recordMessageActivity(chatId,[previous],[next]);
    syncChatList(chat);
    recordAccountUsage(chatActor(chat) || chat.ownerId,next);
    chatIndexCache=null;
    chatCache.delete(chatId);
    recordChatSyncEvent({ownerId:chat.ownerId,chatId,kind:"updated",chatUpdatedAt:updatedAt});
    return next;
  });
}

function mergeMessageForPersistence(message: Omit<ChatMessage, "createdAt"> & { createdAt?: string }, previous?: ChatMessage): ChatMessage {
  const attachments=[...(previous?.attachments ?? [])];
  for(const attachment of message.attachments ?? []) if(!attachments.some(item=>item.id===attachment.id)) attachments.push(attachment);
  return {...message,...(attachments.length ? {attachments}:{}),createdAt:message.createdAt || previous?.createdAt || now()};
}

export function upsertMessage(chatId: string, message: Omit<ChatMessage, "createdAt"> & { createdAt?: string }) {
  return transaction(() => {
    if (!workerProjectionLeaseValid(chatId)) return null;
    const chat = getChat(chatId);
    if (!chat) return null;
    const index = chat.messages.findIndex((item) => item.id === message.id);
    const previous = chat.messages[index];
    // Files registered by the gateway must survive provider checkpoints that
    // omit attachments or only report a subset of tool results.
    const next = mergeMessageForPersistence(message, previous);
    if (getDatabase().prepare("SELECT 1 FROM chat_message_checkpoints WHERE chat_id=? LIMIT 1").get(chatId)) {
      const position=index>=0 ? index : chat.messages.length;
      if(index>=0)chat.messages[index]=next;else chat.messages.push(next);
      const saved=saveChatInternal(chat,{pageChange:{message:next,position}});
      recordAccountUsage(chatActor(chat) || chat.ownerId,next);
      return saved;
    }
    if (index >= 0) {
      chat.messages[index] = next;
      return persistAssistantMessage(chat, index, next, "set", previous);
    } else {
      chat.messages.push(next);
      return persistAssistantMessage(chat, chat.messages.length - 1, next, "append");
    }
  });
}

export const titleFromMessage = (content: string) => normalizeChatTitle(content) || "New chat";

export function listMemories(ownerId?: string): Memory[] {
  const query = ownerId
    ? "SELECT data FROM memories WHERE owner_id = ? ORDER BY updated_at ASC"
    : "SELECT data FROM memories ORDER BY updated_at ASC";
  return getDatabase()
    .prepare(query)
    .all(...(ownerId ? [ownerId] : []))
    .map((row) => parseData<Memory>(row))
    .filter((memory): memory is Memory => Boolean(memory));
}

export function saveMemories(memories: Memory[], ownerId?: string) {
  transaction(() => {
    const db = getDatabase();
    if (ownerId) db.prepare("DELETE FROM memories WHERE owner_id = ?").run(ownerId);
    else db.prepare("DELETE FROM memories").run();
    const insert = db.prepare("INSERT INTO memories (id, owner_id, data, updated_at) VALUES (?, ?, ?, ?)");
    for (const memory of memories) insert.run(memory.id, ownerId ?? null, JSON.stringify(memory), memory.updatedAt);
  });
}

export function getGlobalModelSettings(ownerId?: string): GlobalModelSettings {
  const row = getDatabase().prepare("SELECT data FROM settings WHERE key = ?").get(ownerId ? `global:${ownerId}` : "global");
  return { ...(parseData<GlobalModelSettings>({ data: (row as { data?: string } | undefined)?.data }) || {}), skillOwnerId: ownerId };
}

export function saveGlobalModelSettings(settings: GlobalModelSettings, ownerId?: string) {
  getDatabase()
    .prepare("INSERT OR REPLACE INTO settings (key, owner_id, data) VALUES (?, ?, ?)")
    .run(ownerId ? `global:${ownerId}` : "global", ownerId ?? null, JSON.stringify(settings));
  return settings;
}

export function createMemory(
  content: string,
  tags?: string[],
  ownerId?: string,
  metadata: Partial<Pick<Memory, "namespace" | "topic" | "confidence" | "importance" | "confirmed" | "source">> = {},
): Memory {
  const memory: Memory = {
    id: randomUUID(),
    content: content.trim(),
    tags,
    createdAt: now(),
    updatedAt: now(),
    namespace: metadata.namespace || (tags?.some((tag) => /preference/i.test(tag)) ? "preferences" : "semantic"),
    topic: metadata.topic || tags?.find((tag) => !tag.startsWith("auto:") && !tag.startsWith("knowledge:")),
    confidence: metadata.confidence ?? 1,
    importance: metadata.importance ?? 0.8,
    confirmed: metadata.confirmed ?? true,
    source: metadata.source || "user",
    state: "active",
  };
  saveMemories([...listMemories(ownerId), memory], ownerId);
  return memory;
}

export function updateMemory(id: string, patch: { content?: string; tags?: string[] }, ownerId?: string) {
  const memory = listMemories(ownerId).find((item) => item.id === id);
  if (!memory) return null;
  const updated = { ...memory, ...patch, updatedAt: now() };
  saveMemories(listMemories(ownerId).map((item) => (item.id === id ? updated : item)), ownerId);
  return updated;
}

export function deleteMemory(id: string, ownerId?: string) {
  const memories = listMemories(ownerId);
  const next = memories.filter((item) => item.id !== id);
  if (next.length === memories.length) return false;
  saveMemories(next, ownerId);
  return true;
}

export function buildSystemContext(memories: Memory[]) {
  return `[SYSTEM CONTEXT]\nMemories:\n${memories.map((memory) => `- ${memory.content}`).join("\n") || "(none yet)"}`;
}

export function getDataPaths() {
  return { DATA_DIR: config.dataDir, databasePath: config.databasePath };
}

export type { BrowserContext, Chat, ChatIndexEntry, ChatMessage, GlobalModelSettings, Memory, PendingChatQuestion, ToolPart, WorkspaceItem };
