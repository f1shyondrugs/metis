import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getMcpServers } from "@/lib/mcp";

export async function callRemoteGatewayTool(
  name: string,
  args: Record<string, unknown>,
  context: Record<string, unknown> = {},
) {
  // The shared gateway core is intentionally kept as an ESM runtime module.
  let rawResult: unknown;
  if (process.env.METIS_DEVELOPMENT_BROKER) {
    // Native deployments keep web and tool execution under separate identities.
    const gateway = getMcpServers({ userId: String(context.userId || "") }).gateway;
    if (gateway.type !== "http") throw new Error("Native UI tools require the authenticated HTTP gateway");
    const client = new Client({ name: "metis-native-ui", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url), { requestInit: { headers: gateway.headers } }));
      const timeout = (Math.max(60, Math.min(Number(args.timeout) || 60, 3600)) + 15) * 1000;
      rawResult = await client.callTool({ name, arguments: args }, undefined, { timeout });
    } finally { await client.close(); }
  } else {
    // @ts-expect-error The runtime module has no generated TypeScript declarations.
    const { dispatchGatewayTool } = await import("../packages/mcp-gateway/index.mjs");
    rawResult = await dispatchGatewayTool(name, args, { context });
  }
  const result = rawResult as {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  if (result.isError) {
    throw new Error(
      result.content?.map((item) => item.text).filter(Boolean).join("\n") ||
        "Internal MCP action failed",
    );
  }
  const text = result.content?.map((item) => item.text || "").join("\n") || "";
  try {
    const structured = JSON.parse(text) as { stdout?: string; stderr?: string; exit_code?: number };
    if (typeof structured.stdout === "string") {
      return [
        structured.stdout,
        structured.stderr ? `\n${structured.stderr}` : "",
        typeof structured.exit_code === "number" && structured.exit_code !== 0
          ? `\n[exit code: ${structured.exit_code}]`
          : "",
      ].join("");
    }
  } catch {
    // Some child tools return plain text instead of the gateway's structured result.
  }
  return text;
}
