import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {nativeRuntimeScope,nativeTemporaryHome} from "./native-sandbox";
import {ensureSafeDirectory,writeSafeFile} from "@/lib/safe-file-read";

export async function createCodexHome(
  secret: string | undefined,
  authType: "account" | "oauth",
  persistentHome?: string,
) {
  if (!secret?.trim()) return undefined;
  let auth: unknown;
  try {
    auth = JSON.parse(secret);
  } catch {
    throw new Error("Codex credentials are not valid JSON.");
  }
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
    throw new Error("Codex credentials are not a valid JSON object.");
  }
  const home = persistentHome || (nativeRuntimeScope()?nativeTemporaryHome("codex-"):(await mkdtemp(path.join(os.tmpdir(), "ai-chat-codex-"))));
  ensureSafeDirectory(home);
  const authFile = path.join(home, "auth.json");
  const authObject = authType === "oauth"
    ? (() => {
        const record = (auth as Record<string, unknown>)["openai-codex"];
        const oauth = record && typeof record === "object" ? record as Record<string, unknown> : {};
        const idToken = typeof oauth.idToken === "string"
          ? oauth.idToken
          : typeof oauth.id_token === "string"
            ? oauth.id_token
            : undefined;
        if (typeof oauth.access !== "string" || typeof oauth.refresh !== "string" || !idToken) {
          throw new Error("Codex OAuth credentials are incomplete.");
        }
        return {
          auth_mode: "chatgpt",
          OPENAI_API_KEY: null,
          tokens: {
            access_token: oauth.access,
            refresh_token: oauth.refresh,
            id_token: idToken,
            ...(typeof oauth.accountId === "string" ? { account_id: oauth.accountId } : {}),
          },
          last_refresh: new Date().toISOString(),
        };
      })()
    : auth;
  writeSafeFile(authFile, `${JSON.stringify(authObject)}\n`);
  return { home, authFile, temporary: !persistentHome };
}
