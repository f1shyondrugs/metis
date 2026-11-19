import { config } from "@/lib/config";
import { resolvePublicBaseUrl, type PublicBaseUrl } from "@/lib/public-base-url";
import { getDatabase } from "@/lib/sqlite";

const KEY = "public_base_url_override_v1";

// Runtime setting for share links, not an override of the server's bind,
// internal URLs, or trusted origins. An operator's changed env default wins.
export function getPublicBaseUrl(): PublicBaseUrl {
  const fallback = config.publicBaseUrl;
  const row = getDatabase().prepare("SELECT value FROM meta WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    const entry = JSON.parse(row.value) as { url?: unknown; defaultUrl?: unknown };
    if (entry.defaultUrl !== JSON.stringify(fallback) || typeof entry.url !== "string") return fallback;
    const base = resolvePublicBaseUrl(entry.url);
    if (base.state === "configured") return base;
  } catch { /* An absent or invalid runtime setting leaves the env default intact. */ }
  return fallback;
}

export function saveVerifiedPublicBaseUrl(base: Extract<PublicBaseUrl, { url: string }>) {
  if (base.state !== "configured") return;
  getDatabase().prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    KEY, JSON.stringify({ url: base.url, defaultUrl: JSON.stringify(config.publicBaseUrl) }),
  );
}
