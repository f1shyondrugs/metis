import { randomBytes } from "node:crypto";
import { signShareCredential, verifyShareCredential } from "@/lib/share-credential";
import { hashSharePassword, verifySharePassword } from "@/lib/share-password";
import { archiveMarkdownUrls } from "@/lib/note-archive-content";
import { resolveNoteFile } from "@/lib/note-attachments";
import { completedUploadPath, getCompletedUpload } from "@/lib/file-upload-store";
import { fileResponse } from "@/lib/file-response";
import { effectiveFileMime } from "@/lib/file-types";
import { officePreviewResponse } from "@/lib/office-preview";
import { config } from "@/lib/config";
import { noteDescendantIds } from "@/lib/notes-tree";
import type { NoteShareLink, PublicNoteShare, PublicSharedAsset, PublicSharedNote } from "@/lib/note-share-types";
import { getNote, listNotes, normalizeNoteTodos } from "@/lib/shared-context";
import { getDatabase, transaction } from "@/lib/sqlite";
import type { SharedNote } from "@/lib/store";

type ShareRow = {
  note_id: string;
  token: string;
  creator_id: string;
  root_project_id: string | null;
  root_owner_id: string | null;
  created_at: string;
  active: number;
  password_hash: string | null;
  access_key: string | null;
};

export class NoteShareUnavailableError extends Error {
  constructor() {
    super("Note not found or not shareable.");
    this.name = "NoteShareUnavailableError";
  }
}

function readablePage(noteId: string, userId: string, allowArchived = false): SharedNote | null {
  // Never pass an absent identity to the internal, intentionally unscoped note helpers.
  if (!userId) return null;
  const note = getNote(noteId, userId);
  return note && note.kind !== "learned_fact" && (allowArchived || !note.archived) ? note : null;
}

function manageablePage(noteId: string, userId: string, allowArchived = false) {
  const note = readablePage(noteId, userId, allowArchived);
  if (!note) throw new NoteShareUnavailableError();
  return note;
}

function shareRow(noteId: string): ShareRow | undefined {
  return getDatabase().prepare("SELECT * FROM note_shares WHERE note_id=?").get(noteId) as ShareRow | undefined;
}

function sharedRoot(share: ShareRow): SharedNote | null {
  const root = readablePage(share.note_id, share.creator_id);
  if (!root || (root.projectId ?? null) !== share.root_project_id || (root.ownerId ?? null) !== share.root_owner_id) return null;
  return root;
}

function link(share: ShareRow): NoteShareLink {
  return {
    active: Boolean(share.active),
    passwordProtected: Boolean(share.password_hash),
    token: share.token,
    url: "/share/notes/" + share.token,
    createdAt: share.created_at,
  };
}

export function getNoteShare(noteId: string, userId: string): NoteShareLink | null {
  manageablePage(noteId, userId);
  const share = shareRow(noteId);
  return share && sharedRoot(share) ? link(share) : null;
}

/** A repeated create reuses the current grant; rotation permanently replaces its bearer token. */
export function createNoteShare(noteId: string, userId: string, rotate = false): NoteShareLink {
  return transaction(() => {
    const root = manageablePage(noteId, userId);
    const current = shareRow(noteId);
    if (!rotate && current && sharedRoot(current)) {
      if (!current.active) {
        current.active = 1;
        current.access_key = randomBytes(32).toString("hex");
        getDatabase().prepare("UPDATE note_shares SET active=1,access_key=? WHERE note_id=?").run(current.access_key, noteId);
      }
      return link(current);
    }
    const share: ShareRow = {
      note_id: root.id,
      token: randomBytes(32).toString("base64url"),
      creator_id: userId,
      root_project_id: root.projectId ?? null,
      root_owner_id: root.ownerId ?? null,
      created_at: new Date().toISOString(),
      active: 1,
      password_hash: current?.password_hash ?? null,
      access_key: randomBytes(32).toString("hex"),
    };
    getDatabase().prepare(`INSERT INTO note_shares(note_id,token,creator_id,root_project_id,root_owner_id,created_at,active,password_hash,access_key)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(note_id) DO UPDATE SET
      token=excluded.token,creator_id=excluded.creator_id,root_project_id=excluded.root_project_id,
      root_owner_id=excluded.root_owner_id,created_at=excluded.created_at,active=excluded.active,
      password_hash=excluded.password_hash,access_key=excluded.access_key`)
      .run(share.note_id, share.token, share.creator_id, share.root_project_id, share.root_owner_id, share.created_at,
        share.active, share.password_hash, share.access_key);
    return link(share);
  });
}

