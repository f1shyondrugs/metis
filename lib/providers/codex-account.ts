import { spawnNative, nativeTemporaryHome, withNativeRuntime } from "./native-sandbox";
import { providerProcessEnv } from "./process-env";
import { writeSafeFile } from "@/lib/safe-file-read";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { codexCliExecutable } from "@/lib/providers/codex-cli";
import { findActiveConnection, getProviderConnection, getProviderConnectionSecret } from "@/lib/provider-connections";
import { readCodexOAuthCredentials } from "@/lib/providers/discovery";

export function readCodexUsageOAuthCredentials(secret: string) {
  return readCodexOAuthCredentials(secret, { allowExpired: true });
}

export type CodexAccountRequest =
  | { method: "account/rateLimits/read"; params?: { excludeResetCreditDetails?: boolean } }
  | { method: "account/rateLimitResetCredit/consume"; params: { creditId: string; idempotencyKey: string }; expectedBinding: string };

function session(ownerId: string, connectionId?: string) {
  const connection = connectionId ? getProviderConnection(connectionId, ownerId) : findActiveConnection(ownerId, "codex");
  if (!connection || !connection.enabled || connection.providerKey !== "codex") throw new Error("Codex account connection not found.");
  const credential = getProviderConnectionSecret(connection.id, ownerId);
  if (!credential?.secret?.trim()) throw new Error("Codex account is not authenticated.");
  let auth: Record<string, unknown> = {};
  let authTokens: { accessToken: string; chatgptAccountId: string } | undefined;
  let accountId: string | undefined;
  if (connection.authType === "oauth") {
    const oauth = readCodexUsageOAuthCredentials(credential.secret);
    accountId = oauth.accountId;
    authTokens = { accessToken: oauth.access, chatgptAccountId: oauth.accountId };
    auth = { auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: {
      access_token: oauth.access, refresh_token: oauth.refresh, id_token: oauth.idToken, account_id: oauth.accountId,
    }, last_refresh: new Date(oauth.expires).toISOString() };
  } else if (connection.authType === "account") {
    const parsed = JSON.parse(credential.secret);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid Codex account credential.");
    auth = parsed;
    accountId = typeof parsed.tokens?.account_id === "string" ? parsed.tokens.account_id : undefined;
  } else if (connection.authType !== "api_key") throw new Error("This connection does not expose ChatGPT account usage.");
  const binding = createHash("sha256").update(connection.id + ":" + (accountId || credential.secret)).digest("hex");
  const home = nativeTemporaryHome("codex-account-");
  try { writeSafeFile(path.join(home, "auth.json"), JSON.stringify(auth) + "\n"); }
  catch (error) { rmSync(home, { recursive: true, force: true }); throw error; }
  return { home, connection, binding, accountId, authTokens, apiKey: connection.authType === "api_key" ? credential.secret.trim() : undefined };
}

/** npm command shims are not executables on Windows; use their package's declared Node entry. */
export function codexAccountCommand(executable: string, platform: NodeJS.Platform = process.platform) {
  const args = ["app-server", "--stdio"];
  if (platform !== "win32" || executable.toLowerCase().endsWith(".exe")) return { command: executable, args };
  for (const directory of [
    path.resolve(path.dirname(executable), "..", "@openai", "codex"),
    path.resolve(path.dirname(executable), "node_modules", "@openai", "codex"),
  ]) {
    try {
      const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
      const relative = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.codex;
      if (typeof relative !== "string") continue;
      const entry = path.resolve(directory, relative);
      if (!entry.startsWith(directory + path.sep) || !existsSync(entry)) continue;
      return { command: process.execPath, args: [entry, ...args] };
    } catch { /* try the other npm layout */ }
  }
  throw new Error("The Codex launcher could not be resolved. Update the Codex runtime or configure its native executable.");
}

/** A short-lived, account-scoped app-server session shared by usage reads and confirmed reset actions. */
export async function requestCodexAccount(ownerId: string, connectionId: string | undefined, request: CodexAccountRequest): Promise<{ result: Record<string, unknown>; binding: string }> {
  return withNativeRuntime(ownerId, undefined, () => requestAccountInRuntime(ownerId, connectionId, request));
}

async function requestAccountInRuntime(ownerId: string, connectionId: string | undefined, request: CodexAccountRequest): Promise<{ result: Record<string, unknown>; binding: string }> {
  const auth = session(ownerId, connectionId);
  if (request.method === "account/rateLimitResetCredit/consume" &&
      (auth.connection.authType === "api_key" || request.expectedBinding !== auth.binding)) {
    rmSync(auth.home, { recursive: true, force: true });
    throw new Error("The account changed. Review the reset again.");
  }
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = providerProcessEnv({ CODEX_HOME: auth.home });
    delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY; delete env.OPENAI_BASE_URL;
    if (auth.apiKey) env.CODEX_API_KEY = auth.apiKey;
    let invocation: ReturnType<typeof codexAccountCommand>;
    try { invocation = codexAccountCommand(process.env.CODEX_BIN || codexCliExecutable()); }
    catch (error) { rmSync(auth.home, { recursive: true, force: true }); reject(error); return; }
    const child = spawnNative(invocation.command, invocation.args, {
      env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    let settled = false, buffer = "";
    const finish = (error?: Error, result?: Record<string, unknown>) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      child.kill("SIGTERM");
      rmSync(auth.home, { recursive: true, force: true });
      if (error) reject(error); else resolve({ result: result!, binding: auth.binding });
    };
    const timer = setTimeout(() => finish(new Error("Codex account request timed out.")), 15_000);
    const send = (message: unknown) => { if (!settled) child.stdin.write(JSON.stringify(message) + "\n"); };
    child.stdin.on("error", () => {});
    child.on("error", () => finish(new Error("Could not start the Codex account connection.")));
    child.on("close", () => finish(new Error("Codex account connection closed before responding.")));
    child.stdout.setEncoding("utf8");
    const actionId = auth.authTokens ? 3 : 2;
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 2 * 1024 * 1024) return finish(new Error("Codex account response exceeded the response limit."));
      let end: number;
      while (!settled && (end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message: { id?: unknown; result?: Record<string, unknown>; error?: { message?: unknown; code?: unknown } };
        try { message = JSON.parse(line); } catch { continue; }
        if (![1, 2, 3].includes(message.id as number)) continue;
        if (message.error) return finish(new Error(typeof message.error.message === "string" ? message.error.message.slice(0, 500) : "Codex account request failed."));
        if (!message.result || typeof message.result !== "object") continue;
        if (message.id === 1) {
          send({ method: "initialized", params: {} });
          if (auth.authTokens) send({ id: 2, method: "account/login/start", params: { type: "chatgptAuthTokens", ...auth.authTokens } });
          else send({ id: actionId, method: request.method, params: request.params || {} });
        } else if (auth.authTokens && message.id === 2) {
          send({ id: actionId, method: request.method, params: request.params || {} });
        } else if (message.id === actionId) {
          if (request.method === "account/rateLimits/read" && auth.accountId && typeof message.result.accountId === "string" && message.result.accountId !== auth.accountId) {
            return finish(new Error("The provider returned a different account."));
          }
          finish(undefined, message.result);
        }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "metis-account", version: "1.0" }, capabilities: { experimentalApi: true } } });
  });
}
