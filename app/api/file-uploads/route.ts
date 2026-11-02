import { getAuthenticatedUserId } from "@/lib/auth";
import { createUpload } from "@/lib/file-upload-store";
import { ALLOWED_AUDIO_MIME_TYPES, MAX_VOICE_BYTES } from "@/lib/shared-context";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const owner = await getAuthenticatedUserId(req);
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const mimeType = typeof body.mimeType === "string" ? body.mimeType.split(";")[0].trim().toLowerCase() : "";
    const voice = body.purpose === "voice";
    if (voice && !ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) {
      return Response.json({ error: "Unsupported audio MIME type" }, { status: 415 });
    }
    return Response.json(createUpload(owner, {
      name: typeof body.name === "string" ? body.name : "", mimeType, size: body.size,
    }, voice ? { maxBytes: MAX_VOICE_BYTES } : undefined), { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 400 }); }
}
