import { officePreviewResponse } from "@/lib/office-preview";
import { effectiveFileMime } from "@/lib/file-types";
import { fileResponse } from "@/lib/file-response";
import { chatShareCredential } from "@/lib/chat-share-access";
import { consumeSharePasswordLimit } from "@/lib/share-rate-limit";
import { getChatByShareId } from "@/lib/db-store";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function attachmentResponse(req: Request, body?: { id?: string; name?: string; password?: string }) {
  const url = new URL(req.url);
  const id = body?.id || url.searchParams.get("id") || "";
  const name = body?.name || url.searchParams.get("name") || "";
  const password = body?.password;
  if (typeof id!=="string" || typeof name!=="string" || !id || id.length>128 || name.length>500 || (password!==undefined && (typeof password!=="string" || password.length>4096))) return Response.json({error:"Invalid attachment request"},{status:400});
  const budget = password!==undefined ? consumeSharePasswordLimit(req,id) : null;
  if (budget && !budget.allowed) return Response.json({error:"Too many password attempts."},{status:429,headers:{"Retry-After":String(budget.retryAfterSeconds)}});
  const result = getChatByShareId(id, password, chatShareCredential(req,id));
  if (result.status === "not_found") return Response.json({ error: "Share not found" }, { status: 404 });
  if (result.status === "password_required") {
    return Response.json({ error: "Password required" }, { status: 401 });
  }
  budget?.reset();
  const attachment = result.chat.messages
    .flatMap((message) => message.attachments || [])
    .find((item) => item.storedName === name);
  if (!attachment?.storedName) return Response.json({ error: "Attachment not found" }, { status: 404 });
  const file = resolveUploadPath(result.chat.id, attachment.storedName, result.ownerId);
  if (!file) return Response.json({ error: "Attachment not found" }, { status: 404 });
  const response = url.searchParams.get("preview") === "1"
    ? await officePreviewResponse(file,effectiveFileMime(attachment.mimeType,attachment.name))
    : fileResponse(file, attachment, req);
  const current = getChatByShareId(id,password,chatShareCredential(req,id));
  if (current.status!=="ok" || !current.chat.messages.some(message=>message.attachments?.some(item=>item.storedName===name))) {
    await response.body?.cancel();
    return Response.json({error:"Attachment not found"},{status:404,headers:{"Cache-Control":"private, no-store"}});
  }
  response.headers.set("Cache-Control","private, no-store, max-age=0");
  response.headers.set("Referrer-Policy","no-referrer");
  return response;
}

export async function GET(req: Request) {
  return attachmentResponse(req);
}

export async function POST(req: Request) {
  let body: { id?: string; name?: string; password?: string };
  try {
    body = (await req.json()) as { id?: string; name?: string; password?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  return attachmentResponse(req, body);
}
