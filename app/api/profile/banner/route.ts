import { getAuthenticatedUser } from "@/lib/auth";
import { BannerUploadError, uploadProfileBanner } from "@/lib/profile-banners";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {"Cache-Control":"private, no-store"};
export async function PUT(req: Request) {
  const user = await getAuthenticatedUser(req);
  if (!user) return Response.json({error:"Unauthorized"}, {status:401, headers});
  try {
    return Response.json({banner:await uploadProfileBanner(user.id, req)}, {headers});
  } catch (error) {
    return Response.json({error:error instanceof BannerUploadError ? error.message : "Could not upload banner."},
      {status:error instanceof BannerUploadError ? error.status : 500, headers});
  }
}
