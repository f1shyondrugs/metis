"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  HTML_EMBED_MAX_LENGTH, HTML_EMBED_THEME_KEYS, htmlEmbedDocument, htmlEmbedHeight,
  type HtmlEmbedTheme,
} from "@/lib/html-embed";

export function HtmlEmbed({ source, streaming = false }: { source: string; streaming?: boolean }) {
  const id = useId();
  const frame = useRef<HTMLIFrameElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<HtmlEmbedTheme>({});
  const [height, setHeight] = useState(240);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const empty = !source.trim();
  const oversized = source.length > HTML_EMBED_MAX_LENGTH;
  const document = useMemo(() => streaming || empty || oversized ? "" : htmlEmbedDocument(source, id, theme), [streaming, empty, oversized, source, id, theme]);

  useEffect(() => {
    setHeight(240);
    setLoaded(false);
    setFailed(false);
  }, [source, streaming]);

  useEffect(() => {
    const readTheme = () => {
      const style = getComputedStyle(root.current || window.document.documentElement);
      const next = Object.fromEntries(HTML_EMBED_THEME_KEYS.map(key => [key, style.getPropertyValue("--" + key).trim()])) as HtmlEmbedTheme;
      setTheme(current => HTML_EMBED_THEME_KEYS.every(key => current[key] === next[key]) ? current : next);
    };
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(window.document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow || event.origin !== "null") return;
      const message = event.data;
      if (!message || typeof message !== "object" || message.id !== id) return;
      if (message.type === "metis-html-size") {
        const next = htmlEmbedHeight(message.height);
        if (next !== undefined) setHeight(next);
      } else if (message.type === "metis-html-error") setFailed(true);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [id]);

  return <div ref={root} className="not-prose my-3 min-w-0 max-w-full" data-editor-control="html-preview" data-html-embed="" contentEditable={false}>
    {streaming ? <div role="status" className="rounded-lg border border-border/60 px-4 py-6 text-sm text-muted-foreground">Preparing interactive content…</div>
      : empty ? <p className="text-sm text-muted-foreground">No HTML to preview.</p>
      : oversized ? <p role="alert" className="text-sm text-destructive">This HTML preview exceeds the 100,000-character limit.</p>
      : <>
        {!loaded ? <p role="status" className="mb-2 text-xs text-muted-foreground">Loading interactive content…</p> : null}
        <iframe ref={frame} title="Interactive HTML response" sandbox="allow-scripts" referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
          srcDoc={document} onLoad={() => setLoaded(true)} onError={() => { setLoaded(true); setFailed(true); }}
          className="block w-full min-w-0 rounded-lg border border-border/60 bg-background" style={{ height }} />
        {failed ? <p role="alert" className="mt-2 text-xs text-destructive">Part of this interactive response could not run. You can inspect its HTML below.</p> : null}
      </>}
    {!streaming && !empty ? <details className="mt-2 text-xs text-muted-foreground">
      <summary className="w-fit cursor-pointer rounded px-1 py-1 focus-visible:outline-2 focus-visible:outline-ring">View HTML</summary>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre rounded-lg border border-border/60 p-3 text-xs"><code>{source}</code></pre>
    </details> : null}
  </div>;
}
