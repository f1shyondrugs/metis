import { randomUUID } from "node:crypto";
import { parseImageFraming, withImageFraming } from "@/lib/image-framing";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { zip, unzip, type Zippable, type UnzipFileInfo } from "fflate";
import { z } from "zod";
import { archiveMarkdownUrls as markdownUrls, replaceArchiveUrls as replaceUrls, remapRichArchiveReferences } from "@/lib/note-archive-content";
import { parseInternalLink } from "@/lib/internal-link";
import { getAgentCwd } from "@/lib/mcp";
import { completedUploadPath } from "@/lib/file-upload-store";
import { listNoteAttachmentFiles, validateNoteFiles } from "@/lib/note-attachments";
import { isImageMime, sanitizeFileName } from "@/lib/uploads";
import { mimeTypeFromFileName } from "@/lib/file-types";
import { projectRole } from "@/lib/project-access";
import {
  createNote, getNote, listNotes, updateNote, getIdempotentResponse, saveIdempotentResponse,
  NOTE_FORMAT_VERSION, NoteConflictError, NoteValidationError, validateNoteInput,
  type NoteWriteInput,
} from "@/lib/shared-context";
import { transaction } from "@/lib/sqlite";
import type { SharedNote } from "@/lib/store";

export const MAX_NOTE_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const MAX_NOTE_ARCHIVE_EXPANDED_BYTES = 100 * 1024 * 1024;
export const MAX_NOTE_ARCHIVE_PAGES = 500;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MANIFEST_PATH = ".metis/pages.json";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const attachmentSchema = z.object({
  id: z.string().min(1).max(200), path: z.string().min(1).max(16_000),
  name: z.string().min(1).max(255), mimeType: z.string().max(200),
  kind: z.enum(["image", "file"]), sourceUrl: z.string().max(16_000).optional(),
  asset: z.boolean().optional(),
});
const pageSchema = z.object({
  id: z.string().min(1).max(200), path: z.string().min(1).max(16_000),
  parentId: z.string().min(1).max(200).nullable().default(null),
  title: z.string().max(200), formatVersion: z.literal(NOTE_FORMAT_VERSION).default(NOTE_FORMAT_VERSION),
  sortKey: z.number().finite().optional(), icon: z.string().max(100).nullable().optional(),
  cover: z.string().max(2_048).nullable().optional(), fullWidth: z.boolean().optional(), favorite: z.boolean().optional(),
  kind: z.enum(["note", "project", "image", "file"]).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  archived: z.boolean().optional(),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
  size: z.object({ width: z.number().finite(), height: z.number().finite() }).optional(),
  todos: z.array(z.object({ id: z.string(), content: z.string(), status: z.enum(["pending", "in_progress", "completed"]), chatIds: z.array(z.string()).optional() })).max(80).optional(),
  attachments: z.array(attachmentSchema).max(MAX_ARCHIVE_ENTRIES).default([]),
});
const manifestSchema = z.object({
  format: z.literal("metis-pages"), formatVersion: z.literal(1),
  pages: z.array(pageSchema).min(1).max(MAX_NOTE_ARCHIVE_PAGES),
  warnings: z.array(z.string()).optional(),
});
type ArchiveAttachment = z.infer<typeof attachmentSchema>;
type ArchivePage = z.infer<typeof pageSchema>;
type ImportPage = { key: string; parentKey: string | null; filePath: string; title: string; content: string; fields: NoteWriteInput; attachments: ArchiveAttachment[] };
type ImportResult = { notes: SharedNote[]; rootIds: string[] };

function fail(message: string, status = 400): never { throw new NoteValidationError(message, status); }

function safeArchivePath(name: string) {
  const clean = name.endsWith("/") ? name.slice(0, -1) : name;
  const parts = clean.split("/");
  if (!clean || encoder.encode(name).length > 16_000 || parts.length > 150 || /[\\\x00-\x1f]/.test(name)
    || name.startsWith("/") || /^[a-z]:/i.test(name)
    || parts.some(part => !part || part === "." || part === ".." || ["__proto__", "constructor", "prototype"].includes(part))) {
    fail("Archive contains an unsafe file path.");
  }
  return name;
}

