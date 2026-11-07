import { fileViewKind, mimeTypeFromFileName } from "@/lib/file-types";

export type FilePreviewKind = "image" | "video" | "audio" | "pdf" | "markdown" | "html" | "svg";

export function filePreviewKind(path: string): FilePreviewKind | null {
  if (/\.(md|markdown)$/i.test(path)) return "markdown";
  if (/\.html?$/i.test(path)) return "html";
  if (/\.svg$/i.test(path)) return "svg";
  const kind = fileViewKind(mimeTypeFromFileName(path), path);
  return kind === "image" || kind === "video" || kind === "audio" || kind === "pdf" ? kind : null;
}

export function isBinaryFilePreview(kind: FilePreviewKind | null) {
  return kind === "image" || kind === "video" || kind === "audio" || kind === "pdf";
}

export function workspacePreviewUrl(path: string) {
  return "/api/remote/preview?path=" + encodeURIComponent(path);
}

export function markdownPreviewAssetUrl(source: string, filePath: string) {
  if (!source || source.startsWith("#") || source.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith("/api/")) return source;
  try {
    const base = "https://workspace.invalid" + filePath.split("/").map(encodeURIComponent).join("/");
    const target = new URL(source, base);
    return workspacePreviewUrl(decodeURIComponent(target.pathname));
  } catch { return ""; }
}

/** The iframe has an opaque origin; its content cannot access the application's session or DOM. */
export function htmlPreviewDocument(content: string, options: { allowRemoteAssets?: boolean } = {}) {
  const remote = options.allowRemoteAssets === false ? "" : " https:";
  const policy = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:${remote}; media-src data: blob:${remote}; font-src data:${remote}; connect-src 'none'; form-action 'none'; base-uri 'none'`;
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' + policy + '"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' + content + '</body></html>';
}
