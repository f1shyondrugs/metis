import { config } from "@/lib/config";
import { getGlobalModelSettings } from "@/lib/db-store";
import { featureFlags } from "@/lib/feature-flags";
import { signBrowserUserAction } from "@/lib/browser-user-capability";
import { ProtectedLoginError } from "@/lib/protected-login-errors";

export type SharedBrowserAction = {
  action: string;
  requestId?: string;
  password?: string;
  replace?: boolean;
  tabId?: string;
  url?: string;
  selector?: string;
  usernameSelector?: string;
  emailSelector?: string;
  fields?:Array<"password"|"username"|"email">;
  text?: string;
  key?: string;
  value?: string;
  targetSelector?: string;
  filePath?: string;
  exact?: boolean;
  timeoutMs?: number;
  includeScreenshot?: boolean;
  includeSnapshot?: boolean;
  steps?: SharedBrowserAction[];
  frame?: string;
  source?: "agent" | "user";
  x?: number;
  y?: number;
  deltaY?: number;
  width?: number;
  height?: number;
};

export type SharedBrowserResult = {
  sessionId: string;
  secureInput?: { requestId: string; origin: string; expiresAt: string };
  secureInputFilled?: boolean;
  tabId: string;
  activeTabId: string;
  url: string;
  title: string;
  tabs: Array<{ id: string; url: string; title: string }>;
  screenshot?: string;
  snapshot?: string;
  viewport: { width: number; height: number };
  form?: { text: string; controls: Array<Record<string, unknown>> };
  batch?: Array<{ index: number; action: string; ok: boolean; error?: string }>;
};

export async function performSharedBrowserAction(
  userId: string,
  chatId: string,
  action: SharedBrowserAction,
) {
  if (!featureFlags(getGlobalModelSettings(userId)).browser) {
    throw new Error(
      "The Metis workspace browser is disabled in Preferences. Enable Browser to use browser_* tools; shell/curl/Playwright are not used as a fallback.",
    );
  }
  const configuredToken =
    process.env.AI_CHAT_INTERNAL_TOKEN?.trim() ||
    process.env.MCP_BEARER_TOKEN?.trim();
  if (!configuredToken) throw new Error("An internal browser bearer token is required");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-AI-Chat-Internal": "1",
    "X-AI-Chat-Id": chatId,
    "X-AI-Chat-User-Id": userId,
  };
  headers.Authorization = `Bearer ${configuredToken}`;
  headers["X-Metis-Browser-App-Capability"] = signBrowserUserAction(userId, chatId, action);
  if (action.source === "user") headers["X-Metis-Browser-User-Capability"] = signBrowserUserAction(userId, chatId, action);

  let response: Response;
  try {
    response = await fetch(
      `http://127.0.0.1:${config.port}/__internal/browser-engine`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(action),
        cache: "no-store",
        signal: AbortSignal.timeout(90_000),
      },
    );
  } catch (error) {
    if (action.action === "secure_input_prepare") throw new ProtectedLoginError();
    throw new Error(
      error instanceof Error && error.name === "TimeoutError"
        ? "Browser action timed out"
        : "Browser engine is unreachable",
    );
  }
  const rawData: unknown = await response.json().catch(() => ({}));
  const data = (rawData && typeof rawData === "object" ? rawData : {}) as
    | SharedBrowserResult
    | { error?: string; code?: unknown };
  if (!response.ok) {
    if (action.action === "secure_input_prepare" || "code" in data) {
      throw new ProtectedLoginError("code" in data ? data.code : undefined);
    }
    throw new Error(
      "error" in data && data.error
        ? data.error
        : `Browser action failed (${response.status})`,
    );
  }
  return data as SharedBrowserResult;
}
