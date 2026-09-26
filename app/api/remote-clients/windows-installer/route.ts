import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { isAuthenticated } from "@/lib/auth";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const filename = "Metis-AI-Remote-Client-Setup.exe";
const releaseUrl = "https://github.com/f1shyondrugs/metis-ai/releases/latest/download/" + filename;

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const file = path.join(config.dataDir, "remote-client-artifacts", filename);
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return Response.redirect(releaseUrl, 302);
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/vnd.microsoft.portable-executable",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
