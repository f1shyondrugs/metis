import type { ProviderContext } from "./provider-support";
import type { ProviderResult } from "./contract";
import { unsupported, type ProviderAdapterShape } from "./contract";
import { runAcpStdioAgent } from "@/lib/providers/acp-stdio";
import { getUserAgentCwd, getMcpServers } from "@/lib/mcp";
import type { McpServerMap } from "@/lib/mcp";
import {
  effectiveModelParams,
  providerConversationPrompt,
  providerMcpContext,
  providerPrompt,
} from "@/lib/providers/adapters/provider-support";

type AcpCliAdapterConfig = {
  readonly key: "grok-cli" | "opencode-cli";
  readonly binary: string;
  readonly args: readonly string[];
  readonly env?: (mcp: McpServerMap) => Record<string, string>;
};

export function opencodeMcpOnlyEnv(mcp: McpServerMap) {
  const permission: Record<string, "allow" | "deny"> = { "*": "deny" };
  for (const name of Object.keys(mcp)) {
    permission[`${name}_*`] = "allow";
    permission[`mcp__${name}__*`] = "allow";
  }
  return {
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission }),
  };
}

function acpCliAdapter(config: AcpCliAdapterConfig): ProviderAdapterShape {
  const capabilities = {
    contextOwner: "metis",
    persistentThreads: false,
    interruptibleTurns: true,
    interactiveRequests: false,
    sessionModelSwitch: "unsupported",
    nativeSubagents: false,
    nativeContextTelemetry: false,
  } as const;
  return {
    key: config.key,
    capabilities,
    runTurn: async (context: ProviderContext): Promise<ProviderResult> => {
      const binary =
        typeof context.connection.config.binaryPath === "string" &&
        context.connection.config.binaryPath.trim()
          ? context.connection.config.binaryPath.trim()
          : config.binary;
      const mcp = getMcpServers(providerMcpContext(context));
      const result = await runAcpStdioAgent({
        command: binary,
        args: [...config.args],
        env: config.env?.(mcp),
        cwd: getUserAgentCwd(context.job.userId),
        prompt: [
          providerPrompt(
            context.job,
            ["mcp"],
            true,
            effectiveModelParams(context.chat, context.job),
          ),
          providerConversationPrompt(context),
        ]
          .filter(Boolean)
          .join("\n\nUser request:\n"),
        mcp,
        signal: context.signal,
        clientName: "metis-ai",
        onText: context.onText,
        onTool: context.onTool,
      });
      return result.sessionId
        ? { agentId: `${config.binary}:${result.sessionId}` }
        : {};
    },
    startSession: () => unsupported("startSession", config.key),
    sendTurn: () => unsupported("sendTurn", config.key),
    interrupt: () => unsupported("interrupt", config.key),
    respondToRequest: () => unsupported("respondToRequest", config.key),
    respondToUserInput: () => unsupported("respondToUserInput", config.key),
    stopSession: () => unsupported("stopSession", config.key),
    readThread: () => unsupported("readThread", config.key),
    rollbackThread: () => unsupported("rollbackThread", config.key),
    streamEvents: () => unsupported("streamEvents", config.key),
  };
}

export const grokAdapter = acpCliAdapter({
  key: "grok-cli",
  binary: "grok",
  args: ["--no-subagents", "--disable-web-search", "--tools", "", "agent", "stdio"],
});

export const opencodeAdapter = acpCliAdapter({
  key: "opencode-cli",
  binary: "opencode",
  args: ["--pure", "acp"],
  env: opencodeMcpOnlyEnv,
});
