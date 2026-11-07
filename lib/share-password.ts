import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

/** Shared chat/note link password format; preserve existing persisted hashes. */
export function hashSharePassword(password: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex")}`;
}
export function verifySharePassword(password: string, encoded: string) {
  const [salt, digest] = encoded.split(":");
  if (!salt || !digest || !/^[0-9a-f]{64}$/i.test(digest)) return false;
  const actual = pbkdf2Sync(password, salt, 120_000, 32, "sha256");
  const expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
