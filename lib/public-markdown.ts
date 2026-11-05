import { parseInternalLink } from "@/lib/internal-link";

export type PublicMarkdownShare = {
  noteIds: readonly string[];
  chatShareId?: string;
  /** Exact asset projections supplied by the public share API. */
  assets: Readonly<Record<string, string>>;
  onOpenNote?: (id: string, blockId?: string) => void;
  workspaces?: readonly { id: string; type: "canvas" | "plan" }[];
  onOpenWorkspace?: (id: string, type: "canvas" | "plan") => void;
};

function isSharedAssetUrl(value: string, share: PublicMarkdownShare) {
  if (share.chatShareId && value.startsWith("/api/share/attachment?")) {
    try {
      const url = new URL(value,"https://public-share.invalid");
      return !/[\u0000-\u0020\u007f\\]/.test(value) && url.pathname === "/api/share/attachment" && !url.hash && url.searchParams.get("id") === share.chatShareId && Boolean(url.searchParams.get("name"));
    } catch { return false; }
  }
  if (!/^\/api\/shared-notes\/[A-Za-z0-9_-]+\/assets\?/.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  try {
    const url = new URL(value, "https://public-share.invalid");
    return /^\/api\/shared-notes\/[A-Za-z0-9_-]+\/assets$/.test(url.pathname) && url.searchParams.has("url") && !url.hash;
  } catch { return false; }
}

/** Never fall back to the visitor's authenticated attachment endpoints. */
export function publicMarkdownAssetUrl(source: string, share: PublicMarkdownShare): string | undefined {
  const projected = Object.hasOwn(share.assets, source) ? share.assets[source]
    : Object.values(share.assets).includes(source) ? source : undefined;
  return typeof projected === "string" && isSharedAssetUrl(projected, share) ? projected : undefined;
}

function externalHttpsUrl(value: string): string | undefined {
  if (!/^https:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    // Absolute URLs can point back at this application's private API, too.
    let pathname = url.pathname;
    for (let count = 0; count < 3; count++) {
      if (/^\/api(?:\/|$)/i.test(pathname)) return undefined;
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    }
    return value;
  } catch { return undefined; }
}

export type PublicMarkdownLinkTarget =
  | { kind: "note"; href: string; id: string; blockId?: string }
  | { kind: "workspace"; href: string; id: string; type: "canvas" | "plan" }
  | { kind: "asset" | "external" | "anchor"; href: string };

export function publicMarkdownLinkTarget(source: string, share: PublicMarkdownShare): PublicMarkdownLinkTarget | undefined {
  const asset = publicMarkdownAssetUrl(source, share);
  if (asset) return { kind: "asset", href: asset };
  const internal = parseInternalLink(source);
  if (internal) {
    if ((internal.kind === "canvas" || internal.kind === "plan") && share.workspaces?.some(item => item.id === internal.id && item.type === internal.kind)) {
      return { kind: "workspace", href: "#workspace-" + encodeURIComponent(internal.id), id: internal.id, type: internal.kind };
    }
    if (internal.kind !== "note" || !share.noteIds.includes(internal.id)) return undefined;
    return { kind: "note", href: "#note-" + encodeURIComponent(internal.id) + (internal.blockId ? "/block-" + encodeURIComponent(internal.blockId) : ""), id: internal.id, ...(internal.blockId ? { blockId: internal.blockId } : {}) };
  }
  if (/^#[A-Za-z0-9_%.-]+$/.test(source)) return { kind: "anchor", href: source };
  const external = externalHttpsUrl(source);
  return external ? { kind: "external", href: external } : undefined;
}

export function publicMarkdownImageUrl(source: string, share: PublicMarkdownShare): string | undefined {
  return publicMarkdownAssetUrl(source, share) || (share.chatShareId ? externalHttpsUrl(source) : undefined);
}
