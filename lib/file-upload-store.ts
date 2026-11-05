import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, linkSync, copyFileSync, statSync, createReadStream, openSync, closeSync } from "node:fs";
import { open, rm } from "node:fs/promises";
import path from "node:path";
import { fileResponse } from "@/lib/file-response";
import { config } from "@/lib/config";
import { chatUploadDir, isImageMime, sanitizeFileName, type StoredAttachment } from "@/lib/uploads";
import { MAX_ATTACHMENTS, UPLOAD_CHUNK_BYTES, validateAttachmentSize, type UploadedFile } from "@/lib/upload-limits";
import { validateOwnerAttachmentSize } from "@/lib/attachment-settings";

type UploadSession = UploadedFile & { offset: number; complete: boolean; createdAt: number };
const locks = new Set<string>();
function directory(ownerId: string, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Upload not found");
  const owner = createHash("sha256").update(ownerId).digest("hex");
  return path.join(config.dataDir, "file-uploads", owner, id);
}
function save(ownerId: string, upload: UploadSession) {
  const dir = directory(ownerId, upload.id);
  const tmp = path.join(dir, `metadata-${randomUUID()}.tmp`);
  writeFileSync(tmp, JSON.stringify(upload));
  renameSync(tmp, path.join(dir, "metadata.json"));
}
export function createUpload(ownerId: string, input: { name: string; mimeType: string; size: number }, limits?: { maxBytes: number }): UploadSession {
  if (!input.name) throw new Error("File name is required");
  if (limits) validateAttachmentSize(input.size, limits.maxBytes, input.name);
  else validateOwnerAttachmentSize(input.size, input.name, ownerId);
  const mimeType = input.mimeType?.split(";")[0].trim().toLowerCase().replace(/[\r\n]/g, "").slice(0, 200) || "application/octet-stream";
  const upload: UploadSession = { id: randomUUID(), name: input.name.replace(/[\r\n]/g, "").slice(0, 255), mimeType, size: input.size, kind: isImageMime(mimeType) ? "image" : "file", offset: 0, complete: false, createdAt: Date.now() };
  const dir = directory(ownerId, upload.id);
  mkdirSync(dir, { recursive: true });
  closeSync(openSync(path.join(dir, "file"), "wx"));
  save(ownerId, upload);
  return upload;
}
export function getUpload(ownerId: string, id: string): UploadSession {
  try { return JSON.parse(readFileSync(path.join(directory(ownerId, id), "metadata.json"), "utf8")); }
  catch { throw new Error("Upload not found"); }
}
export function getCompletedUpload(ownerId: string, id: string): UploadedFile {
  const upload = getUpload(ownerId, id);
  if (!upload.complete || upload.offset !== upload.size) throw new Error("Upload is not complete");
  return { id: upload.id, name: upload.name, mimeType: upload.mimeType, size: upload.size, kind: upload.kind };
}
export async function appendUpload(ownerId: string, id: string, offset: number, body: ReadableStream<Uint8Array> | null) {
  const key = directory(ownerId, id);
  if (locks.has(key)) throw new Error("Upload is busy");
  locks.add(key);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let originalOffset: number | undefined;
  try {
    const upload = getUpload(ownerId, id);
    if (upload.complete || offset !== upload.offset || !Number.isSafeInteger(offset)) throw new Error("Upload offset mismatch");
    if (!body) throw new Error("Missing upload data");
    originalOffset = upload.offset;
    handle = await open(path.join(key, "file"), "r+");
    // Repair an interrupted write from a previous process before accepting a retry.
    await handle.truncate(upload.offset);
    let received = 0;
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > UPLOAD_CHUNK_BYTES || offset + received > upload.size) throw new Error("Upload chunk exceeds limit");
        let written = 0;
        while (written < value.byteLength) {
          const result = await handle.write(value, written, value.byteLength - written, offset + received - value.byteLength + written);
          written += result.bytesWritten;
        }
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    if (!received) throw new Error("Empty upload chunk");
    upload.offset += received;
    save(ownerId, upload);
    return upload;
  } catch (error) {
    if (handle && originalOffset !== undefined) await handle.truncate(originalOffset);
    throw error;
  } finally { await handle?.close(); locks.delete(key); }
}
export function completeUpload(ownerId: string, id: string): UploadedFile {
  const dir = directory(ownerId, id);
  if (locks.has(dir)) throw new Error("Upload is busy");
  const upload = getUpload(ownerId, id);
  if (upload.offset !== upload.size || statSync(path.join(dir, "file")).size !== upload.size) throw new Error("Upload is not complete");
  upload.complete = true;
  save(ownerId, upload);
  return getCompletedUpload(ownerId, id);
}
export async function deleteUpload(ownerId: string, id: string) {
  const dir = directory(ownerId, id);
  if (locks.has(dir)) throw new Error("Upload is busy");
  getUpload(ownerId, id);
  await rm(dir, { recursive: true });
}
export function materializeUploads(chatId: string, ids: string[], ownerId: string): StoredAttachment[] {
  if (!chatId || chatId.includes("..") || /[/\\]/.test(chatId)) throw new Error("Invalid chat id");
  if (ids.length > MAX_ATTACHMENTS || new Set(ids).size !== ids.length) throw new Error("Invalid upload count");
  const uploads = ids.map((id) => getCompletedUpload(ownerId, id));
  const dir = chatUploadDir(chatId, ownerId);
  mkdirSync(dir, { recursive: true });
  return uploads.map((upload) => {
    const storedName = `${upload.id}-${sanitizeFileName(upload.name)}`;
    const destination = path.join(dir, storedName);
    if (!existsSync(destination)) {
      const source = path.join(directory(ownerId, upload.id), "file");
      try { linkSync(source, destination); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        copyFileSync(source, destination);
      }
    }
    return { ...upload, storedName };
  });
}
export function uploadedFileResponse(ownerId: string, id: string, req?: Request) {
  const upload = getCompletedUpload(ownerId, id);
  return fileResponse(path.join(directory(ownerId, id), "file"), upload, req);
}

export function completedUploadPath(ownerId:string,id:string) { getCompletedUpload(ownerId,id); return path.join(directory(ownerId,id),"file"); }
