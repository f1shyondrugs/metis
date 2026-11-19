import { getAuthenticatedUserId } from "@/lib/auth";
import { getPublicBaseUrl } from "@/lib/public-base-settings";
import { publicShareUrl } from "@/lib/public-base-url";
import { canShareSkill, createSkillShare, revokeSkillShare, skillShareLink } from "@/lib/skill-sharing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
async function account(req: Request, context: Context) {
  const ownerId = await getAuthenticatedUserId(req);
  const { id } = await context.params;
  if (!ownerId) return null;
  return { ownerId, id };
}
function result(token: string | null) {
  return Response.json({ token, url: token ? publicShareUrl(getPublicBaseUrl(), "/skills/share/" + token) : null }, { headers: { "Cache-Control": "no-store" } });
}
export async function GET(req: Request, context: Context) {
  const a = await account(req, context);
  if (!a) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!canShareSkill(a.ownerId, a.id)) return Response.json({ error: "Skill not found or not shareable." }, { status: 404 });
  return result(skillShareLink(a.ownerId, a.id));
}
export async function POST(req: Request, context: Context) {
  const a = await account(req, context);
  if (!a) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return result(createSkillShare(a.ownerId, a.id)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not share skill." }, { status: 400 }); }
}
export async function DELETE(req: Request, context: Context) {
  const a = await account(req, context);
  if (!a) return Response.json({ error: "Unauthorized" }, { status: 401 });
  revokeSkillShare(a.ownerId, a.id);
  return result(null);
}