function text(bytes: Uint8Array, field: string) {
  try { return decoder.decode(bytes); } catch { return fail(field + " must contain valid UTF-8 text."); }
}

function relativeUrl(from: string, to: string) {
  return path.posix.relative(path.posix.dirname(from), to).split("/").map(encodeURIComponent).join("/");
}

function readableStem(note: SharedNote) {
  const title = note.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().replace(/^\.+$/, "_") || "Untitled";
  return title + "--" + encodeURIComponent(note.id);
}

export async function exportNoteArchive(input: {
  ownerId?: string; projectId?: string | null; includeArchived?: boolean;
  rootId?: string; expectedVersion?: number; requireAttachments?: boolean;
}) {
  let notes = listNotes(input).filter(note => note.kind !== "learned_fact");
  if (input.rootId) {
    const source = notes.find(note => note.id === input.rootId);
    if (!source) fail("Note not found.", 404);
    if (input.expectedVersion !== undefined && source.version !== input.expectedVersion) throw new NoteConflictError(source);
    const selected = new Set([source.id]);
    for (let size = -1; size !== selected.size;) {
      size = selected.size;
      for (const note of notes) if (note.parentId && selected.has(note.parentId)) selected.add(note.id);
    }
    notes = notes.filter(note => selected.has(note.id));
  }
  if (notes.length > MAX_NOTE_ARCHIVE_PAGES) fail("Export exceeds the 500 page archive limit.", 413);
  const byId = new Map(notes.map(note => [note.id, note]));
  const stems = new Map<string, string>();
  const pagePath = (note: SharedNote, ancestors = new Set<string>()): string => {
    if (stems.has(note.id)) return stems.get(note.id)!;
    if (ancestors.has(note.id) || ancestors.size >= 100) return fail("The page tree contains a cycle or exceeds 100 levels.");
    ancestors.add(note.id);
    const parent = note.parentId ? byId.get(note.parentId) : undefined;
    const stem = parent ? pagePath(parent, ancestors).slice(0, -3) + "/" + readableStem(note) : "pages/" + readableStem(note);
    const result = safeArchivePath(stem + ".md");
    if (result.split("/").length > 101) fail("The page tree exceeds 100 levels.");
    stems.set(note.id, result);
    return result;
  };
  for (const note of notes) pagePath(note);
  const files: Zippable = Object.create(null);
  const pages: ArchivePage[] = [];
  const warnings: string[] = [];
  const attachmentsByNote = new Map<string, ArchiveAttachment[]>();
  const attachmentPaths = new Map<string, string>();
  let expandedBytes = 0, entries = 0;
  const add = (name: string, data: Uint8Array) => {
    safeArchivePath(name);
    expandedBytes += data.byteLength;
    if (++entries > MAX_ARCHIVE_ENTRIES || expandedBytes > MAX_NOTE_ARCHIVE_EXPANDED_BYTES) fail("Export exceeds the 100 MiB expanded archive limit.", 413);
    files[name] = data;
  };
  for (const note of notes) {
    const attachments: ArchiveAttachment[] = [];
    const attached = await listNoteAttachmentFiles(note.id, input.ownerId);
    const candidates = attached.map(file => ({ id: file.id, meta: file.meta as { name: string; mimeType: string; kind: "image" | "file" }, path: file.path, asset: false }));
    if (note.asset && note.ownerId) {
      try {
        candidates.push({ id: note.asset.id, meta: note.asset, path: completedUploadPath(note.ownerId, note.asset.id), asset: true });
      } catch {
        if (input.requireAttachments) fail("Cannot duplicate an unavailable source asset.");
        warnings.push("Asset unavailable for page " + note.id);
      }
    }
    for (const file of candidates) {
      let info;
      try { info = await stat(file.path); } catch {
        if (input.requireAttachments) fail("Cannot duplicate an unavailable source attachment.");
        warnings.push("Attachment unavailable for page " + note.id + ": " + file.id); continue;
      }
      if (!info.isFile()) {
        if (input.requireAttachments) fail("Cannot duplicate an unavailable source attachment.");
        continue;
      }
      if (expandedBytes + info.size > MAX_NOTE_ARCHIVE_EXPANDED_BYTES) fail("Export exceeds the 100 MiB expanded archive limit.", 413);
      const archivePath = "attachments/" + encodeURIComponent(note.id) + "/" + encodeURIComponent(file.id) + "/" + sanitizeFileName(file.meta.name);
      add(archivePath, new Uint8Array(await readFile(file.path)));
      const sourceUrl = file.asset ? "/api/file-uploads/" + file.id + "/file" : "/api/notes/" + encodeURIComponent(note.id) + "/attachments/" + file.id;
      attachments.push({ id: file.id, path: archivePath, name: file.meta.name, mimeType: file.meta.mimeType, kind: file.meta.kind, sourceUrl, ...(file.asset ? { asset: true } : {}) });
      attachmentPaths.set(sourceUrl, archivePath);
    }
    attachmentsByNote.set(note.id, attachments);
  }
  for (const note of notes) {
    const filePath = stems.get(note.id)!;
    const attachments = attachmentsByNote.get(note.id)!;
    const replacements = new Map<string, string>();
    for (const url of markdownUrls(note.content)) {
      const suffix = /[?#].*$/.exec(url)?.[0] ?? "";
      const bare = suffix ? url.slice(0, -suffix.length) : url;
      const attachment = attachmentPaths.get(bare);
      const internal = parseInternalLink(bare);
      if (attachment) replacements.set(url, relativeUrl(filePath, attachment) + suffix);
      else if (internal?.kind === "note") {
        const target = stems.get(internal.id);
        if (target) replacements.set(url, relativeUrl(filePath, target) + suffix);
      } else if (input.requireAttachments) {
        const match = /^\/api\/notes\/([^/]+)\/attachments\/[^/]+$/.exec(bare);
        if (match && byId.has(decodeURIComponent(match[1]))) fail("Cannot duplicate an unavailable referenced attachment.");
      }
    }
    let content = remapRichArchiveReferences(replaceUrls(note.content, replacements), url => replacements.get(url) ?? url, id => stems.has(id) ? relativeUrl(filePath, stems.get(id)!) : id);
    for (const attachment of attachments.filter(file => file.asset)) {
      const url = relativeUrl(filePath, attachment.path);
      if (!content.includes(url)) content += (content ? "\n\n" : "") + (attachment.kind === "image" ? "!" : "") + "[" + attachment.name.replace(/[[\]\\]/g, "\\$&") + "](" + url + ")";
    }
    add(filePath, encoder.encode(content));
    pages.push({
      id: note.id, path: filePath, parentId: note.parentId && byId.has(note.parentId) ? note.parentId : null,
      title: note.title, formatVersion: NOTE_FORMAT_VERSION, sortKey: note.sortKey,
      icon: note.icon, cover: note.cover, fullWidth: note.fullWidth, favorite: note.favorite,
      kind: note.kind === "project" || note.kind === "image" || note.kind === "file" ? note.kind : "note",
      color: note.color, archived: note.archived, position: note.position, size: note.size, todos: note.todos, attachments,
    });
  }
  add(MANIFEST_PATH, encoder.encode(JSON.stringify({ format: "metis-pages", formatVersion: 1, pages, warnings }, null, 2)));
  const result = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 1 }, (error, bytes) => error ? reject(error) : resolve(bytes)));
  if (result.byteLength > MAX_NOTE_ARCHIVE_BYTES) fail("Export exceeds the 50 MiB ZIP limit.", 413);
  return result;
}