export function updateNoteShare(noteId: string, userId: string, patch: { active?: boolean; password?: string | null }): NoteShareLink {
  return transaction(() => {
    manageablePage(noteId, userId);
    const current = shareRow(noteId);
    if (!current || !sharedRoot(current)) throw new NoteShareUnavailableError();
    const passwordHash = patch.password === undefined ? current.password_hash :
      patch.password?.trim() ? hashSharePassword(patch.password.trim()) : null;
    const active = patch.active === undefined ? current.active : Number(patch.active);
    const key = patch.password !== undefined || active !== current.active ? randomBytes(32).toString("hex") : current.access_key;
    getDatabase().prepare("UPDATE note_shares SET active=?,password_hash=?,access_key=? WHERE note_id=?")
      .run(active, passwordHash, key, noteId);
    return link({ ...current, active, password_hash: passwordHash, access_key: key });
  });
}

export function revokeNoteShare(noteId: string, userId: string): void {
  transaction(() => {
    manageablePage(noteId, userId, true);
    getDatabase().prepare("DELETE FROM note_shares WHERE note_id=?").run(noteId);
  });
}

function publicPage(note: SharedNote, rootId: string): PublicSharedNote {
  // Use an explicit allowlist: future private note fields must never become public by default.
  const todos = normalizeNoteTodos(note.todos).map(({ id, content, status }) => ({ id, content, status }));
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    ...(todos.length ? { todos } : {}),
    ...(note.kind && note.kind !== "learned_fact" ? { kind: note.kind } : {}),
    parentId: note.id === rootId ? null : note.parentId ?? null,
    sortKey: note.sortKey ?? 0,
    icon: note.icon ?? null,
    fullWidth: Boolean(note.fullWidth),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

type SharedScope = { share: ShareRow; root: SharedNote; notes: SharedNote[] };

/** Read the grant and its live tree in one transaction so moves/revocations cannot mix scopes. */
function sharedScope(token: string): SharedScope | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return transaction(() => {
    const share = getDatabase().prepare("SELECT * FROM note_shares WHERE token=?").get(token) as ShareRow | undefined;
    if (!share || !share.active) return null;
    const root = sharedRoot(share);
    if (!root) return null;
    const candidates = listNotes({ ownerId: share.creator_id, projectId: share.root_project_id })
      .filter(note => note.kind !== "learned_fact" && !note.archived &&
        (share.root_project_id !== null || (note.ownerId ?? null) === share.root_owner_id));
    // Filtering before traversal also excludes descendants behind an archived, inaccessible,
    // cross-container or learned-fact parent instead of promoting them into this public tree.
    if (!candidates.some(note => note.id === root.id)) return null;
    const ids = noteDescendantIds(candidates, root.id);
    return { share, root, notes: candidates.filter(note => ids.has(note.id)) };
  });
}

