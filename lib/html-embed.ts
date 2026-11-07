import { htmlPreviewDocument } from "./file-editor-preview";

export const HTML_EMBED_LANGUAGE = "html-preview";
export const HTML_EMBED_MAX_LENGTH = 100_000;
export const HTML_EMBED_MIN_HEIGHT = 96;
export const HTML_EMBED_MAX_HEIGHT = 1_200;
export const HTML_EMBED_THEME_KEYS = ["background", "foreground", "muted", "muted-foreground", "border", "primary", "primary-foreground"] as const;
export type HtmlEmbedTheme = Partial<Record<typeof HTML_EMBED_THEME_KEYS[number], string>>;

export function isHtmlEmbedLanguage(language?: string) {
  return language?.toLowerCase() === HTML_EMBED_LANGUAGE;
}

export function htmlEmbedHeight(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(HTML_EMBED_MAX_HEIGHT, Math.max(HTML_EMBED_MIN_HEIGHT, Math.ceil(value)))
    : undefined;
}

/** Same opaque-origin sandbox as file previews, with offline assets and a size-only bridge. */
export function htmlEmbedDocument(source: string, id: string, theme: HtmlEmbedTheme = {}) {
  const variables = HTML_EMBED_THEME_KEYS.flatMap(key => {
    const value = theme[key];
    return value && !/[<>{};"\\]/.test(value) ? ["--" + key + ":" + value] : [];
  }).join(";");
  const style = "<style>:root{color-scheme:light dark;" + variables + "}*{box-sizing:border-box}html{background:transparent}body{margin:0;display:flow-root;background:var(--background,Canvas);color:var(--foreground,CanvasText);font:14px/1.5 ui-sans-serif,system-ui,sans-serif;overflow-wrap:anywhere}img,video,svg,canvas{max-width:100%}button,input,select,textarea{font:inherit}button{cursor:pointer}:focus-visible{outline:2px solid var(--primary,Highlight);outline-offset:3px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}</style>";
  const bridge = "<script>(()=>{const id=" + JSON.stringify(id).replace(/</g, "\\u003c") + ";let last=0,scheduled=false;const send=(type,extra={})=>parent.postMessage({type,id,...extra},\"*\");const measure=()=>{scheduled=false;const body=document.body;if(!body)return;const height=Math.ceil(Math.max(body.scrollHeight,body.getBoundingClientRect().height));if(height!==last){last=height;send(\"metis-html-size\",{height})}};const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(measure)}};addEventListener(\"DOMContentLoaded\",()=>{new ResizeObserver(schedule).observe(document.body);schedule();document.fonts?.ready.then(schedule)});addEventListener(\"load\",schedule);addEventListener(\"resize\",schedule);addEventListener(\"error\",()=>send(\"metis-html-error\"));addEventListener(\"unhandledrejection\",()=>send(\"metis-html-error\"));})();</script>";
  return htmlPreviewDocument(style + bridge + source, { allowRemoteAssets: false });
}

export const HTML_EMBED_PROMPT = "- Embedded HTML: when a personal layout or small interactive widget makes an answer more useful, you may include a fenced html-preview block containing self-contained HTML, inline CSS and optional inline JavaScript. It renders directly inside the chat; no file, tool call, hosting or Plan/Canvas is required. Use it selectively, match the user's language and request, and keep simple answers as prose.\n- HTML preview contract: use exactly ```html-preview for a rendered widget. Ordinary ```html remains a code example. Fragments and complete HTML documents are supported, up to 100,000 characters. The preview runs after the response finishes, fits the chat width and adjusts its height; make layouts responsive with no fixed viewport width. Use semantic controls, visible labels and reduced-motion-friendly effects. Theme variables are available as var(--background), var(--foreground), var(--muted), var(--muted-foreground), var(--border), var(--primary) and var(--primary-foreground); these are complete CSS colors.\n- HTML previews are local, isolated and offline: no parent/app DOM, cookies, storage, Metis tools/APIs, network requests, external scripts/fonts/images, form submission, popups or top-level navigation. Use inline SVG, data images and local widget state. Widget input does not send a chat message, save an account setting or perform a real action. Keep any real action in the normal authorized tool workflow. Never build credential prompts or imply a local button performed an external action. Prefer the existing chart/graph/Mermaid formats for those tasks.\nExample:\n```html-preview\n<section style=\"padding:16px;border:1px solid var(--border);border-radius:12px\"><h3 style=\"margin:0 0 8px\">A small step for today</h3><button onclick=\"this.textContent='Completed';this.disabled=true\">Mark as complete</button></section>\n```";
