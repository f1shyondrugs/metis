import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { searchOffThread } from "@/lib/chat-search";
import { getGlobalModelSettings } from "@/lib/db-store";
import { featureFlags } from "@/lib/feature-flags";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
    const headers = { "Cache-Control": "no-store" };
    if (!(await isAuthenticated(req)))
        return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    const url = new URL(req.url), query = (url.searchParams.get("q") || "").trim().slice(0, 200);
    const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
    const requested = Number(url.searchParams.get("limit") || 30);
    const limit = Number.isFinite(requested) ? Math.min(50, Math.max(1, Math.floor(requested))) : 30;
    const related = url.searchParams.get("related") === "1";
    try {
        const includeNotes = related && featureFlags(getGlobalModelSettings(ownerId)).notes;
        const data = await searchOffThread(query, ownerId, limit, related, req.signal, includeNotes, url.searchParams.get("group") === "chat");
        return Response.json(related ? data : { results: data.results, indexing: data.indexing }, { headers });
    }
    catch (error) {
        const aborted = (error as Error).name === "AbortError";
        return Response.json({ error: aborted ? "Search cancelled" : "Search is temporarily unavailable. Please retry." }, { status: aborted ? 499 : 503, headers });
    }
}
