import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, fixed library code only. No path/query input, attachment bytes or credentials.
// The deployment must retain node_modules (as the existing server runtime does).
export async function GET() {
  const worker = await readFile(path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.mjs"));
  return new Response(worker, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
