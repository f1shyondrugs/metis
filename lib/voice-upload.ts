/** Keep voice requests below common proxy body limits, including multipart overhead. */
export const VOICE_UPLOAD_CHUNK_BYTES = 512 * 1024;

async function request(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || (response.status === 413
      ? "The server rejected the recording upload as too large."
      : "Transcription failed."));
  }
  return body;
}

export async function transcribeRecording(blob: Blob, form: FormData, onTranscribing?: () => void): Promise<string> {
  let uploadId: string | undefined;
  try {
    if (blob.size > VOICE_UPLOAD_CHUNK_BYTES) {
      const upload = await request("/api/file-uploads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "recording.webm", mimeType: blob.type, size: blob.size, purpose: "voice" }),
      });
      uploadId = upload.id;
      if (typeof uploadId !== "string" || !/^[a-f0-9-]{36}$/.test(uploadId)) {
        uploadId = undefined;
        throw new Error("Invalid recording upload.");
      }
      const url = `/api/file-uploads/${uploadId}`;
      for (let offset = 0; offset < blob.size; offset += VOICE_UPLOAD_CHUNK_BYTES) {
        await request(url, {
          method: "PUT", headers: { "Upload-Offset": String(offset) },
          body: blob.slice(offset, offset + VOICE_UPLOAD_CHUNK_BYTES),
        });
      }
      await request(url, { method: "POST" });
      form.delete("file");
      form.set("uploadId", uploadId);
    } else {
      form.set("file", blob, "recording.webm");
    }
    onTranscribing?.();
    const body = await request("/api/voice/transcribe", {
      method: "POST", headers: { "Idempotency-Key": `${Date.now()}-${Math.random()}` }, body: form,
    });
    if (typeof body.transcript !== "string") throw new Error("Transcription failed.");
    return body.transcript;
  } finally {
    if (uploadId) await fetch(`/api/file-uploads/${uploadId}`, { method: "DELETE" }).catch(() => undefined);
  }
}
