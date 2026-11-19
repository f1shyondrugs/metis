import { PUBLIC_BASE_PROOF_HEADER, signPublicBaseChallenge, validPublicBaseChallenge } from "@/lib/public-base-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const challenge = new URL(req.url).searchParams.get("challenge");
  const headers = new Headers({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
  if (!validPublicBaseChallenge(challenge)) return new Response(null, { status: 400, headers });
  headers.set(PUBLIC_BASE_PROOF_HEADER, signPublicBaseChallenge(challenge));
  return new Response(null, { status: 204, headers });
}