async function extractArchive(bytes: Uint8Array) {
  let expanded = 0, entries = 0;
  const seen = new Set<string>();
  const filter = (entry: UnzipFileInfo) => {
    safeArchivePath(entry.name);
    if (seen.has(entry.name)) fail("Archive contains duplicate file paths.");
    seen.add(entry.name);
    if (++entries > MAX_ARCHIVE_ENTRIES) fail("Archive exceeds the 2,000 entry limit.", 413);
    expanded += Math.max(entry.size, entry.originalSize);
    if (!Number.isSafeInteger(expanded) || expanded > MAX_NOTE_ARCHIVE_EXPANDED_BYTES) fail("Archive exceeds the 100 MiB expanded limit.", 413);
    return !entry.name.endsWith("/");
  };
  try {
    return await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
      unzip(bytes, { filter }, (error, files) => error ? reject(error) : resolve(files));
    });
  } catch (error) {
    if (error instanceof NoteValidationError) throw error;
    return fail("Could not read ZIP archive.");
  }
}

function manifestPages(files: Record<string, Uint8Array>): ImportPage[] {
  if (files[MANIFEST_PATH].byteLength > 2 * 1024 * 1024) fail("Archive metadata exceeds 2 MiB.", 413);
  let raw: unknown;
  try { raw = JSON.parse(text(files[MANIFEST_PATH], "Manifest")); } catch { return fail("Invalid Metis archive metadata."); }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) fail("Invalid or unsupported Metis archive metadata.");
  const ids = new Set<string>(), paths = new Set<string>();
  return parsed.data.pages.map(page => {
    safeArchivePath(page.path);
    if (ids.has(page.id) || paths.has(page.path)) fail("Archive contains duplicate page IDs or paths.");
    ids.add(page.id); paths.add(page.path);
    if (!files[page.path] || !/\.md$/i.test(page.path)) fail("Archive page Markdown is missing.");
    for (const attachment of page.attachments) {
      safeArchivePath(attachment.path);
      if (!files[attachment.path]) fail("Archive attachment is missing.");
    }
    const { title, sortKey, formatVersion, icon, cover, fullWidth, favorite, color, archived, position, size, todos } = page;
    return {
      key: page.id, parentKey: page.parentId, filePath: page.path, title, content: text(files[page.path], "Markdown"),
      fields: { sortKey, formatVersion, icon, cover, fullWidth, favorite, color, archived, position, size, todos, kind: page.kind === "project" ? "project" : "note" },
      attachments: page.attachments,
    };
  });
}

