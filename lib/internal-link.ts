/** Internal document links. Content access is checked by the preview API. */
export type InternalLinkKind = "plan" | "canvas" | "note" | "automation" | "issue";
export type InternalLinkTarget = { kind: InternalLinkKind; id: string; blockId?: string };
export type InternalLinkPreview = InternalLinkTarget & {
  icon?: string | null;
  title: string;
  description: string;
  details: Array<{ label: string; value: string }>;
};

export function parseInternalLink(href: string | undefined): InternalLinkTarget | null {
  if (!href) return null;
  const workspace = /^(?:workspace|metis):\/\/(plan|canvas|note|automation|issue)\/([^/?#]+)(?:[?#].*)?$/i.exec(href);
  const item = /^(note|automation|issue):\/\/([^/?#]+)(?:[?#].*)?$/i.exec(href);
  const match = workspace || item;
  if (!match) return null;
  let id: string;
  try { id = decodeURIComponent(match[2]); } catch { return null; }
  if (!id.trim() || /[\u0000-\u001f\u007f/\\]/.test(id)) return null;
  const kind = match[1].toLowerCase() as InternalLinkKind;
  const anchor = kind === "note" ? /#block-([A-Za-z0-9_-]+)$/.exec(href) : null;
  return { kind, id, ...(anchor ? { blockId: anchor[1] } : {}) };
}

export function internalLinkNavigation(target: InternalLinkTarget) {
  if (target.kind === "plan" || target.kind === "canvas") {
    return { href: `#workspace-${encodeURIComponent(target.id)}`, event: "ai-chat:open-workspace", detail: { type: target.kind, id: target.id } };
  }
  return {
    href: `#${target.kind}-${encodeURIComponent(target.id)}${target.kind === "note" && target.blockId ? "/block-" + encodeURIComponent(target.blockId) : ""}`,
    event: target.kind === "note" ? "ai-chat:open-note" : target.kind === "issue" ? "ai-chat:open-issue" : "ai-chat:open-automations",
    detail: { id: target.id, ...(target.kind === "note" && target.blockId ? { blockId: target.blockId } : {}) },
  };
}
