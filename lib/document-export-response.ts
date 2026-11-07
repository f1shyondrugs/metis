import { documentExportName, markdownPlainText, type DocumentExportFormat } from "@/lib/document-export";
import { documentExportPdf, ExportBusyError } from "@/lib/document-export-pdf";

export async function documentExportResponse(name: string, content: string, format: DocumentExportFormat, signal?: AbortSignal) {
  try {
    const result = format === "pdf" ? new Uint8Array(await documentExportPdf(name, content, signal))
      : format === "txt" ? markdownPlainText(content) : content;
    return new Response(result, { headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : format === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
      "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(documentExportName(name, format)),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    const missingBrowser = error instanceof Error && /Executable doesn't exist/.test(error.message);
    return Response.json({ error: missingBrowser
      ? "PDF export requires Chromium. Install the browser engine in Settings and try again."
      : error instanceof ExportBusyError ? error.message : "The document could not be exported. Please try again.",
    }, { status: error instanceof ExportBusyError || missingBrowser ? 503 : 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
