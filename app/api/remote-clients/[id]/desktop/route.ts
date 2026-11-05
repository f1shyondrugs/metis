import { getAuthenticatedUserId } from "@/lib/auth";
import { captureRemoteDesktop, listRemoteDesktopMonitors, validDesktopMonitorId, DesktopPreviewError } from "@/lib/remote-desktop-capture";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };
const noStore = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "Desktop preview failed" },
    { status: error instanceof DesktopPreviewError ? error.status : 502, headers: noStore });
}

/** Passive inventory only; no arbitrary operation or input reaches the device. */
export async function GET(req: Request, { params }: Params) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const { id } = await params;
  if (req.signal.aborted) return new Response(null, { status: 499 });
  try { return Response.json(await listRemoteDesktopMonitors(id, ownerId), { headers: noStore }); }
  catch (error) { return failure(error); }
}

async function readPreviewBody(req: Request) {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        throw new DesktopPreviewError("Invalid desktop preview request", 400);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

// Only a passive frame. Monitor IDs are data, never commands or input actions.
export async function POST(req: Request, { params }: Params) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const { id } = await params;
  if (req.signal.aborted) return new Response(null, { status: 499 });
  let monitorId: string | undefined;
  try {
    const text = await readPreviewBody(req);
    if (text.trim()) {
      let body: unknown;
      try { body = JSON.parse(text); }
      catch { throw new DesktopPreviewError("Invalid JSON body", 400); }
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).some(key => key !== "monitorId")) throw new DesktopPreviewError("Invalid desktop preview request", 400);
      if (Object.hasOwn(body, "monitorId")) {
        const value = (body as { monitorId?: unknown }).monitorId;
        if (!validDesktopMonitorId(value)) throw new DesktopPreviewError("Invalid monitor ID", 400);
        monitorId = value;
      }
    }
    const frame = await captureRemoteDesktop(id, ownerId, monitorId);
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return new Response(frame.data as Uint8Array<ArrayBuffer>, { headers: {
      ...noStore, "Content-Type": "image/jpeg",
      "X-Desktop-Captured-At": String(frame.capturedAt),
      "X-Desktop-Width": String(frame.width), "X-Desktop-Height": String(frame.height),
      ...(frame.monitorId ? { "X-Desktop-Monitor-Id": encodeURIComponent(frame.monitorId) } : {}),
    } });
  } catch (error) { return failure(error); }
}
