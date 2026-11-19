import { MAX_ATTACHMENTS, type UploadedFile } from "./upload-limits";
import type { StoredAttachment } from "./uploads";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DraftAttachments = { uploads: UploadedFile[]; stored: StoredAttachment[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function composerAttachmentKey(chatId: string | null, incognito: boolean) {
  return chatId || (incognito ? "__private_draft__" : "__draft__");
}

function storageKey(ownerId: string, chatId: string | null) {
  return `metis.composer-attachments.v1:${encodeURIComponent(ownerId)}:${chatId === null ? "new" : "chat:" + encodeURIComponent(chatId)}`;
}

function metadata(value: unknown): UploadedFile | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Partial<UploadedFile>;
  if (typeof v.id !== "string" || !v.id || v.id.length > 200
    || typeof v.name !== "string" || !v.name || v.name.length > 512
    || typeof v.mimeType !== "string" || v.mimeType.length > 200
    || typeof v.size !== "number" || !Number.isSafeInteger(v.size) || v.size < 0
    || (v.kind !== "image" && v.kind !== "file")) return;
  return { id: v.id, name: v.name, mimeType: v.mimeType, size: v.size, kind: v.kind };
}

function normalize(value: unknown, existingChat: boolean): DraftAttachments {
  const data = value && typeof value === "object" ? value as Partial<DraftAttachments> : {};
  const uploads: UploadedFile[] = [];
  const stored: StoredAttachment[] = [];
  const seen = new Set<string>();
  if (Array.isArray(data.uploads)) {
    for (const item of data.uploads.slice(0, MAX_ATTACHMENTS)) {
      const file = metadata(item);
      if (!file || !uuid.test(file.id) || file.size <= 0 || seen.has(file.id)) continue;
      seen.add(file.id);
      uploads.push(file);
    }
  }
  if (existingChat && Array.isArray(data.stored)) {
    for (const item of data.stored.slice(0, MAX_ATTACHMENTS - uploads.length)) {
      const file = metadata(item);
      const name = item?.storedName;
      if (!file || seen.has(file.id) || typeof name !== "string" || !name || name.length > 512
        || name === "." || name === ".." || /[/\\\u0000-\u001f\u007f]/u.test(name)) continue;
      seen.add(file.id);
      stored.push({ ...file, storedName: name });
    }
  }
  return { uploads, stored };
}

/** Only browser-local metadata and already uploaded file IDs. Never copy blobs or temporary preview URLs. */
export function readDraftAttachments(storage: DraftStorage, ownerId: string, chatId: string | null): DraftAttachments {
  try { return normalize(JSON.parse(storage.getItem(storageKey(ownerId, chatId)) || "{}"), chatId !== null); }
  catch { return { uploads: [], stored: [] }; }
}

export function saveDraftAttachments(storage: DraftStorage, ownerId: string, chatId: string | null, value: DraftAttachments) {
  try {
    const key = storageKey(ownerId, chatId);
    const normalized = normalize(value, chatId !== null);
    if (normalized.uploads.length || normalized.stored.length) storage.setItem(key, JSON.stringify(normalized));
    else storage.removeItem(key);
    return true;
  } catch { return false; }
}
