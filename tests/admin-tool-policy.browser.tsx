import { createRoot } from "react-dom/client";
import { AdminToolPolicyPanel } from "../components/admin-tool-policy-panel";
import { isHostToolPolicy, type HostToolPolicy } from "../lib/mcp-core/host-tool-policy.mjs";

let saved: HostToolPolicy = { revision: 0, rules: { terminal: "inherit", files: "inherit" } };
const fail = new URLSearchParams(location.search).get("scenario") === "conflict";
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input) !== "/api/admin/system/tool-policy") throw new Error("Unexpected fixture network request.");
  if (init?.method !== "PUT") return Response.json(saved);
  const next: unknown = JSON.parse(String(init.body));
  if (!isHostToolPolicy(next)) return Response.json({error:"Invalid fixture request."},{status:400});
  if (fail || next.revision !== saved.revision) return Response.json({error:"The policy changed in another session. Reload it before saving."},{status:409});
  saved = {...next, revision: next.revision + 1};
  return Response.json(saved);
}) as typeof fetch;
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto w-full max-w-3xl space-y-4 border-border p-4 sm:p-8">
    <h1 className="text-sm font-medium">Security &amp; permissions</h1>
    <AdminToolPolicyPanel />
  </main>,
);
