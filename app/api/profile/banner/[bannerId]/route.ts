import { getAuthenticatedUser } from "@/lib/auth";
import { profileBannerResponse } from "@/lib/profile-banners";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request, {params}: {params:Promise<{bannerId:string}>}) {
  const [{bannerId}, user] = await Promise.all([params, getAuthenticatedUser(req)]);
  return profileBannerResponse(bannerId, user?.id, req.headers.get("if-none-match"));
}
