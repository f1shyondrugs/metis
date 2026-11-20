import { browserLoginRequest } from "./browser-login-client";
import { consoleTargetInfo, savedLoginSummaries, type SavedLogin } from "./credential-vault";
import { type ProtectedLoginReply } from "./protected-login-contract";

type ConsoleLogin = {
  action: "connect" | "authenticate" | "request_password";
  method?: "ssh" | "sudo" | "su";
  user?: string;
  host?: string;
  port?: number;
  replace?: boolean;
  credentialId?: string;
};

type VaultStatus = "matching_entry" | "no_matching_entry" | "vault_unavailable" | "target_not_verified";
type ConsoleStatus = "console_ready" | "console_password_entered" |
  "console_policy_blocked" | "console_unavailable" | "input_required";

export async function listSavedLoginSummaries(owner: string, chat: string, request = browserLoginRequest) {
  const { credentials, partial } = await request(owner, chat, "list", {}, true);
  if (!Array.isArray(credentials) || partial === true) throw new Error("Credential vault listing unavailable");
  return savedLoginSummaries(credentials as SavedLogin[]);
}

const unavailable = "No verified protected password prompt is available.";
const policyBlocked = "Server policy blocked protected console access. A password cannot resolve this.";

function blockedByPolicy(input: ConsoleLogin, reply: ProtectedLoginReply) {
  if (reply.status === "console_policy_blocked") return true;
  if (reply.reason === "Protected elevation inside an existing SSH session is unavailable. Connect directly to the target SSH account.") return true;
  // Compatibility with the installed console broker, which sends redacted
  // diagnostic output rather than a structured code. Do not classify SSH-side
  // terminal text as the local server's policy and never relay raw diagnostics.
  if (input.method !== "sudo" && input.method !== "su") return false;
  const diagnostic = typeof reply.output === "string" ? reply.output : "";
  return /^sudo: [^\r\n]*no new privileges/mi.test(diagnostic) ||
    /^(?:sudo: )?[a-z_][a-z0-9_.-]* is not in the sudoers file\./mi.test(diagnostic) ||
    /^Sorry, user [a-z_][a-z0-9_.-]* is not allowed to execute/mi.test(diagnostic);
}

const descriptions: Record<VaultStatus, string> = {
  matching_entry: "A saved entry matches the verified target.",
  no_matching_entry: "No saved entry matches the verified target.",
  vault_unavailable: "Saved console entries could not be checked.",
  target_not_verified: "The exact console target could not be verified.",
};

export function consoleVaultDescription(vaultStatus: VaultStatus) {
  return descriptions[vaultStatus];
}

export async function prepareProtectedConsole(owner: string, chat: string, input: ConsoleLogin, request = browserLoginRequest):
  Promise<{ status: ConsoleStatus; vaultStatus: VaultStatus; sessionId?: string; message?: string; secureInput?: ProtectedLoginReply["secureInput"] }> {
  // Separate availability from an empty list, and retain the broker's exact
  // owner/chat/target/host-key match for actual credential reuse.
  const saved = await listSavedLoginSummaries(owner, chat, request).catch(() => null);
  let vaultStatus: VaultStatus = saved ? "target_not_verified" : "vault_unavailable";
  let reply: ProtectedLoginReply;
  try {
    reply = await request(owner, chat, input.credentialId ? "console_prepare_named" : input.action === "authenticate" ? "console_elevate" : "console_prepare",
      { ...input, replaceSession: input.action === "connect" });
  } catch {
    return { status: "console_unavailable", vaultStatus, message: unavailable };
  }
  const target = reply.target && consoleTargetInfo(reply.target);
  const connection = target ? target.connection : undefined;
  const matchesRequest = Boolean(connection && (input.action === "request_password" ||
    (connection.method === input.method && connection.user === input.user &&
      (connection.method !== "ssh" || (connection.host === input.host?.toLowerCase() && connection.port === (input.port ?? 22))))));
  if (saved && matchesRequest) {
    vaultStatus = saved.some(entry => entry.kind === "console" && entry.origin === reply.target)
      ? "matching_entry" : "no_matching_entry";
  }
  const sessionId = reply.sessionId;
  if (reply.status === "console_password_entered" && sessionId) {
    // Chat-only entries need not appear in the permanent management index.
    return { status: reply.status, sessionId, vaultStatus: "matching_entry" };
  }
  if (reply.status === "console_ready" && sessionId) return { status: reply.status, sessionId, vaultStatus };
  if (blockedByPolicy(input, reply)) return { status: "console_policy_blocked", vaultStatus, message: policyBlocked, sessionId };
  const secure = reply.secureInput;
  if (reply.status === "input_required" && matchesRequest && sessionId && secure?.kind === "console" &&
    secure.sessionId === sessionId && secure.requestId && secure.origin && Date.parse(secure.expiresAt) > Date.now()) {
    return { status: "input_required", vaultStatus, sessionId, secureInput: secure };
  }
  return { status: "console_unavailable", vaultStatus, message: unavailable, sessionId };
}
