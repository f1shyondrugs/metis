/** Shared browser/server classification. Active documents are shown as source, never executed. */
export function mimeTypeFromFileName(name: string): string {
  const ext = name.split(/[?#]/)[0].split(".").pop()?.toLowerCase() || "";
  return ({
    png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",avif:"image/avif",svg:"image/svg+xml",
    mp4:"video/mp4",webm:"video/webm",mov:"video/quicktime",ogv:"video/ogg",mp3:"audio/mpeg",wav:"audio/wav",ogg:"audio/ogg",m4a:"audio/mp4",flac:"audio/flac",
    pdf:"application/pdf",json:"application/json",xml:"application/xml",yaml:"text/yaml",yml:"text/yaml",md:"text/markdown",markdown:"text/markdown",csv:"text/csv",html:"text/html",
    js:"text/javascript",ts:"text/typescript",py:"text/x-python",
    docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation"
  } as Record<string,string>)[ext] || (/^(txt|log|toml|ini|sql|css|jsx|tsx|go|rs|java|c|cpp|h|sh|srt|vtt)$/.test(ext) ? "text/plain" : "application/octet-stream");
}
export function effectiveFileMime(mimeType: string, name: string) {
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  return !mime || mime === "application/octet-stream" ? mimeTypeFromFileName(name) : mime;
}
export function isTextAttachment(mime: string, name: string) {
  return effectiveFileMime(mime,name).startsWith("text/") || /json|xml|javascript|yaml|toml/.test(mime) ||
    /\.(json|xml|ya?ml|toml|txt|log|md|markdown|csv|html?|css|js|jsx|ts|tsx|py|go|rs|java|c|cpp|h|sh|sql|ini|srt|vtt)$/i.test(name);
}
export function isOfficeAttachment(mime: string, name: string) {
  return /wordprocessingml|spreadsheetml|presentationml|msword|ms-excel|ms-powerpoint/.test(mime) || /\.(docx?|xlsx?|pptx?)$/i.test(name);
}
export function fileViewKind(mime: string, name: string) {
  mime = effectiveFileMime(mime,name);
  if (isTextAttachment(mime,name)) return "text";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (isOfficeAttachment(mime,name)) return "office";
  return "binary";
}
export function isFileUrl(url: string) {
  return /^\/api\/(?:file-uploads\/[a-f0-9-]+\/file|uploads\/[^\s]+|share\/attachment\?[^\s]+|shared-notes\/[A-Za-z0-9_-]{43}\/assets\?[^\s]+|notes\/[^/]+\/attachments\/[^\s]+)$/.test(url);
}
/** Keep authenticated file downloads on the existing attachment endpoints. */
export function fileDownloadUrl(url: string) {
  if (!isFileUrl(url.split("#")[0])) return url;
  const parsed = new URL(url, "http://localhost");
  parsed.searchParams.set("download", "1");
  return parsed.pathname + parsed.search + parsed.hash;
}
export type FileEmbedSpec = { url: string; name: string; mimeType: string; size?: number; text?: string; width?: number; height?: number };
export function parseFileEmbed(source: string): FileEmbedSpec | null {
  try {
    const data = JSON.parse(source);
    if (!data || typeof data.url !== "string" || !isFileUrl(data.url) || typeof data.name !== "string" || typeof data.mimeType !== "string") return null;
    return { url:data.url, name:data.name.slice(0,1000), mimeType:data.mimeType, ...(typeof data.size === "number" ? {size:data.size}:{}),
      ...(typeof data.text === "string" ? {text:data.text.slice(0,80_000)}:{}),
      ...(typeof data.width === "number" ? {width:Math.max(160,Math.min(1600,data.width))}:{}),
      ...(typeof data.height === "number" ? {height:Math.max(120,Math.min(1200,data.height))}:{}) };
  } catch { return null; }
}
export function fileEmbedMarkdown(spec: FileEmbedSpec) { return "\`\`\`file\n" + JSON.stringify(spec) + "\n\`\`\`"; }
/** Upgrade standalone legacy attachment links for editable previews; leave code examples alone. */
export function embedFileLinks(content: string) {
  let fence = "";
  return content.split("\n").map(line => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if(marker) { if(!fence)fence=marker;else if(marker[0]===fence[0] && marker.length>=fence.length)fence=""; return line; }
    if(fence)return line;
    const match = /^\s*!?\[([^\]]*)\]\((\/api\/[^\s)]+)\)\s*$/.exec(line);
    if(!match || !isFileUrl(match[2]))return line;
    return fileEmbedMarkdown({name:match[1] || "File",url:match[2],mimeType:mimeTypeFromFileName(match[1])});
  }).join("\n");
}
