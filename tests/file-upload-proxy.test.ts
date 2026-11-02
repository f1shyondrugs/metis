import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-file-proxy-"));
process.env.CHAT_DATA_DIR = root;
process.env.CHAT_DB_PATH = path.join(root, "chat.sqlite");
process.env.AGENT_CWD = root;
delete process.env.CHAT_LEGACY_HEADER_AUTH;
after(async () => { await rm(root, { recursive: true, force: true }); });

test("real background uploads pass a 1 MiB HTTP proxy and resume without duplicated bytes", async () => {
  const auth = await import("../lib/auth");
  const { POST: create } = await import("../app/api/file-uploads/route");
  const api = await import("../app/api/file-uploads/[id]/route");
  const store = await import("../lib/file-upload-store");
  const owner = auth.createUser("proxy-owner", "test-password");
  const token = auth.authenticateUser(owner.username, "test-password")!.token;
  const cookie = "ai_chat_auth=" + token;
  const nativeFetch = globalThis.fetch;
  const originalXhr = globalThis.XMLHttpRequest;
  const writes: Array<{ id: string; offset: number; size: number }> = [];
  let creations = 0, rejected = 0, failNext = false;
  let base = "";
  const server = createServer(async (incoming, outgoing) => {
    try {
      const parts: Buffer[] = [];
      for await (const part of incoming) parts.push(Buffer.from(part));
      const body = Buffer.concat(parts);
      if (body.length >= 1024 * 1024) {
        rejected++;
        outgoing.writeHead(413, { "Content-Type": "text/html" }).end("<h1>Content Too Large</h1>");
        return;
      }
      const method = incoming.method || "GET";
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const req = new Request(base + incoming.url, {
        method, headers, ...(body.length ? { body } : {}),
      });
      let response: Response;
      if (incoming.url === "/api/file-uploads") {
        creations++;
        response = await create(req);
      } else {
        const id = incoming.url!.split("/").at(-1)!;
        const context = { params: Promise.resolve({ id }) };
        if (method === "PUT") {
          const offset = Number(headers.get("Upload-Offset"));
          if (failNext && offset > 0) {
            failNext = false;
            outgoing.writeHead(503, { "Content-Type": "application/json" }).end('{"error":"Test connection interruption"}');
            return;
          }
          response = await api.PUT(req, context);
          if (response.ok) writes.push({ id, offset, size: body.length });
        } else if (method === "POST") response = await api.POST(req, context);
        else if (method === "DELETE") response = await api.DELETE(req, context);
        else response = await api.GET(req, context);
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(500).end(String(error));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  class Xhr {
    upload = { onprogress: null as null | ((event: { loaded: number }) => void) };
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    ontimeout?: () => void;
    status = 0;
    responseText = "";
    timeout = 0;
    url = "";
    headers: Record<string, string> = {};
    controller = new AbortController();
    open(_method: string, url: string) { this.url = url; }
    setRequestHeader(name: string, value: string) { this.headers[name] = value; }
    send(body: Blob) {
      void nativeFetch(base + this.url, {
        method: "PUT", headers: { ...this.headers, cookie }, body, signal: this.controller.signal,
      }).then(async response => {
        this.status = response.status;
        this.responseText = await response.text();
        this.upload.onprogress?.({ loaded: body.size });
        this.onload?.();
      }).catch(() => { if (this.controller.signal.aborted) this.onabort?.(); else this.onerror?.(); });
    }
    abort() { this.controller.abort(); }
  }
  globalThis.XMLHttpRequest = Xhr as unknown as typeof XMLHttpRequest;
  globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("cookie", cookie);
    return nativeFetch(base + String(input), { ...init, headers });
  };
  try {
    // Establish that the fixture really rejects the old multi-MiB transport.
    const legacy = await nativeFetch(base + "/api/file-uploads/probe", {
      method: "PUT", body: new Uint8Array(2 * 1024 * 1024),
    });
    assert.equal(legacy.status, 413);
    const client = await import("../lib/background-uploads");
    const source = new Uint8Array(3 * 1024 * 1024 + 117).fill(93);
    const id = client.startUpload(new File([source], "large.bin"), { label: "Test" });
    const complete = await client.waitForUpload(id);
    assert.deepEqual(await readFile(store.completedUploadPath(owner.id, complete.id)), Buffer.from(source));
    assert.equal(rejected, 1, "new uploads must not hit the proxy limit");
    assert.equal(creations, 1);
    assert.ok(writes.length > 3, "large file is transferred in small requests");
    assert.ok(writes.every(write => write.size <= 512 * 1024));
    assert.equal(writes.reduce((sum, write) => sum + write.size, 0), source.byteLength);

    failNext = true;
    const retryId = client.startUpload(new File([source], "retry.bin"), { label: "Test retry" });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { unsubscribe(); reject(new Error("No upload error")); }, 10_000);
      const check = () => {
        if (client.getUploadStatus(retryId) === "error") { clearTimeout(timeout); unsubscribe(); resolve(); }
      };
      const unsubscribe = client.subscribeUploads(check);
      check();
    });
    const firstWrite = writes.at(-1)!;
    assert.ok(firstWrite.size > 0 && firstWrite.size < source.byteLength);
    assert.equal(store.getUpload(owner.id, firstWrite.id).offset, firstWrite.size);
    const before = writes.length;
    client.retryUpload(retryId);
    const resumed = await client.waitForUpload(retryId);
    assert.equal(resumed.id, firstWrite.id, "retry keeps the same upload");
    assert.equal(writes[before].offset, firstWrite.size, "resume uses the server's saved offset");
    assert.equal(creations, 2, "retry must not create another session");
    assert.deepEqual(await readFile(store.completedUploadPath(owner.id, resumed.id)), Buffer.from(source));
    assert.equal(writes.filter(write => write.id === resumed.id).reduce((sum, write) => sum + write.size, 0), source.byteLength);
    assert.equal(rejected, 1);

    // Existing clients can still send larger chunks to the application itself.
    const old = store.createUpload(owner.id, { name: "old.bin", mimeType: "application/octet-stream", size: 2 * 1024 * 1024 });
    await store.appendUpload(owner.id, old.id, 0, new Blob([new Uint8Array(old.size)]).stream());
    assert.equal(store.completeUpload(owner.id, old.id).size, old.size);
  } finally {
    globalThis.fetch = nativeFetch;
    globalThis.XMLHttpRequest = originalXhr;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
