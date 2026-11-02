/** Shared transport limits; files are transferred in bounded chunks. */
export const MAX_ATTACHMENTS = 10;
/** Default for accounts without a saved preference; 0 means Unlimited. */
export const DEFAULT_ATTACHMENT_MAX_BYTES = 1024 * 1024 * 1024;
export function isAttachmentMaxBytes(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function normalizeAttachmentMaxBytes(value: unknown): number {
  return isAttachmentMaxBytes(value) ? value : DEFAULT_ATTACHMENT_MAX_BYTES;
}
export function validateAttachmentSize(size: number, maxBytes: number, name: string) {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`File must contain at least 1 byte: ${name}`);
  if (maxBytes !== 0 && size > maxBytes) {
    throw new Error(`File exceeds your ${formatFileBytes(maxBytes)} attachment limit: ${name}. Change it in Settings → General → Attachments.`);
  }
}
/** Server acceptance limit; keep existing clients compatible. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
/** Client request size stays below common 1 MiB reverse-proxy limits. */
export const UPLOAD_REQUEST_BYTES = 512 * 1024;
export const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
export type UploadedFile = {
  id: string; name: string; mimeType: string; size: number; kind: "image" | "file";
};
export function formatFileBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}