function genericPages(files: Record<string, Uint8Array>): ImportPage[] {
  const pages = new Map<string, ImportPage>();
  const realKeys = new Set<string>();
  const keyFor = (name: string) => name.replace(/\.md$/i, "").replace(/\/index$/i, "");
  for (const name of Object.keys(files).filter(name => /\.md$/i.test(name)).sort()) {
    const key = keyFor(name);
    if (realKeys.has(key)) fail("Archive has ambiguous Markdown page paths.");
    realKeys.add(key);
    pages.set(key, { key, parentKey: key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : null, filePath: name, title: path.posix.basename(key), content: text(files[name], "Markdown"), fields: {}, attachments: [] });
  }
  const ensureParent = (key: string) => {
    if (pages.has(key)) return;
    const parentKey = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : null;
    pages.set(key, { key, parentKey, filePath: key + ".md", title: path.posix.basename(key), content: "", fields: {}, attachments: [] });
    if (parentKey) ensureParent(parentKey);
  };
  for (const page of [...pages.values()]) if (page.parentKey) ensureParent(page.parentKey);
  for (const page of pages.values()) {
    const attachedPaths = new Map<string, ArchiveAttachment>();
    for (const url of markdownUrls(page.content)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) continue;
      let local;
      try { local = path.posix.normalize(path.posix.join(path.posix.dirname(page.filePath), decodeURIComponent(url.split(/[?#]/)[0]))); } catch { fail("Invalid local Markdown URL."); }
      if (!files[local] || /\.md$/i.test(local)) continue;
      const mimeType = mimeTypeFromFileName(local);
      if (!attachedPaths.has(local)) attachedPaths.set(local, { id: randomUUID(), path: local, name: path.posix.basename(local), mimeType, kind: isImageMime(mimeType) ? "image" : "file", sourceUrl: url });
    }
    page.attachments = [...attachedPaths.values()];
  }
  return [...pages.values()];
}

function orderedPages(pages: ImportPage[]) {
  if (!pages.length) fail("No Markdown pages found.");
  if (pages.length > MAX_NOTE_ARCHIVE_PAGES) fail("Import exceeds the 500 page limit.", 413);
  const byKey = new Map(pages.map(page => [page.key, page]));
  const ordered: ImportPage[] = [], visited = new Set<string>(), visiting = new Set<string>(), depths = new Map<string, number>();
  const visit = (page: ImportPage) => {
    if (visited.has(page.key)) return;
    if (visiting.has(page.key)) fail("Archive page hierarchy contains a cycle.");
    visiting.add(page.key);
    let depth = 1;
    if (page.parentKey) {
      const parent = byKey.get(page.parentKey);
      if (!parent) fail("Archive parent page is missing.");
      visit(parent);
      depth = (depths.get(parent.key) ?? 0) + 1;
    }
    if (depth > 100) fail("Archive page tree exceeds 100 levels.");
    depths.set(page.key, depth);
    visiting.delete(page.key); visited.add(page.key); ordered.push(page);
  };
  for (const page of pages) {
    validateNoteInput({ ...page.fields, title: page.title, content: page.content });
    visit(page);
  }
  return ordered;
}

export async function importNoteArchive(input: {
  ownerId: string; file: File; projectId?: string | null; parentId?: string | null; idempotencyKey?: string;
  rootTitle?: string; idempotencyScope?: string; sourceSnapshot?: { id: string; version: number };
}): Promise<ImportResult> {
  const idempotencyScope = input.idempotencyScope ?? "note:import";
  const previous = input.idempotencyKey ? getIdempotentResponse<ImportResult>(idempotencyScope, input.idempotencyKey, input.ownerId) : null;
  if (previous) return previous;
  if (input.file.size > MAX_NOTE_ARCHIVE_BYTES) fail("Import must contain a file up to 50 MiB.", 413);
  const extension = path.extname(input.file.name).toLowerCase();
  if (extension !== ".md" && extension !== ".zip") fail("Choose a Markdown (.md) or ZIP (.zip) file.");
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const files = extension === ".zip" ? await extractArchive(bytes) : { [safeArchivePath(path.basename(input.file.name))]: bytes };
  const pages = orderedPages(files[MANIFEST_PATH] ? manifestPages(files) : genericPages(files));
  if (input.rootTitle !== undefined) {
    validateNoteInput({ title: input.rootTitle });
    for (const page of pages) if (!page.parentKey) page.title = input.rootTitle;
  }
  let attachmentCount = 0, attachmentBytes = 0;
  for (const page of pages) {
    const attachmentIds = new Set<string>(), attachmentPaths = new Set<string>();
    for (const attachment of page.attachments) {
      if (attachmentIds.has(attachment.id) || attachmentPaths.has(attachment.path)) fail("Archive page contains duplicate attachments.");
      attachmentIds.add(attachment.id); attachmentPaths.add(attachment.path);
      attachmentBytes += files[attachment.path].byteLength;
      if (++attachmentCount > MAX_ARCHIVE_ENTRIES || attachmentBytes > MAX_NOTE_ARCHIVE_EXPANDED_BYTES) fail("Imported attachments exceed the 100 MiB or 2,000 file limit.", 413);
    }
  }
  let projectId = input.projectId ?? null;
  const targetParent = input.parentId ? getNote(input.parentId, input.ownerId) : null;
  if (input.parentId && (!targetParent || targetParent.kind === "learned_fact")) fail("Parent page not found.");
  if (targetParent && input.projectId === undefined) projectId = targetParent.projectId ?? null;
  if (targetParent && (targetParent.projectId ?? null) !== projectId) fail("Parent and child pages must be in the same project.");
  if (projectId && !projectRole(projectId, input.ownerId)) fail("Project not found.");
  const attachmentBase = path.join(getAgentCwd(input.ownerId), ".note-attachments");
  await mkdir(attachmentBase, { recursive: true });
  const staging = await mkdtemp(path.join(attachmentBase, ".import-"));
  const staged = new Map<string, { dir: string; links: Map<string, string> }>();
  const adopted: string[] = [];
  try {
    for (const page of pages) {
      const dir = path.join(staging, randomUUID()), links = new Map<string, string>();
      for (const attachment of page.attachments) {
        const data = files[attachment.path];
        validateNoteFiles([{ name: attachment.name, size: data.byteLength }], input.ownerId);
        const id = randomUUID(), name = sanitizeFileName(attachment.name);
        const mimeType = isImageMime(attachment.mimeType) ? attachment.mimeType : "application/octet-stream";
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, id), data);
        await writeFile(path.join(dir, id + ".json"), JSON.stringify({ id, name, mimeType, kind: isImageMime(mimeType) ? "image" : "file" }));
        links.set(path.posix.relative(path.posix.dirname(page.filePath), attachment.path), id);
        links.set(relativeUrl(page.filePath, attachment.path), id);
        if (attachment.sourceUrl) links.set(attachment.sourceUrl, id);
      }
      staged.set(page.key, { dir, links });
    }
    return transaction(() => {
      const retry = input.idempotencyKey ? getIdempotentResponse<ImportResult>(idempotencyScope, input.idempotencyKey, input.ownerId) : null;
      if (retry) return retry;
      if (input.sourceSnapshot) {
        const source = getNote(input.sourceSnapshot.id, input.ownerId);
        if (!source || source.kind === "learned_fact") fail("Note not found.", 404);
        if (source.version !== input.sourceSnapshot.version) throw new NoteConflictError(source);
      }
      const created = new Map<string, SharedNote>();
      for (const page of pages) {
        created.set(page.key, createNote({
          ...page.fields, title: page.title, content: page.content, ownerId: input.ownerId, projectId,
          parentId: page.parentKey ? created.get(page.parentKey)!.id : input.parentId ?? null,
          scope: "global",
        }));
      }
      const filePages = new Map(pages.map(page => [page.filePath, created.get(page.key)!.id]));
      const attachmentUrls = new Map<string, string>();
      const sourceAttachmentUrls = new Map<string, string>();
      for (const page of pages) {
        for (const attachment of page.attachments) {
          const id = staged.get(page.key)!.links.get(relativeUrl(page.filePath, attachment.path))!;
          const url = "/api/notes/" + created.get(page.key)!.id + "/attachments/" + id;
          if (!attachmentUrls.has(attachment.path)) attachmentUrls.set(attachment.path, url);
          if (attachment.sourceUrl) sourceAttachmentUrls.set(attachment.sourceUrl, url);
        }
      }
      for (const page of pages) {
        let note = created.get(page.key)!;
        const replacements = new Map<string, string>();
        for (const [url, id] of staged.get(page.key)!.links) replacements.set(url, "/api/notes/" + note.id + "/attachments/" + id);
        for (const url of markdownUrls(page.content)) {
          const suffix = /[?#].*$/.exec(url)?.[0] ?? "";
          const bare = suffix ? url.slice(0, -suffix.length) : url;
          const internal = parseInternalLink(bare);
          if (internal?.kind === "note" && created.has(internal.id)) replacements.set(url, "note://" + created.get(internal.id)!.id + suffix);
          else if (sourceAttachmentUrls.has(bare) && !replacements.has(url)) replacements.set(url, sourceAttachmentUrls.get(bare)! + suffix);
          else if (!/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) {
            let local;
            try { local = path.posix.normalize(path.posix.join(path.posix.dirname(page.filePath), decodeURIComponent(url.split(/[?#]/)[0]))); } catch { continue; }
            if (filePages.has(local)) replacements.set(url, "note://" + filePages.get(local)! + suffix);
            else if (attachmentUrls.has(local) && !replacements.has(url)) replacements.set(url, attachmentUrls.get(local)! + suffix);
          }
        }
        const content = remapRichArchiveReferences(replaceUrls(page.content, replacements), url => replacements.get(url) ?? url, id => {
          if (created.has(id)) return created.get(id)!.id;
          try {
            const local = path.posix.normalize(path.posix.join(path.posix.dirname(page.filePath), decodeURIComponent(id)));
            return filePages.get(local) ?? id;
          } catch { return id; }
        });
        const parsedCover = note.cover ? parseImageFraming(note.cover) : null;
        const coverSource = parsedCover ? sourceAttachmentUrls.get(parsedCover.source) : undefined;
        const cover = coverSource && parsedCover ? withImageFraming(coverSource, parsedCover.framing) : note.cover;
        if (content !== note.content || cover !== note.cover) note = updateNote(note.id, { ownerId: input.ownerId, content, cover, expectedVersion: note.version })!;
        created.set(page.key, note);
      }
      for (const page of pages) {
        if (!page.attachments.length) continue;
        const destination = path.join(attachmentBase, encodeURIComponent(created.get(page.key)!.id));
        mkdirSync(attachmentBase, { recursive: true });
        renameSync(staged.get(page.key)!.dir, destination);
        adopted.push(destination);
      }
      const result = { notes: [...created.values()], rootIds: pages.filter(page => !page.parentKey).map(page => created.get(page.key)!.id) };
      return input.idempotencyKey ? saveIdempotentResponse(idempotencyScope, input.idempotencyKey, result, input.ownerId) : result;
    });
  } catch (error) {
    for (const destination of adopted) rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Duplicate a readable subtree through the same bounded, transactional archive path. */
export async function duplicateNoteSubtree(input: {
  id: string; ownerId: string; expectedVersion?: number; parentId?: string | null; idempotencyKey?: string;
}) {
  validateNoteInput({ expectedVersion: input.expectedVersion, parentId: input.parentId });
  const source = getNote(input.id, input.ownerId);
  if (!source || source.kind === "learned_fact") return null;
  const idempotencyScope = "note:duplicate:" + input.id;
  const previous = input.idempotencyKey ? getIdempotentResponse<ImportResult>(idempotencyScope, input.idempotencyKey, input.ownerId) : null;
  if (previous) return { notes: previous.notes, rootId: previous.rootIds[0] };
  if (input.expectedVersion !== undefined && source.version !== input.expectedVersion) throw new NoteConflictError(source);
  const rootTitle = /\.md$/i.test(source.title) ? source.title.slice(0, -3) + " (copy).md" : source.title + " (copy)";
  validateNoteInput({ title: rootTitle });
  const bytes = await exportNoteArchive({
    ownerId: input.ownerId, projectId: source.projectId ?? null, includeArchived: true,
    rootId: source.id, expectedVersion: source.version, requireAttachments: true,
  });
  const imported = await importNoteArchive({
    ownerId: input.ownerId, projectId: source.projectId ?? null,
    parentId: input.parentId !== undefined ? input.parentId : source.parentId ?? null,
    file: new File([new Uint8Array(bytes)], "duplicate.zip"), rootTitle,
    idempotencyScope, idempotencyKey: input.idempotencyKey,
    sourceSnapshot: { id: source.id, version: source.version },
  });
  return { notes: imported.notes, rootId: imported.rootIds[0] };
}

/** Bound the request stream before the platform multipart parser buffers it. */
export async function noteImportForm(req: Request) {
  const limit = MAX_NOTE_ARCHIVE_BYTES + 1024 * 1024;
  if (Number(req.headers.get("content-length")) > limit) fail("Import request exceeds 51 MiB.", 413);
  if (!req.body) fail("Choose a file to import.");
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); fail("Import request exceeds 51 MiB.", 413); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(req.url, { method: "POST", headers: req.headers, body: bytes }).formData();
}
