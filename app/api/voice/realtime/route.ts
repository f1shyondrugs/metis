import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getGlobalModelSettings } from "@/lib/db-store";
import { getProviderConnectionSecret } from "@/lib/provider-connections";
import { normalizeVoiceSettings } from "@/lib/shared-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const settings = getGlobalModelSettings(ownerId);
  const voice = normalizeVoiceSettings(settings.voiceInput);
  const body = await req.json().catch(() => null) as { modelId?: unknown; connectionId?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid realtime voice request." }, { status: 400 });
  }
  const connectionId = typeof body.connectionId === "string" ? body.connectionId : voice.connectionId;
  const credential = connectionId ? getProviderConnectionSecret(connectionId, ownerId) : null;
  if (connectionId && (!credential || !credential.enabled || credential.providerKey !== "openai")) {
    return Response.json({ error: "The selected OpenAI voice connection is unavailable." }, { status: 400 });
  }
  const apiKey = connectionId ? credential?.secret : process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return Response.json({ error: "No OpenAI voice API key is configured." }, { status: 400 });
  const model = typeof body.modelId === "string" && body.modelId.trim()
    ? body.modelId.trim()
    : voice.modelId;
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          type: "transcription",
          audio: { input: { transcription: { model }, turn_detection: null } },
        },
      }),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(20_000)]),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return Response.json({ error: payload?.error?.message || "Could not create realtime voice session." }, { status: response.status });
    if (typeof payload?.value !== "string" || !payload.value) {
      return Response.json({ error: "OpenAI returned no realtime client secret." }, { status: 502 });
    }
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not reach the realtime voice service." }, { status: 502 });
  }
}
