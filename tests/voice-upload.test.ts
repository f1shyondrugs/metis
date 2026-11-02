import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { transcribeRecording, VOICE_UPLOAD_CHUNK_BYTES } from "../lib/voice-upload";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-voice-upload-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;
process.env.CHAT_PASSWORD = "voice-test-password";
process.env.CHAT_LEGACY_HEADER_AUTH = "true";
process.env.OPENAI_API_KEY = "voice-test-key";
after(async () => { await rm(dataDir, { recursive: true, force: true }); });

test("recordings cross a 1 MiB proxy intact; upload ownership, validation and cleanup remain enforced", async () => {
  const { createUser } = await import("../lib/auth");
  const { POST: create } = await import("../app/api/file-uploads/route");
  const uploadRoute = await import("../app/api/file-uploads/[id]/route");
  const { POST: transcribe } = await import("../app/api/voice/transcribe/route");
  const store = await import("../lib/file-upload-store");
  const { PATCH: preferences } = await import("../app/api/attachment-settings/route");
  const owner = createUser("voice-owner", "test-password");
  const other = createUser("voice-other", "test-password");
  const headers = { "x-chat-password": "voice-test-password", "x-chat-username": owner.username };
  const limited = await preferences(new Request("http://localhost/api/preferences", {
    method: "PATCH", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ maxBytes: 1024 }),
  }));
  assert.equal(limited.status, 200);
  const normalUpload = await create(new Request("http://localhost/api/file-uploads", {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "large.bin", mimeType: "application/octet-stream", size: 2048 }),
  }));
  assert.equal(normalUpload.status, 400, "ordinary attachments keep their own limit");
  const audio = new Blob([new Uint8Array(3 * 1024 * 1024 + 27).fill(37)], { type: "audio/webm" });
  const originalFetch = globalThis.fetch;
  let activeUser = owner.username;
  let providerCalls = 0;
  let uploadId = "";
  let rejectChunk = false;
  let failProvider = false;
  const chunkSizes: number[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://")) {
      providerCalls++;
      if (failProvider) return Response.json({ error: { message: "Provider unavailable" } }, { status: 503 });
      const sent = (init?.body as FormData).get("file") as File;
      assert.deepEqual(Buffer.from(await sent.arrayBuffer()), Buffer.from(await audio.arrayBuffer()));
      return Response.json({ text: "Complete recording." });
    }
    const req = new Request("http://localhost" + url, {
      ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...headers, "x-chat-username": activeUser },
    });
    assert.ok((await req.clone().arrayBuffer()).byteLength < 1024 * 1024, "every serialized request must fit below the proxy limit");
    if (url === "/api/file-uploads") {
      const response = await create(req);
      if (response.ok) uploadId = (await response.clone().json()).id;
      return response;
    }
    if (url === "/api/voice/transcribe") {
      const form = await req.clone().formData();
      assert.equal(form.has("file"), false);
      return transcribe(req);
    }
    const context = { params: Promise.resolve({ id: url.split("/").pop()! }) };
    if (init?.method === "PUT") {
      const size = (init.body as Blob).size;
      chunkSizes.push(size);
      assert.ok(size <= VOICE_UPLOAD_CHUNK_BYTES && size < 1024 * 1024);
      if (rejectChunk) return new Response("<html>Too large</html>", { status: 413 });
      return uploadRoute.PUT(req, context);
    }
    if (init?.method === "DELETE") return uploadRoute.DELETE(req, context);
    return uploadRoute.POST(req, context);
  };
  const form = () => { const f = new FormData(); f.set("durationSeconds", "30"); return f; };
  try {
    assert.equal(await transcribeRecording(audio, form()), "Complete recording.");
    assert.equal(providerCalls, 1);
    assert.equal(chunkSizes.reduce((a, b) => a + b, 0), audio.size);
    assert.throws(() => store.getUpload(owner.id, uploadId), /not found/);

    rejectChunk = true;
    await assert.rejects(transcribeRecording(audio, form()), /too large/);
    assert.throws(() => store.getUpload(owner.id, uploadId), /not found/);
    assert.equal(providerCalls, 1);
    rejectChunk = false;

    failProvider = true;
    await assert.rejects(transcribeRecording(audio, form()), /Provider unavailable/);
    assert.throws(() => store.getUpload(owner.id, uploadId), /not found/);
    failProvider = false;

    const pending = store.createUpload(owner.id, { name: "voice.webm", mimeType: "audio/webm", size: 1 });
    const check = async (id: string, username = owner.username) => {
      const f = form(); f.set("uploadId", id);
      return transcribe(new Request("http://localhost/api/voice/transcribe", {
        method: "POST", headers: { ...headers, "x-chat-username": username }, body: f,
      }));
    };
    assert.equal((await check(pending.id)).status, 400);
    await store.appendUpload(owner.id, pending.id, 0, new Blob(["a"]).stream());
    store.completeUpload(owner.id, pending.id);
    assert.equal((await check(pending.id, other.username)).status, 400);
    assert.equal((await check("../file")).status, 400);
    const bad = store.createUpload(owner.id, { name: "text.txt", mimeType: "text/plain", size: 1 });
    await store.appendUpload(owner.id, bad.id, 0, new Blob(["a"]).stream());
    store.completeUpload(owner.id, bad.id);
    assert.equal((await check(bad.id)).status, 415);
    const large = store.createUpload(owner.id, { name: "huge.webm", mimeType: "audio/webm", size: 251 * 1024 * 1024 }, { maxBytes: 0 });
    // Completed metadata cannot bypass the transcription limit.
    const { writeFileSync, truncateSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const dir = path.join(dataDir, "file-uploads", createHash("sha256").update(owner.id).digest("hex"), large.id);
    truncateSync(path.join(dir, "file"), large.size);
    writeFileSync(path.join(dir, "metadata.json"), JSON.stringify({ ...large, offset: large.size, complete: true }));
    assert.equal((await check(large.id)).status, 413);
    assert.equal((await transcribe(new Request("http://localhost/api/voice/transcribe", { method: "POST", body: form() }))).status, 401);
  } finally { activeUser = owner.username; globalThis.fetch = originalFetch; }
});

test("small recordings retain the direct multipart request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(input, "/api/voice/transcribe");
    assert.equal(((init?.body as FormData).get("file") as File).size, 10);
    return Response.json({ transcript: "Small recording." });
  };
  try { assert.equal(await transcribeRecording(new Blob(["0123456789"]), new FormData()), "Small recording."); assert.equal(calls, 1); }
  finally { globalThis.fetch = originalFetch; }
});
