import type { FileEmbedSpec } from "@/lib/file-types";
import type { UploadedFile } from "@/lib/upload-limits";
import { parseGraphDocument } from "@/lib/graph-spec";
import { parseChartDocument } from "@/lib/chart-spec";
import { assertOverlayJson, normalizeDesktopOverlay } from "./mcp-core/desktop-overlay.mjs";

/** Coordinates are device-independent pixels relative to the explicit monitor. */
export type OverlayItem = {
  id: string;
  type: "rect" | "ellipse" | "line" | "arrow" | "path" | "highlight" | "text" | "spotlight" | "card";
  group?: string;
  x: number; y: number; width: number; height: number;
  color?: string; fill?: string; opacity?: number; strokeWidth?: number; radius?: number;
  text?: string; fontSize?: number;
  points?: { x: number; y: number }[];
  doubleArrow?: boolean;
  holes?: { x: number; y: number; width: number; height: number; shape: "rect" | "ellipse"; radius?: number }[];
  content?: { kind: "markdown" | "html" | "graph" | "chart" | "file"; source?: string; spec?: unknown; file?: FileEmbedSpec; imageFit?: "contain" | "cover"; imagePosition?: {x:number;y:number} };
  /** Omitted persists; 0..3600000 milliseconds. */
  ttlMs?: number;
};
export type OverlayState = {
  revision: number;
  items: OverlayItem[];
  display: { id: string; width: number; height: number };
  appearance?: unknown;
  interactiveId: string | null;
};
export type DesktopOverlayOperation = "status" | "add" | "replace" | "update" | "remove" | "clear" | "undo" | "interact";
/** Agent input deliberately differs from hydrated web/native FileEmbedSpec. */
export type OverlayInputItem = Omit<OverlayItem, "content"> & {
  content?: Omit<NonNullable<OverlayItem["content"]>, "file"> & { file?: { id: string } };
};
export type DesktopOverlayCommand = {
  operation: DesktopOverlayOperation;
  display_id?: string;
  items?: OverlayInputItem[];
  ids?: string[];
  group?: string;
  all?: boolean;
  interactive_id?: string | null;
};

/** Resolve only exact owner-upload IDs, never caller URLs, paths, credentials or export tokens.
 * The resolver is the existing getCompletedUpload(ownerId,id) API at the server boundary.
 */
export function hydrateDesktopOverlay(
  input: unknown,
  ownerId: string,
  resolveUpload: (ownerId: string, id: string) => UploadedFile & {overlayUrl?: string},
): Record<string, unknown> {
  if (!ownerId) throw new Error("desktop_overlay requires an authenticated account");
  const command = normalizeDesktopOverlay(input) as DesktopOverlayCommand;
  const items = command.items?.map((item) => {
    const content = item.content;
    if (!content) return item;
    if (content.kind === "file") {
      const id = content.file!.id;
      const upload = resolveUpload(ownerId, id);
      if (upload.id !== id) throw new Error("desktop_overlay: upload metadata ID mismatch");
      const file: FileEmbedSpec = {
        url: upload.overlayUrl || "/api/file-uploads/" + encodeURIComponent(id) + "/file",
        name: upload.name, mimeType: upload.mimeType, size: upload.size,
      };
      if (!/^\/api\/(?:file-uploads\/[a-zA-Z0-9_-]+\/file|uploads\/[a-zA-Z0-9_-]+\/[^/?#]+)$/.test(file.url)) throw new Error("Invalid resolved overlay attachment URL");
      return { ...item, content: { kind: "file", file, ...(content.imageFit ? {imageFit:content.imageFit}:{}), ...(content.imagePosition ? {imagePosition:content.imagePosition}:{}) } };
    }
    if (content.kind === "graph" || content.kind === "chart") {
      const source = content.source ?? JSON.stringify(content.spec);
      const spec = content.kind === "graph" ? parseGraphDocument(source) : parseChartDocument(source);
      return { ...item, content: { kind: content.kind, spec: JSON.parse(JSON.stringify(spec)) } };
    }
    // HTML remains source for the existing opaque/offline HTML renderer. Never execute it here.
    return item;
  });
  const hydrated = { ...command, ...(items ? { items } : {}) };
  assertOverlayJson(hydrated);
  return hydrated;
}
