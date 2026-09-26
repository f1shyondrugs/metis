import { authenticateRemoteClient, listRemoteAudit, listRemoteClients } from "@/lib/remote-clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const clientId = req.headers.get("x-metis-client-id")?.trim();
  const auth = req.headers.get("authorization") || "";
  const credential = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!clientId || !credential) {
    return Response.json({ error: "Client credentials are required" }, { status: 401 });
  }
  const identity = authenticateRemoteClient(clientId, credential, false);
  if (!identity) return Response.json({ error: "Invalid or revoked client credentials" }, { status: 401 });

  const ownClient = listRemoteClients(identity.ownerId).find((client) => client.id === identity.clientId);
  if (!ownClient) return Response.json({ error: "Client not found" }, { status: 404 });
  const { ownerId: _ownerId, policy: _policy, ...client } = ownClient;
  const audit = listRemoteAudit(identity.ownerId, identity.clientId);
  return Response.json({ client, audit }, { headers: { "Cache-Control": "no-store" } });
}
