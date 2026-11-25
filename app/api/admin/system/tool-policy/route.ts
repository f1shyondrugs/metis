import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { isHostAdmin } from "@/lib/user-access";
import { requestOriginAllowed } from "@/lib/request-network";
import { isHostToolPolicy } from "@/lib/mcp-core/host-tool-policy.mjs";
import { getHostToolPolicy, saveHostToolPolicy } from "@/lib/host-tool-policy-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, {status, headers: {"Cache-Control":"private, no-store"}});
}
async function authorize(req: Request) {
  if (!(await isAuthenticated(req))) return json({error:"Unauthorized"},401);
  if (!isHostAdmin(await getAuthenticatedUserId(req))) return json({error:"Only host administrators can manage tool rules."},403);
  return null;
}

export async function GET(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;
  return json(getHostToolPolicy());
}

export async function PUT(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;
  if (!requestOriginAllowed(req)) return json({error:"Invalid origin."},403);
  const body: unknown = await req.json().catch(() => null);
  if (!isHostToolPolicy(body)) return json({error:"Invalid tool policy."},400);
  const saved = saveHostToolPolicy(body.revision, body.rules);
  if (!saved) return json({error:"The policy changed in another session. Reload it before saving."},409);
  return json(saved);
}
