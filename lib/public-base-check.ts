import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PublicBaseCheck, PublicBaseUrl } from "@/lib/public-base-url";
import { getDatabase } from "@/lib/sqlite";

const PROOF_KEY = "public_base_url_proof_key_v1";
export const PUBLIC_BASE_PROOF_HEADER = "X-Metis-Instance-Proof";
export const PUBLIC_BASE_PROOF_PATH = "/api/instance-proof";
const HEX = /^[a-f0-9]{64}$/;

export function validPublicBaseChallenge(value: string | null): value is string {
  return value !== null && HEX.test(value);
}

function installationKey() {
  const db = getDatabase();
  const select = db.prepare("SELECT value FROM meta WHERE key = ?");
  let row = select.get(PROOF_KEY) as { value: string } | undefined;
  if (!row) {
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").run(PROOF_KEY, randomBytes(32).toString("hex"));
    row = select.get(PROOF_KEY) as { value: string } | undefined;
  }
  if (!row || !HEX.test(row.value)) throw new Error("Metis instance proof key is unavailable.");
  return Buffer.from(row.value, "hex");
}

export function signPublicBaseChallenge(challenge: string) {
  // Dedicated key and domain; never reuse the operator token or session credentials.
  return createHmac("sha256", installationKey()).update("metis:public-base:v1:" + challenge).digest("hex");
}

/** The destination is supplied only by the server's operator configuration. */
export async function checkPublicBaseUrl(base: PublicBaseUrl): Promise<PublicBaseCheck> {
  if (!("url" in base)) return base;
  const challenge = randomBytes(32).toString("hex");
  const expected = signPublicBaseChallenge(challenge);
  const target = base.url + PUBLIC_BASE_PROOF_PATH + "?challenge=" + challenge;
  let result: Response;
  try {
    result = await fetch(target, {
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { state: "unreachable" };
  }
  // Do not read or relay arbitrary content, redirect locations or response headers.
  if (result.body) void result.body.cancel().catch(() => {});
  const { status } = result;
  if (status >= 300 && status < 400) return { state: "redirect", status };
  if (status === 404) return { state: "not_metis" };
  if (!result.ok) return { state: "http_error", status };
  const proof = result.headers.get(PUBLIC_BASE_PROOF_HEADER);
  if (status !== 204 || !validPublicBaseChallenge(proof)) return { state: "not_metis" };
  return timingSafeEqual(Buffer.from(proof, "hex"), Buffer.from(expected, "hex"))
    ? { state: "verified" }
    : { state: "other_instance" };
}