export function noteShareCookieName(token: string) {
  return "metis_note_share_" + token;
}
export function noteShareCredential(req: Request, token: string): string | undefined {
  return req.headers.get("cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(noteShareCookieName(token) + "="))?.split("=").slice(1).join("=");
}
function canView(share: ShareRow, credential?: string) {
  if (!share.password_hash) return true;
  return verifyShareCredential(share.token, share.access_key || "", credential);
}
export function getSharedNoteAccess(token: string, credential?: string): "not_found" | "password_required" | "ok" {
  const scope = sharedScope(token);
  return !scope ? "not_found" : canView(scope.share, credential) ? "ok" : "password_required";
}
/** A signed, expiring viewer grant tied to this link and current access configuration. */
export function unlockSharedNote(token: string, password: string): string | null {
  const scope = sharedScope(token);
  if (!scope || (scope.share.password_hash && !verifySharePassword(password, scope.share.password_hash))) return null;
  if (!scope.share.access_key) return null;
  return signShareCredential(scope.share.token, scope.share.access_key);
}

type AssetSource =
  | { kind: "note"; noteId: string; attachmentId: string; ownerId: string }
  | { kind: "upload"; uploadId: string; ownerId: string; meta: PublicSharedAsset };

function localAssetPath(source: string): string | null {
  try {
    const url = new URL(source, config.publicUrl);
    // Only local, known storage endpoints are resolved; never fetch or proxy a URL.
    if (url.origin !== new URL(config.publicUrl).origin || url.username || url.password) return null;
    return url.pathname;
  } catch { return null; }
}

function uploadSource(note: SharedNote, uploadId: string, creatorId: string): AssetSource | null {
  // The only candidate namespaces are the readable note creator and the grant creator.
  // Never search accounts for an upload ID.
  for (const ownerId of new Set([note.ownerId, creatorId].filter((id): id is string => Boolean(id)))) {
    try {
      const file = getCompletedUpload(ownerId, uploadId);
      return { kind: "upload", uploadId, ownerId, meta: { url: "", name: file.name, mimeType: file.mimeType, size: file.size } };
    } catch { /* A referenced upload may no longer exist or may belong to a different account. */ }
  }
  return null;
}

function assetSources(scope: SharedScope): Map<string, AssetSource> {
  const sources = new Map<string, AssetSource>();
  const byId = new Map(scope.notes.map(note => [note.id, note]));
  for (const note of scope.notes) {
    const urls = archiveMarkdownUrls(note.content);
    if (note.cover) urls.add(note.cover);
    if (note.asset) urls.add("/api/file-uploads/" + note.asset.id + "/file");
    for (const original of urls) {
      if (sources.has(original)) continue;
      const path = localAssetPath(original);
      if (!path) continue;
      const attachment = /^\/api\/notes\/([^/]+)\/attachments\/([a-f0-9-]{36})$/.exec(path);
      if (attachment) {
        let id: string;
        try { id = decodeURIComponent(attachment[1]); } catch { continue; }
        const target = byId.get(id);
        // Even an explicitly authored link cannot grant files from an unshared page.
        if (target?.ownerId) sources.set(original, { kind: "note", noteId: target.id, attachmentId: attachment[2], ownerId: target.ownerId });
        continue;
      }
      const upload = /^\/api\/file-uploads\/([a-f0-9-]{36})\/file$/.exec(path);
      if (upload) {
        const source = uploadSource(note, upload[1], scope.share.creator_id);
        if (source) sources.set(original, source);
      }
    }
  }
  return sources;
}

function publicAssetUrl(token: string, original: string) {
  return "/api/shared-notes/" + token + "/assets?url=" + encodeURIComponent(original);
}

/** Resolve only explicitly referenced files, covers and note-owned assets from the live subtree. */
export function getSharedNote(token: string, credential?: string): PublicNoteShare | null {
  const scope = sharedScope(token);
  if (!scope || !canView(scope.share, credential)) return null;
  const sources = assetSources(scope);
  const assets: Record<string, string> = Object.create(null);
  for (const original of sources.keys()) assets[original] = publicAssetUrl(token, original);
  const notes = scope.notes.map(note => {
    const page = publicPage(note, scope.root.id);
    if (note.cover && /^#[0-9a-f]{3,8}$/i.test(note.cover)) page.cover = note.cover;
    else if (note.cover && assets[note.cover]) page.cover = assets[note.cover];
    if (note.asset) {
      const original = "/api/file-uploads/" + note.asset.id + "/file";
      const source = sources.get(original);
      if (source?.kind === "upload") page.asset = { ...source.meta, url: assets[original] };
    }
    return page;
  });
  return { rootId: scope.root.id, notes, assets };
}

/** Every file request repeats grant, current membership, subtree and exact-reference checks. */
export async function getSharedNoteAsset(token: string, original: string, req: Request): Promise<Response | null> {
  const scope = sharedScope(token);
  const credential = noteShareCredential(req, token);
  if (!scope || !canView(scope.share, credential)) return null;
  const source = assetSources(scope).get(original);
  if (!source) return null;
  let file: string;
  let meta: { name: string; mimeType: string };
  if (source.kind === "note") {
    const resolved = await resolveNoteFile(source.noteId, source.attachmentId, source.ownerId);
    if (!resolved || typeof resolved.meta?.name !== "string" || typeof resolved.meta?.mimeType !== "string") return null;
    file = resolved.path;
    meta = { name: resolved.meta.name, mimeType: resolved.meta.mimeType };
  } else {
    try { file = completedUploadPath(source.ownerId, source.uploadId); }
    catch { return null; }
    meta = source.meta;
  }
  // File metadata resolution can await I/O. Recheck after it so a revoked grant or moved
  // page cannot complete an authorization check against an earlier subtree.
  const current = sharedScope(token);
  if (!current || !canView(current.share, credential) || JSON.stringify(assetSources(current).get(original)) !== JSON.stringify(source)) return null;
  try {
    return new URL(req.url).searchParams.get("preview") === "1"
      ? officePreviewResponse(file, effectiveFileMime(meta.mimeType, meta.name))
      : fileResponse(file, meta, req);
  } catch { return null; }
}
