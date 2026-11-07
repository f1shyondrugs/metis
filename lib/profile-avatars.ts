import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { config } from "@/lib/config";
import { getDatabase } from "@/lib/sqlite";
import { canViewProjectMemberProfile } from "@/lib/project-access";
import { MAX_PROFILE_GIF_BYTES } from "@/lib/profile-avatar-limits";
import { parseImageFraming } from "@/lib/image-framing";

const root = path.join(config.dataDir, "profile-avatars");
const prefix = "/api/profile/avatar/";
const idPattern = /^[a-f0-9]{48}$/;
export class AvatarUploadError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export function avatarId(url: string): string | null {
  const parsed = parseImageFraming(url);
  const id = parsed.valid && parsed.source.startsWith(prefix) ? parsed.source.slice(prefix.length) : "";
  return idPattern.test(id) ? id : null;
}
export function ownsAvatar(ownerId: string, url: string): boolean {
  const id = avatarId(url);
  return Boolean(id && getDatabase().prepare("SELECT id FROM profile_avatars WHERE id=? AND owner_id=?").get(id, ownerId) && existsSync(path.join(root, id + ".gif")));
}
export function cleanProfileAvatars(ownerId: string, keep: string | null, saved: string | null = null) {
  const keepIds = [keep, saved].map(url => url ? avatarId(url) : null);
  const rows = getDatabase().prepare("SELECT id FROM profile_avatars WHERE owner_id=?").all(ownerId) as {id:string}[];
  for (const row of rows) {
    if (keepIds.includes(row.id)) continue;
    try { unlinkSync(path.join(root, row.id + ".gif")); } catch { /* Already removed. */ }
    getDatabase().prepare("DELETE FROM profile_avatars WHERE id=? AND owner_id=?").run(row.id, ownerId);
  }
}
export async function uploadProfileGif(ownerId: string, req: Request): Promise<string> {
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "image/gif")
    throw new AvatarUploadError("Choose a GIF image.", 415);
  if (Number(req.headers.get("content-length")) > MAX_PROFILE_GIF_BYTES)
    throw new AvatarUploadError("GIF profile pictures can be up to 50 MB.", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new AvatarUploadError("Choose a GIF image.", 400);
  mkdirSync(root, {recursive:true, mode:0o700});
  const id = randomBytes(24).toString("hex"), file = path.join(root, id + ".gif");
  const handle = await open(file, "wx", 0o600);
  let size = 0;
  try {
    try {
      while (true) {
        const {value,done} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_PROFILE_GIF_BYTES) {
          await reader.cancel();
          throw new AvatarUploadError("GIF profile pictures can be up to 50 MB.", 413);
        }
        await handle.writeFile(value);
      }
    } finally { reader.releaseLock(); await handle.close(); }
    if (!size) throw new AvatarUploadError("The GIF is empty.", 400);
    // The maintained GIF decoder reads metadata without decoding every animation frame.
    const bytes = await readFile(file);
    if (!["GIF87a","GIF89a"].includes(bytes.toString("ascii",0,6)))
      throw new AvatarUploadError("This file is not a GIF image.", 400);
    const metadata = await sharp(bytes).metadata();
    if (metadata.format !== "gif" || !metadata.width || !metadata.height)
      throw new AvatarUploadError("This GIF could not be read.", 400);
    getDatabase().prepare("INSERT INTO profile_avatars(id,owner_id,size,created_at) VALUES(?,?,?,?)").run(id, ownerId, size, new Date().toISOString());
    const current = getDatabase().prepare("SELECT data FROM account_profiles WHERE owner_id=?").get(ownerId) as {data:string}|undefined;
    // Retain the saved image and one draft, so cancelled/repeated selections do not accumulate.
    cleanProfileAvatars(ownerId, prefix + id, current ? JSON.parse(current.data).avatar : null);
    return prefix + id;
  } catch (error) {
    try { unlinkSync(file); } catch { /* Partial upload may already be gone. */ }
    if (error instanceof AvatarUploadError) throw error;
    throw new AvatarUploadError("This GIF could not be read. Choose another image.", 400);
  }
}
export function profileAvatarResponse(id: string, viewerId?: string, ifNoneMatch?: string | null): Response {
  const headers = {"Cache-Control":"private, no-store", "Vary":"Cookie", "X-Content-Type-Options":"nosniff"};
  if (!idPattern.test(id)) return new Response(null,{status:404,headers});
  const row = getDatabase().prepare("SELECT a.owner_id,a.size,p.share_id,p.data FROM profile_avatars a LEFT JOIN account_profiles p ON p.owner_id=a.owner_id WHERE a.id=?").get(id) as {owner_id:string;size:number;share_id:string|null;data:string|null}|undefined;
  const savedAvatar = !!row?.data && avatarId(JSON.parse(row.data).avatar || "") === id;
  const publicAvatar = savedAvatar && !!row?.share_id;
  const projectAvatar = savedAvatar && !!row && viewerId !== row.owner_id && canViewProjectMemberProfile(row.owner_id, viewerId);
  if (!row || (viewerId !== row.owner_id && !publicAvatar && !projectAvatar)) return new Response(null,{status:404,headers});
  const file = path.join(root,id+".gif");
  if (!existsSync(file)) return new Response(null,{status:404,headers});
  // Upload IDs are immutable: a replacement always has a new URL. Keep owner
  // images in the browser cache. Other viewers revalidate access before a 304,
  // so revoking sharing still takes effect. Cookie variants separate sessions.
  const cacheHeaders={...headers,"Cache-Control":viewerId===row.owner_id ? "private, max-age=31536000, immutable" : "private, no-cache",ETag:'"'+id+'"'};
  if(ifNoneMatch?.split(",").some(tag=>tag.trim()==="*" || tag.trim().replace(/^W\//,"")===cacheHeaders.ETag))
    return new Response(null,{status:304,headers:cacheHeaders});
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {headers:{
    ...cacheHeaders,"Content-Type":"image/gif","Content-Length":String(row.size),"Content-Disposition":'inline; filename="profile.gif"',
  }});
}
