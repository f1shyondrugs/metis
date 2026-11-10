"use client";

import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { FieldDictationButton, FieldDictationContext } from "@/components/field-dictation";
import { embedDictationFields, type EmbedDictationField } from "@/lib/html-embed-dictation";
import {
  HTML_EMBED_MAX_LENGTH, HTML_EMBED_THEME_KEYS, htmlEmbedDocument, htmlEmbedHeight,
  type HtmlEmbedTheme,
} from "@/lib/html-embed";

export function HtmlEmbed({ source, streaming = false }: { source: string; streaming?: boolean }) {
  const baseId = useId();
  const voice = useContext(FieldDictationContext);
  const [fieldState, setFields] = useState<{ id: string; fields: EmbedDictationField[] }>({ id: "", fields: [] });
  const frame = useRef<HTMLIFrameElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<HtmlEmbedTheme>({});
  const [height, setHeight] = useState(240);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const version = useRef({ source, streaming, theme, enabled: Boolean(voice?.enabled), chatId: voice?.chatId, number: 0 });
  if (version.current.source !== source || version.current.streaming !== streaming || version.current.theme !== theme || version.current.enabled !== Boolean(voice?.enabled) || version.current.chatId !== voice?.chatId) version.current = { source, streaming, theme, enabled: Boolean(voice?.enabled), chatId: voice?.chatId, number: version.current.number + 1 };
  const id = baseId + ":" + version.current.number;
  const loaded = loadedId === id;
  const fields = fieldState.id === id ? fieldState.fields : [];
  const empty = !source.trim();
  const oversized = source.length > HTML_EMBED_MAX_LENGTH;
  const document = useMemo(() => streaming || empty || oversized ? "" : htmlEmbedDocument(source, id, theme, Boolean(voice?.enabled)), [streaming, empty, oversized, source, id, theme, voice?.enabled]);

  useEffect(() => {
    setHeight(240);
    setFailed(false);
  }, [id]);

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
      else if (message.type === "metis-html-dictation-fields" && voice?.enabled) setFields({ id, fields: embedDictationFields(message.fields, frame.current.clientWidth, frame.current.clientHeight) });
    };
    window.addEventListener("message", receive);
    frame.current?.contentWindow?.postMessage({ type: "metis-html-dictation", id, action: "refresh" }, "*");
    return () => window.removeEventListener("message", receive);
  }, [id, voice?.enabled]);

  const sendDictation = (field: string, action: "begin" | "commit", text?: string) => frame.current?.contentWindow?.postMessage({ type: "metis-html-dictation", id, field, action, text }, "*");

  return <div ref={root} className="not-prose my-3 min-w-0 max-w-full" data-editor-control="html-preview" data-html-embed="" contentEditable={false}>
    {streaming ? <div role="status" className="rounded-lg border border-border/60 px-4 py-6 text-sm text-muted-foreground">Preparing interactive content…</div>
      : empty ? <p className="text-sm text-muted-foreground">No HTML to preview.</p>
      : oversized ? <p role="alert" className="text-sm text-destructive">This HTML preview exceeds the 100,000-character limit.</p>
      : <>
        {!loaded ? <p role="status" className="mb-2 text-xs text-muted-foreground">Loading interactive content…</p> : null}
        <div className="relative min-w-0">
        <iframe key={id} ref={frame} title="Interactive HTML response" sandbox="allow-scripts" referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
          srcDoc={document} onLoad={() => { setLoadedId(id); frame.current?.contentWindow?.postMessage({ type: "metis-html-dictation", id, action: "refresh" }, "*"); }} onError={() => { setLoadedId(id); setFailed(true); }}
          className="block w-full min-w-0 rounded-lg border border-border/60 bg-background" style={{ height }} />
        {loaded && voice?.enabled ? fields.map(field => <div key={id + field.field} className="absolute z-10" style={{ left: field.left + field.width - 44, top: field.top + 1 }}>
          <FieldDictationButton onStart={() => sendDictation(field.field, "begin")} onTranscript={text => {
            sendDictation(field.field, "commit", text);
            return finalText => sendDictation(field.field, "commit", finalText);
          }} />
        </div>) : null}
        </div>
        {failed ? <p role="alert" className="mt-2 text-xs text-destructive">Part of this interactive response could not run. You can inspect its HTML below.</p> : null}
      </>}
    {!streaming && !empty ? <details className="mt-2 text-xs text-muted-foreground">
      <summary className="w-fit cursor-pointer rounded px-1 py-1 focus-visible:outline-2 focus-visible:outline-ring">View HTML</summary>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre rounded-lg border border-border/60 p-3 text-xs"><code>{source}</code></pre>
    </details> : null}
  </div>;
}
