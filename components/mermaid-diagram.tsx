"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { useEscapeDismiss } from "@/components/use-escape-dismiss";
import { StickyActions } from "@/components/ui/sticky-actions";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Fullscreen, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fitMermaidSvg, isMermaidErrorSvg, prepareMermaidSource } from "@/lib/mermaid";
import {EmbeddedSourceControlsContext} from "@/components/embedded-source-controls";
import { publicMermaidSource, publicMermaidSvg } from "@/lib/public-mermaid";
import { MermaidViewport } from "@/components/mermaid-viewport";
import type { MarkdownSourceEditor as SourceEditorComponent } from "@/components/notes/markdown-source-editor";

const MarkdownSourceEditor = dynamic<ComponentProps<typeof SourceEditorComponent>>(
  () => import("@/components/notes/markdown-source-editor").then(module => module.MarkdownSourceEditor),
  { ssr: false, loading: () => <div role="status" className="p-3 text-xs text-muted-foreground">Opening editor…</div> },
);

export function MermaidDiagram({ code, language, publicShare = false, readOnly = false }: {
  code: string; language?: string; publicShare?: boolean; readOnly?: boolean;
}) {
  const reactId = useId().replace(/:/g, "");
  const root = useRef<HTMLDivElement>(null);
  const externalSourceControls = useContext(EmbeddedSourceControlsContext);
  const [preferredMode, setMode] = useState<"interface" | "code">("interface");
  const [fullscreen, setFullscreen] = useState(false);
  const mode = externalSourceControls && !fullscreen ? "interface" : preferredMode;
  useEffect(() => { if (externalSourceControls && !fullscreen) setMode("interface"); }, [externalSourceControls, fullscreen]);
  const [source, setSource] = useState(code);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const locked = publicShare || readOnly;
  useEffect(() => { setSource(code); }, [code]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false, securityLevel: "strict", theme: "dark", fontFamily: "inherit",
          suppressErrorRendering: true, flowchart: { useMaxWidth: true, htmlLabels: false, wrappingWidth: 280 },
        });
        const prepared = prepareMermaidSource(publicShare ? publicMermaidSource(source) : source);
        const result = await mermaid.render("mermaid-" + reactId + "-" + Math.abs(hashCode(prepared)), prepared);
        if (!cancelled) {
          if (!result.svg || isMermaidErrorSvg(result.svg)) throw new Error("This diagram could not be rendered. Switch to Code to edit it.");
          setSvg(fitMermaidSvg(publicShare ? publicMermaidSvg(result.svg) : result.svg));
        }
      } catch (cause) {
        if (!cancelled) { setSvg(""); setError(cause instanceof Error ? cause.message : "Could not render diagram."); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    const timer = setTimeout(() => void render(), 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [source, reactId, publicShare]);

  useEscapeDismiss(fullscreen, setFullscreen);
  const changeSource = (next: string) => {
    if (locked) return;
    setSource(next);
    queueMicrotask(() => root.current?.dispatchEvent(new CustomEvent("metis:markdown-embed-change", {
      bubbles: true, detail: { kind: "mermaid", source: next },
    })));
  };
  const toolbar = <StickyActions style={{ top: "var(--contained-actions-top, 0px)", right: 0 }} className="flex w-full shrink-0 items-center justify-end gap-1 border-b border-border/40 bg-background/95 p-1.5 text-xs">
    {(!externalSourceControls || fullscreen) && <><button type="button" aria-pressed={mode === "code"} className={cn("min-h-8 rounded px-2", mode === "code" ? "bg-muted" : "text-muted-foreground hover:text-foreground")} onClick={() => setMode("code")}>Code</button>
    <button type="button" aria-pressed={mode === "interface"} className={cn("min-h-8 rounded px-2", mode === "interface" ? "bg-muted" : "text-muted-foreground hover:text-foreground")} onClick={() => setMode("interface")}>Interface</button></>}
    <button type="button" className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted"
      aria-label={fullscreen ? "Exit fullscreen" : "Open flowchart fullscreen"} onClick={() => setFullscreen(current => !current)}>
      {fullscreen ? <Minimize2 className="size-4"/> : <Fullscreen className="size-4"/>}
    </button>
  </StickyActions>;
  const body = mode === "code" ? <div className="notes-block-editor shared-markdown-surface min-h-0 flex-1 overflow-auto p-3">
    <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">{language || "mermaid"}</div>
    <MarkdownSourceEditor value={source} onChange={changeSource} disabled={locked} maxLength={100_000}
      ariaLabel="Mermaid source" placeholderText="Write Mermaid…" onExceeded={() => setError("Diagram source is full. Remove some content before adding more.")}
      onFiles={async () => {}} />
  </div> : loading ? <div role="status" className="flex min-h-56 flex-1 items-center justify-center text-sm text-muted-foreground">Rendering diagram…</div>
    : error ? <div role="status" className="min-h-40 flex-1 p-4 text-sm text-muted-foreground"><p>{externalSourceControls && !fullscreen ? error.replace("Switch to Code to edit it.", "Use Edit source above to edit it.") : error}</p>{(!externalSourceControls || fullscreen) && <button type="button" className="mt-3 underline" onClick={() => setMode("code")}>Open source</button>}</div>
    : <MermaidViewport svg={svg} fullscreen={fullscreen}/>;
  const card = <div data-editor-control="mermaid" data-mermaid-source={source} contentEditable={false}
    className={cn("relative flex min-h-0 max-w-full flex-col overflow-clip rounded-lg border border-border/40 bg-background", fullscreen ? "h-full w-full" : "my-2")}>
    {toolbar}{body}
  </div>;
  if (!fullscreen) return <div ref={root} className="contents">{card}</div>;
  const overlay = <div role="dialog" aria-modal="true" aria-label="Flowchart fullscreen" className="fixed inset-0 z-[80] bg-background/80 p-2 sm:p-4">{card}</div>;
  return <div ref={root} className="contents"><div className="my-2 h-[400px] rounded-lg border border-border/40 bg-muted/10" aria-hidden="true"/>
    {typeof document !== "undefined" ? createPortal(overlay, document.body) : overlay}</div>;
}

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) { hash = (hash << 5) - hash + value.charCodeAt(index); hash |= 0; }
  return hash;
}
