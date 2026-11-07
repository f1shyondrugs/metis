import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { config } from "@/lib/config";
import { getDatabase } from "@/lib/sqlite";
import { parseImageFraming } from "@/lib/image-framing";
import { MAX_INLINE_IMAGE_BYTES } from "@/lib/upload-limits";

const root = path.join(config.dataDir, "profile-banners");
const prefix = "/api/profile/banner/";
const formats: Record<string, string> = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp", "image/gif": "gif" };
export class BannerUploadError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export function bannerId(url: string): string | null {
  const parsed = parseImageFraming(url);
  const id = parsed.valid && parsed.source.startsWith(prefix) ? parsed.source.slice(prefix.length) : "";
  return /^[a-f0-9]{48}$/.test(id) ? id : null;
}
export function ownsBanner(ownerId: string, url: string): boolean {
  const id = bannerId(url);
  return Boolean(id && getDatabase().prepare("SELECT id FROM profile_banners WHERE id=? AND owner_id=?").get(id, ownerId) && existsSync(path.join(root, id)));
}
export function cleanProfileBanners(ownerId: string, keep: string | null, saved: string | null = null) {
  const keepIds = [keep, saved].map(url => url ? bannerId(url) : null);
  const db = getDatabase();
  const rows = db.prepare("SELECT id FROM profile_banners WHERE owner_id=?").all(ownerId) as {id:string}[];
  for (const row of rows) {
    if (keepIds.includes(row.id)) continue;
    try { unlinkSync(path.join(root, row.id)); } catch { /* Already removed. */ }
    db.prepare("DELETE FROM profile_banners WHERE id=? AND owner_id=?").run(row.id, ownerId);
  }
}
export async function uploadProfileBanner(ownerId: string, req: Request): Promise<string> {
  const mime = req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
  if (!formats[mime]) throw new BannerUploadError("Choose a PNG, JPG, WebP or GIF image.", 415);
  if (Number(req.headers.get("content-length")) > MAX_INLINE_IMAGE_BYTES)
    throw new BannerUploadError("Choose an image smaller than 20 MB.", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new BannerUploadError("Choose a non-empty image.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_INLINE_IMAGE_BYTES) {
        await reader.cancel();
        throw new BannerUploadError("Choose an image smaller than 20 MB.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new BannerUploadError("Choose a non-empty image.", 400);
  const bytes = Buffer.concat(chunks);
  try {
    const metadata = await sharp(bytes).metadata();
    if (metadata.format !== formats[mime] || !metadata.width || !metadata.height)
      throw new Error("Invalid image");
  } catch {
    throw new BannerUploadError("This image could not be read. Choose another image.", 400);
  }
  mkdirSync(root, {recursive:true, mode:0o700});
  const id = randomBytes(24).toString("hex"), file = path.join(root, id);
  try {
    await writeFile(file, bytes, {flag:"wx", mode:0o600});
    const db = getDatabase();
    db.prepare("INSERT INTO profile_banners(id,owner_id,mime_type,size,created_at) VALUES(?,?,?,?,?)").run(id, ownerId, mime, size, new Date().toISOString());
    const current = db.prepare("SELECT data FROM account_profiles WHERE owner_id=?").get(ownerId) as {data:string}|undefined;
    cleanProfileBanners(ownerId, prefix + id, current ? JSON.parse(current.data).banner ?? null : null);
    return prefix + id;
  } catch (error) {
    try { unlinkSync(file); } catch { /* Partial upload may already be gone. */ }
    throw error;
  }
}
export function profileBannerResponse(id: string, viewerId?: string, ifNoneMatch?: string | null): Response {
  const headers = {"Cache-Control":"private, no-store", Vary:"Cookie", "X-Content-Type-Options":"nosniff"};
  if (!/^[a-f0-9]{48}$/.test(id)) return new Response(null, {status:404, headers});
  const row = getDatabase().prepare("SELECT b.owner_id,b.mime_type,b.size,p.share_id,p.data FROM profile_banners b LEFT JOIN account_profiles p ON p.owner_id=b.owner_id WHERE b.id=?").get(id) as {owner_id:string;mime_type:string;size:number;share_id:string|null;data:string|null}|undefined;
  const publicBanner = !!row?.share_id && !!row.data && bannerId(JSON.parse(row.data).banner || "") === id;
  const file = path.join(root, id);
  if (!row || (viewerId !== row.owner_id && !publicBanner) || !existsSync(file))
    return new Response(null, {status:404, headers});
  const cacheHeaders = {...headers, "Cache-Control":viewerId === row.owner_id ? "private, max-age=31536000, immutable" : "private, no-cache", ETag:'"' + id + '"'};
  if (ifNoneMatch?.split(",").some(tag => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === cacheHeaders.ETag))
    return new Response(null, {status:304, headers:cacheHeaders});
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {headers:{
    ...cacheHeaders, "Content-Type":row.mime_type, "Content-Length":String(row.size),
  }});
}
