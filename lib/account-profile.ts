import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "@/lib/sqlite";
import type { AccountProfile } from "@/lib/account-types";
import { ownsAvatar, cleanProfileAvatars } from "@/lib/profile-avatars";
import { parseImageFraming } from "@/lib/image-framing";
import { bannerId, ownsBanner, cleanProfileBanners } from "@/lib/profile-banners";

const avatarSchema = z.string().max(350_000).refine((value) => {
  const framed = parseImageFraming(value);
  if (!framed.valid || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(framed.source)) return false;
  const bytes = Buffer.from(framed.source.split(",")[1], "base64");
  return bytes.length > 32 && bytes.length <= 256_000 &&
    bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 512 &&
    bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 512;
}, "Choose a PNG profile image up to 512 × 512 pixels.");
export const profileInput = z.object({
  displayName: z.string().trim().min(1).max(80),
  handle: z.string().trim().toLowerCase().refine(value => value === "" || /^[a-z0-9][a-z0-9_-]{2,31}$/.test(value),
    "Use 3–32 letters, numbers, underscores or hyphens, starting with a letter or number.").transform(value => value || null).nullable().optional(),
  bio: z.string().max(500),
  avatar: z.union([avatarSchema, z.string().max(300).refine(value => {
    const parsed = parseImageFraming(value);
    return parsed.valid && /^\/api\/profile\/avatar\/[a-f0-9]{48}$/.test(parsed.source);
  })]).nullable(),
  banner: z.string().max(300).refine(value => bannerId(value) !== null, "Upload your own profile banner.").nullable().optional(),
  links: z.array(z.object({
    label: z.string().trim().min(1).max(40),
    url: z.string().trim().max(2048).url().refine(value => {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
    }, "Use an http or https link without credentials."),
  }).strict()).max(5),
  sharing: z.boolean(),
  shareActivity: z.boolean(),
}).strict();

export class ProfileHandleConflict extends Error {
  constructor() { super("This handle is already taken. Choose another one."); }
}
type ProfileRow = { owner_id: string; data: string; share_id: string | null; handle: string | null };
const profileSelect = "SELECT p.owner_id, p.data, p.share_id, h.handle FROM account_profiles p LEFT JOIN account_profile_handles h ON h.owner_id = p.owner_id";
function profileFromRow(row: ProfileRow): AccountProfile {
  return { banner: null, ...JSON.parse(row.data), shareId: row.share_id, handle: row.handle };
}
export function getAccountProfile(ownerId: string, username: string): AccountProfile {
  const row = getDatabase().prepare(profileSelect + " WHERE p.owner_id = ?").get(ownerId) as ProfileRow | undefined;
  if (!row) return { displayName: username, bio: "", avatar: null, banner: null, links: [], shareId: null, shareActivity: false, handle: null };
  return profileFromRow(row);
}
export function saveAccountProfile(ownerId: string, input: unknown): AccountProfile {
  const parsed = profileInput.parse(input);
  if (parsed.avatar?.startsWith("/api/") && !ownsAvatar(ownerId, parsed.avatar)) throw new Error("Upload your own profile picture first.");
  if (parsed.banner && !ownsBanner(ownerId, parsed.banner)) throw new Error("Upload your own profile banner first.");
  const db = getDatabase();
  let result: AccountProfile;
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(profileSelect + " WHERE p.owner_id = ?").get(ownerId) as ProfileRow | undefined;
    // Older clients may omit handle. Only an explicit empty value removes it.
    const handle = parsed.handle === undefined ? row?.handle ?? null : parsed.handle;
    if (handle) {
      const claimed = db.prepare("SELECT owner_id FROM account_profile_handles WHERE handle = ?").get(handle) as { owner_id: string } | undefined;
      if (claimed && claimed.owner_id !== ownerId) throw new ProfileHandleConflict();
    }
    const shareId = parsed.sharing ? row?.share_id || randomBytes(24).toString("hex") : null;
    const { sharing: _sharing, handle: _handle, ...fields } = parsed;
    // Preserve banners when older clients save other profile fields.
    const banner = parsed.banner === undefined ? (row ? JSON.parse(row.data).banner ?? null : null) : parsed.banner;
    const data = { ...fields, banner };
    db.prepare("INSERT INTO account_profiles (owner_id, data, share_id) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data, share_id=excluded.share_id").run(ownerId, JSON.stringify(data), shareId);
    if (handle) {
      db.prepare("INSERT INTO account_profile_handles (handle, owner_id) VALUES (?, ?) ON CONFLICT(owner_id) DO UPDATE SET handle=excluded.handle").run(handle, ownerId);
    } else {
      db.prepare("DELETE FROM account_profile_handles WHERE owner_id = ?").run(ownerId);
    }
    result = { ...data, shareId, handle };
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  cleanProfileAvatars(ownerId, result.avatar);
  cleanProfileBanners(ownerId, result.banner ?? null);
  return result;
}
export function getSharedProfile(identifier: string): { ownerId: string; profile: AccountProfile } | null {
  const isToken = /^[a-f0-9]{48}$/.test(identifier);
  const handle = identifier.toLowerCase();
  if (!isToken && !/^[a-z0-9][a-z0-9_-]{2,31}$/.test(handle)) return null;
  const row = getDatabase().prepare(profileSelect + (isToken ? " WHERE p.share_id = ?" : " WHERE h.handle = ? AND p.share_id IS NOT NULL")).get(isToken ? identifier : handle) as ProfileRow | undefined;
  return row ? { ownerId: row.owner_id, profile: profileFromRow(row) } : null;
}
