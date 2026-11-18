import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import { assertPublicHttpUrl } from "@/lib/url-security";
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

type ProbeResult = { status: number; proof: string | null };

function classify({ status, proof }: ProbeResult, expected: string): PublicBaseCheck {
  if (status >= 300 && status < 400) return { state: "redirect", status };
  if (status === 404) return { state: "not_metis" };
  if (status < 200 || status >= 300) return { state: "http_error", status };
  if (status !== 204 || !validPublicBaseChallenge(proof)) return { state: "not_metis" };
  return timingSafeEqual(Buffer.from(proof, "hex"), Buffer.from(expected, "hex"))
    ? { state: "verified" }
    : { state: "other_instance" };
}

/** For file/environment defaults that may intentionally be local. */
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
  return classify({ status: result.status, proof: result.headers.get(PUBLIC_BASE_PROOF_HEADER) }, expected);
}

/** An editable URL is an untrusted outbound destination. Resolve it once and
 * pin the authorized IP to the TLS connection; never follow redirects. */
export async function checkEditedPublicBaseUrl(base: Extract<PublicBaseUrl, { url: string }>): Promise<PublicBaseCheck> {
  const url = new URL(base.url);
  if (base.state !== "configured") return { state: "unsafe_url" };
  if (url.protocol !== "https:") return { state: "https_required" };
  const signal = AbortSignal.timeout(5000);
  const timedOut = new Promise<PublicBaseCheck>(resolve =>
    signal.addEventListener("abort", () => resolve({ state: "unreachable" }), { once: true }),
  );
  return Promise.race([timedOut, (async (): Promise<PublicBaseCheck> => {
    const challenge = randomBytes(32).toString("hex");
    const target = base.url + PUBLIC_BASE_PROOF_PATH + "?challenge=" + challenge;
    let addresses: Array<{ address: string; family: number }> = [];
    try {
      const validated = await assertPublicHttpUrl(target, {
        requireHttps: true,
        lookup: async hostname => {
          const resolved = await dns.lookup(hostname, { all: true });
          if (resolved.some(({ address, family }) => family === 6 && !/^[23]/i.test(address))) throw new Error("Private URL");
          addresses = resolved;
          return resolved;
        },
      });
      signal.throwIfAborted();
      const expected = signPublicBaseChallenge(challenge);
      // Prefer IPv4 on dual-stack hosts; try the remaining pinned answers
      // only on connection failure, within the same overall deadline.
      for (const { address, family } of addresses.sort((a,b) => a.family - b.family)) {
        try {
          const result = await new Promise<ProbeResult>((resolve, reject) => {
            const outbound = https.request(validated, {
              method: "GET", agent: false, family, signal,
              lookup: (_host, _opts, callback) => callback(null, address, family),
              headers: { "Cache-Control": "no-store" },
            }, response => {
              const proof = response.headers[PUBLIC_BASE_PROOF_HEADER.toLowerCase()];
              resolve({ status: response.statusCode ?? 0, proof: typeof proof === "string" ? proof : null });
              response.destroy();
            });
            outbound.once("error", reject);
            outbound.end();
          });
          return classify(result, expected);
        } catch {
          if (signal.aborted) break;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Private URL") return { state: "unsafe_url" };
    }
    return { state: "unreachable" };
  })()]);
}
