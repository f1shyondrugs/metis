"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, PDFWorker, RenderTask } from "pdfjs-dist";

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PAGES = 200;

// Only canonical account-authorized attachment endpoints. Never resolve arbitrary URLs.
export function isOverlayPdfUrl(url: string): boolean {
  if (/^\/api\/file-uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/file$/.test(url)) return true;
  const match = /^\/api\/uploads\/([A-Za-z0-9_-]+)\/([^/?#\\\s]+)$/.exec(url);
  if (!match) return false;
  try {
    const name = decodeURIComponent(match[2]);
    return !name.includes("%") && name !== "." && name !== ".." && !/[/\\\u0000-\u001f\u007f]/.test(name) && encodeURIComponent(name) === match[2];
  } catch { return false; }
}

async function readPdf(url: string, signal: AbortSignal) {
  const response = await fetch(url, { credentials: "same-origin", redirect: "error", signal });
  if (!response.ok) throw new Error("The PDF could not be loaded.");
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("PDF preview is limited to 32 MiB.");
  if (!response.body) throw new Error("The PDF response was empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new Error("PDF preview is limited to 32 MiB.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (!length || !(response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/pdf" ||
    new TextDecoder("ascii").decode(bytes.subarray(0, 5)) === "%PDF-")) throw new Error("This attachment is not a PDF.");
  return bytes;
}

type PdfFile = { url: string; name: string; mimeType: string; size?: number };
export function OverlayPdfPreview({ file }: { file: PdfFile }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(600);
  const [status, setStatus] = useState("Loading PDF preview…");
  const [error, setError] = useState("");
  const identity = file.url + ":" + attempt;
  const [loadedIdentity, setLoadedIdentity] = useState("");
  const ready = loadedIdentity === identity;

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(1, entries[0].contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    let worker: PDFWorker | undefined;
    let nativeWorker: Worker | undefined;
    setDocument(null); setLoadedIdentity(""); setPage(1); setError(""); setStatus("Loading PDF preview…");
    const timeout = setTimeout(() => { if (active) { setError("PDF preview timed out. Try again."); abort.abort(); void task?.destroy(); nativeWorker?.terminate(); } }, 30000);
    void (async () => {
      try {
        if (!isOverlayPdfUrl(file.url)) throw new Error("PDF preview requires a trusted attachment URL.");
        if (file.size !== undefined && file.size > MAX_BYTES) throw new Error("PDF preview is limited to 32 MiB.");
        const data = await readPdf(file.url, abort.signal);
        const pdfjs = await import("pdfjs-dist");
        if (!active || abort.signal.aborted) return;
        // Explicit port prevents pdf.js falling back to a main-thread fake worker.
        nativeWorker = new Worker("/api/desktop-overlay/pdf-worker?v=" + encodeURIComponent(pdfjs.version), { type: "module" });
        worker = pdfjs.PDFWorker.create({ port: nativeWorker });
        // pdf.js 6 removed eval compilation; the compatibility option remains explicit.
        const options = {
          data, worker, isEvalSupported: false, useWasm: false, useWorkerFetch: false,
          disableAutoFetch: true, disableStream: true, disableRange: true,
          enableXfa: false, disableFontFace: true, useSystemFonts: true,
          isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
          maxImageSize: 16_000_000, canvasMaxAreaInBytes: 64_000_000,
        };
        task = pdfjs.getDocument(options);
        const pdf = await task.promise;
        if (!active || abort.signal.aborted) return;
        if (pdf.numPages < 1 || pdf.numPages > MAX_PAGES) throw new Error("PDF preview supports 1–200 pages.");
        setDocument(pdf); setLoadedIdentity(identity); setStatus("Rendering PDF page…");
        clearTimeout(timeout);
      } catch (cause) {
        if (!active || abort.signal.aborted) return;
        clearTimeout(timeout);
        void task?.destroy(); worker?.destroy(); nativeWorker?.terminate();
        setError(cause instanceof Error && cause.name === "PasswordException"
          ? "Password-protected PDFs are unavailable in this preview."
          : cause instanceof Error ? cause.message : "PDF preview is unavailable.");
      }
    })();
    return () => { active = false; clearTimeout(timeout); abort.abort(); void task?.destroy(); worker?.destroy(); nativeWorker?.terminate(); };
  }, [file.url, file.size, identity]);

  useEffect(() => {
    if (!document || !ready) return;
    let active = true;
    let render: RenderTask | undefined;
    setStatus("Rendering PDF page…"); setError("");
    void (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (!active || !canvas.current) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        if (!(natural.width > 0 && natural.height > 0 && Number.isFinite(natural.width + natural.height))) throw new Error("Invalid PDF page dimensions.");
        const scale = Math.min(width / natural.width * Math.min(window.devicePixelRatio || 1, 2),
          4096 / natural.width, 4096 / natural.height, Math.sqrt(16_000_000 / (natural.width * natural.height)));
        const viewport = pdfPage.getViewport({ scale });
        // Render offscreen, so a cancelled/old page can never paint over the current one.
        const surface = window.document.createElement("canvas");
        surface.width = Math.max(1, Math.floor(viewport.width));
        surface.height = Math.max(1, Math.floor(viewport.height));
        render = pdfPage.render({ canvas: surface, viewport, annotationMode: 0 });
        await render.promise;
        if (!active || !canvas.current) return;
        canvas.current.width = surface.width; canvas.current.height = surface.height;
        canvas.current.getContext("2d")?.drawImage(surface, 0, 0);
        setStatus("");
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "This PDF page could not be rendered.");
      }
    })();
    return () => { active = false; render?.cancel(); };
  }, [document, ready, page, width]);

  const buttonStyle = { minHeight: 44, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--muted, #27272a)", color: "var(--foreground, #fafafa)" };
  return <div data-overlay-pdf="" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
    <div role="group" aria-label="PDF pages" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 8 }}>
      <button type="button" style={buttonStyle} disabled={!ready || !document || page <= 1} onClick={() => setPage(p => p - 1)}>Previous page</button>
      <span aria-live="polite">{ready && document ? `Page ${page} of ${document.numPages}` : "PDF preview"}</span>
      <button type="button" style={buttonStyle} disabled={!ready || !document || page >= document.numPages} onClick={() => setPage(p => p + 1)}>Next page</button>
    </div>
    {error ? <div role="alert" style={{ padding: 12 }}><p>{error}</p><button type="button" style={buttonStyle} onClick={() => setAttempt(a => a + 1)}>Retry PDF preview</button></div> : status && <p role="status" style={{ padding: 12 }}>{status}</p>}
    <div ref={container} aria-busy={!!status && !error} style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
      <canvas ref={canvas} role="img" aria-label={`${file.name}, page ${page}`} hidden={!ready || !!status || !!error} style={{ display: !ready || status || error ? "none" : "block", maxWidth: "100%", height: "auto", margin: "0 auto", background: "white" }} />
    </div>
  </div>;
}
