import { randomUUID } from "node:crypto";
import { voiceDictionaryPrompt } from "@/lib/voice-dictionary";
import { completedUploadPath, getCompletedUpload } from "@/lib/file-upload-store";
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getChat, getGlobalModelSettings } from "@/lib/db-store";
import { featureFlags } from "@/lib/feature-flags";
import { findActiveConnection, getProviderConnectionSecret } from "@/lib/provider-connections";
import { fetchWithValidatedRedirects, privateUrlAllowlist } from "@/lib/url-security";
import {
  ALLOWED_AUDIO_MIME_TYPES,
  createVoiceJob,
  getVoiceJob,
  MAX_VOICE_BYTES,
  MAX_VOICE_DURATION_SECONDS,
  updateVoiceJob,
} from "@/lib/shared-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;
const execFile = promisify(execFileCallback);
const MAX_PROVIDER_AUDIO_BYTES = 25 * 1024 * 1024;

function transcriptionEndpoint(baseUrl?: string) {
  const base = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  return `${base}/audio/transcriptions`;
}

async function openAiTranscription(
  file: File,
  language?: string,
  ownerId?: string,
  modelId = "whisper-1",
  endpoint?: string,
  connectionId?: string,
  prompt?: string,
) {
  let connectionSecret: ReturnType<typeof getProviderConnectionSecret> | null = null;
  if (ownerId) {
    connectionSecret = connectionId
      ? getProviderConnectionSecret(connectionId, ownerId)
      : findActiveConnection(ownerId, "openai")
        ? getProviderConnectionSecret(findActiveConnection(ownerId, "openai")!.id, ownerId)
        : null;
  }
  const requestedEndpoint = endpoint?.trim() || undefined;
  const baseUrl = connectionSecret?.baseUrl || requestedEndpoint;
  // A request-controlled endpoint must never receive the process-wide OpenAI
  // key. Custom authenticated endpoints use their stored connection secret.
  const apiKey = connectionSecret?.secret || (!requestedEndpoint ? process.env.OPENAI_API_KEY?.trim() : undefined);
  if (!apiKey && !baseUrl) throw new Error("No transcription connection is configured.");
  const form = new FormData();
  form.append("file", file, file.name || `recording-${randomUUID()}.webm`);
  form.append("model", modelId.trim() || process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1");
  form.append("response_format", "json");
  if (prompt) form.append("prompt", prompt);
  if (language?.trim()) form.append("language", language.trim().slice(0, 20));
  const { response } = await fetchWithValidatedRedirects(transcriptionEndpoint(baseUrl), {
    method: "POST",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: form,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  }, {
    maxRedirects: 2,
    allowPrivateUrl: privateUrlAllowlist(),
  });
  const body = await response.json().catch(() => ({})) as { text?: unknown; error?: { message?: unknown } };
  if (!response.ok) throw new Error(typeof body.error?.message === "string" ? body.error.message : `Transcription failed (HTTP ${response.status}).`);
  if (typeof body.text !== "string") throw new Error("Transcription provider returned no text.");
  return body.text.trim();
}

async function transcribeWithProviderLimits(
  sourcePath: string,
  source: File,
  language: string | undefined,
  ownerId: string | undefined,
  modelId: string,
  endpoint?: string,
  connectionId?: string,
  prompt?: string,
) {
  if (source.size <= MAX_PROVIDER_AUDIO_BYTES) {
    return openAiTranscription(source, language, ownerId, modelId, endpoint, connectionId, prompt);
  }
  const segmentDir = await mkdtemp(path.join(process.env.TMPDIR || "/tmp", "metis-voice-segments-"));
  try {
    await execFile("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-f",
      "segment",
      "-segment_time",
      "600",
      "-reset_timestamps",
      "1",
      "-c:a",
      "libopus",
      path.join(segmentDir, "segment-%03d.webm"),
    ], { timeout: 10 * 60 * 1000, maxBuffer: 256 * 1024 });
    const segmentNames = (await readdir(segmentDir)).filter((name) => /^segment-\d+\.webm$/i.test(name)).sort();
    if (!segmentNames.length) throw new Error("Audio could not be segmented for transcription.");
    const parts: string[] = [];
    for (const name of segmentNames) {
      const segment = await readFile(path.join(segmentDir, name));
      const segmentFile = new File([segment], name, { type: "audio/webm" });
      parts.push(await openAiTranscription(segmentFile, language, ownerId, modelId, endpoint, connectionId, prompt));
    }
    return parts.filter(Boolean).join("\n\n").trim();
  } catch (error) {
    if (error instanceof Error && /ENOENT|not found/i.test(error.message)) {
      throw new Error("This recording exceeds the provider file limit and ffmpeg is not available for segmentation.");
    }
    throw error;
  } finally {
    await rm(segmentDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const jobId = new URL(req.url).searchParams.get("jobId")?.trim() || "";
  if (!jobId) return Response.json({ error: "jobId is required" }, { status: 400 });
  const job = getVoiceJob(jobId, ownerId);
  if (!job) return Response.json({ error: "Voice job not found" }, { status: 404 });
  return Response.json({ job });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const settings = getGlobalModelSettings(ownerId);
  if (!featureFlags(settings).voiceInput || settings.voiceInput?.enabled === false) {
    return Response.json({ error: "Voice input is disabled" }, { status: 404 });
  }
  const maxDuration = Math.min(MAX_VOICE_DURATION_SECONDS, settings.voiceInput?.maxDurationSeconds || 300);
  const form = await req.formData().catch(() => null);
  let file = form?.get("file");
  const uploadId = form?.get("uploadId");
  if (!(file instanceof File) && typeof uploadId === "string" && ownerId) {
    try {
      const upload = getCompletedUpload(ownerId, uploadId);
      if (upload.size > MAX_VOICE_BYTES) return Response.json({ error: "Audio file is too large" }, { status: 413 });
      if (!ALLOWED_AUDIO_MIME_TYPES.has(upload.mimeType)) return Response.json({ error: "Unsupported audio MIME type" }, { status: 415 });
      file = new File([await readFile(completedUploadPath(ownerId, uploadId))], upload.name, { type: upload.mimeType });
    } catch {
      return Response.json({ error: "Recording upload not found or incomplete" }, { status: 400 });
    }
  }
  if (!(file instanceof File)) return Response.json({ error: "Audio file is required" }, { status: 400 });
  const chatId = typeof form?.get("chatId") === "string" ? String(form?.get("chatId")).trim() : "";
  if (chatId && !getChat(chatId, ownerId)) return Response.json({ error: "Chat not found" }, { status: 404 });
  const mimeType = file.type.toLowerCase().split(";")[0].trim();
  if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) return Response.json({ error: "Unsupported audio MIME type" }, { status: 415 });
  if (file.size > MAX_VOICE_BYTES) return Response.json({ error: "Audio file is too large" }, { status: 413 });
  const durationRaw = form?.get("durationSeconds");
  const durationSeconds = typeof durationRaw === "string" ? Number(durationRaw) : Number.NaN;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > maxDuration) {
    return Response.json({ error: `Audio duration must be between 1 and ${maxDuration} seconds.` }, { status: 400 });
  }
  const language = typeof form?.get("language") === "string" ? String(form?.get("language")) : undefined;
  const provider = typeof form?.get("provider") === "string" ? String(form?.get("provider")) : "openai";
  const modelId = typeof form?.get("modelId") === "string" ? String(form?.get("modelId")) : "whisper-1";
  const endpoint = typeof form?.get("endpoint") === "string" ? String(form?.get("endpoint")) : undefined;
  const connectionId = typeof form?.get("connectionId") === "string" ? String(form?.get("connectionId")) : undefined;
  if (provider === "browser") return Response.json({ error: "Browser transcription runs in the browser." }, { status: 400 });
  const idempotencyKey = req.headers.get("idempotency-key") || undefined;
  let job;
  try {
    job = createVoiceJob({
      ownerId,
      chatId: chatId || undefined,
      mimeType,
      durationSeconds,
      sizeBytes: file.size,
      idempotencyKey,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid audio" }, { status: 400 });
  }
  if (job.status === "completed" && job.transcript) return Response.json({ job, transcript: job.transcript });
  const tempPath = path.join(process.env.TMPDIR || "/tmp", `metis-voice-${job.id}-${randomUUID()}.${mimeType.split("/")[1] || "audio"}`);
  try {
    updateVoiceJob(job.id, { status: "transcribing" }, ownerId);
    await writeFile(tempPath, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
    const transcript = await transcribeWithProviderLimits(tempPath, file, language, ownerId, modelId, endpoint, connectionId, voiceDictionaryPrompt(settings.voiceInput?.dictionary));
    const completed = updateVoiceJob(job.id, { status: "completed", transcript }, ownerId);
    return Response.json({ job: completed, transcript });
  } catch (error) {
    const failed = updateVoiceJob(job.id, { status: "failed", error: error instanceof Error ? error.message : "Transcription failed." }, ownerId);
    return Response.json({ error: failed?.error || "Transcription failed.", job: failed }, { status: 502 });
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

export async function DELETE(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const jobId = new URL(req.url).searchParams.get("jobId")?.trim() || "";
  const job = getVoiceJob(jobId, ownerId);
  if (!job) return Response.json({ error: "Voice job not found" }, { status: 404 });
  const updated = updateVoiceJob(job.id, { status: "cancelled" }, ownerId);
  return Response.json({ job: updated });
}
