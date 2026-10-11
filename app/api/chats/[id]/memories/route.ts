import {getAuthenticatedUser} from "@/lib/auth";
import {loadChatMemoryView} from "@/lib/chat-memory-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, {params}: {params: Promise<{id: string}>}) {
 const user = await getAuthenticatedUser(req);
 if (!user) return Response.json({error: "Unauthorized"}, {status: 401});
 const {id} = await params;
 const view = loadChatMemoryView(id, user.id);
 if (!view) return Response.json({error: "Not found"}, {status: 404});
 return Response.json(view, {headers: {"Cache-Control": "no-store"}});
}
