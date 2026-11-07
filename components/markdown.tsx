"use client";

import {
  memo,
  createElement,
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import hljs from "highlight.js/lib/common";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import { parseWorkspaceFileLink } from "@/lib/workspace-file-link";
import { internalLinkNavigation, parseInternalLink } from "@/lib/internal-link";
import { parseReferenceLink } from "@/lib/reference-link";
import { MarkdownSpan } from "@/components/markdown-span";
import { remarkChatIcons } from "@/lib/markdown-icons";
import { markdownSourceTitle } from "@/lib/markdown-source-title";
import { FileEmbed } from "@/components/file-embed";
import { NotesRichBlockPreview } from "@/components/notes/rich-block-preview";
import { collectNotesMarkdownHeadings, type NotesHeading } from "@/lib/notes-editor-headings";
import { FileLink } from "@/components/file-link";
import { PublicMarkdownLink } from "@/components/public-markdown-link";
import { usePublicMarkdownShare } from "@/components/public-markdown-context";
import { publicMarkdownAssetUrl, publicMarkdownImageUrl, publicMarkdownLinkTarget, type PublicMarkdownShare } from "@/lib/public-markdown";
import { parseFileEmbed, isFileUrl, mimeTypeFromFileName } from "@/lib/file-types";
import { normalizeMath, splitStreamingMath } from "@/lib/math";
import { protectMathTablePipes, remarkMathTablePipes } from "@/lib/markdown-math-tables";
import { LinkPreview } from "@/components/link-preview";
import { ThinkingBlock } from "@/components/thinking-block";
import { GraphBoard } from "@/components/graph-board";
import rehypeStreamingText from "@/lib/rehype-streaming-text";
import { StreamingText } from "@/components/streaming-text";
import { appendStreamingArrival, initialStreamingArrival } from "@/lib/streaming-text";
import type { PluggableList } from "unified";
import { ChartBoard } from "@/components/chart-board";
import { HtmlEmbed } from "@/components/html-embed";
import { isHtmlEmbedLanguage } from "@/lib/html-embed";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { isChartSource } from "@/lib/chart-spec";
import { isGraphSource } from "@/lib/graph-spec";
import { isMermaidSource, wrapBareMermaid } from "@/lib/mermaid";
import { ExternalLink, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { STREAMING_RENDER_INTERVAL_MS, shouldFlushStreamingRender } from "@/lib/streaming-render";

export { normalizeMath, splitStreamingMath } from "@/lib/math";

function MarkdownLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const fileLocation = parseWorkspaceFileLink(href);
  const isWebUrl = Boolean(href && /^https?:\/\//i.test(href));
  const [hovered, setHovered] = useState(false);
  const [modifierHeld, setModifierHeld] = useState(false);
  useEffect(() => {
    if (!hovered) return;
    const updateModifier = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") setModifierHeld(true);
    };
    const clearModifier = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") setModifierHeld(false);
    };
    window.addEventListener("keydown", updateModifier);
    window.addEventListener("keyup", clearModifier);
    return () => {
      window.removeEventListener("keydown", updateModifier);
      window.removeEventListener("keyup", clearModifier);
    };
  }, [hovered]);
  if (fileLocation || (href && isFileUrl(href))) return <FileLink {...props} href={href}>{children}</FileLink>;
  const isSubagentUrl = Boolean(href && /^subagent:\/\//i.test(href));
  const internalTarget = parseInternalLink(href);
  const navigation = internalTarget ? internalLinkNavigation(internalTarget) : null;
  const sourceTitle = markdownSourceTitle(children);
  const link = (
    <a
      {...props}
      href={navigation?.href || href}
      data-source-citation={sourceTitle ? "" : undefined}
      className={cn(
        props.className,
        sourceTitle && "inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/60 px-1.5 py-0.5 text-[11px] font-medium no-underline hover:bg-secondary",
      )}
      title={props.title}
      onClick={(event) => {
        const reference=parseReferenceLink(href);
        if(reference){event.preventDefault();event.stopPropagation();window.dispatchEvent(new CustomEvent("ai-chat:open-reference",{detail:reference}));return;}
        if (navigation) {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(new CustomEvent(navigation.event, { detail: navigation.detail }));
          return;
        }
        if (isSubagentUrl && href) {
          event.preventDefault();
          window.dispatchEvent(
            new CustomEvent("ai-chat:open-subagent", {
              detail: href.slice("subagent://".length),
            }),
          );
          return;
        }
        if (!isWebUrl || !href) return;
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("ai-chat:open-browser", { detail: href }));
      }}
      onMouseEnter={(event) => {
        setHovered(true);
        setModifierHeld(event.ctrlKey || event.metaKey);
        props.onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        setModifierHeld(false);
        props.onMouseLeave?.(event);
      }}
    >
      {sourceTitle ? (
        <>
          <Link2 className="size-3 shrink-0" aria-hidden="true" />
          {sourceTitle}
        </>
      ) : children}
      {isWebUrl && hovered && modifierHeld ? (
        <ExternalLink className="ml-1 inline size-3.5 animate-in fade-in text-muted-foreground" aria-label="Ctrl-click opens in a new tab" />
      ) : null}
    </a>
  );
  return (isWebUrl || internalTarget) && href ? <LinkPreview href={href}>{link}</LinkPreview> : link;
}

const markdownComponents = {
  a: MarkdownLink,
  span: MarkdownSpan,
};

export interface ThinkingSegment {
  kind: "text" | "thinking";
  text: string;
  complete?: boolean;
}

export function splitThinkingBlocks(content: string): ThinkingSegment[] {
  const tagPattern = /<\/?thinking\s*>/gi;
  const segments: ThinkingSegment[] = [];
  let cursor = 0;
  let mode: ThinkingSegment["kind"] = "text";
  let thinkingStart = -1;

  for (const match of content.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    const tag = match[0];
    const isClosing = tag.startsWith("</");

    if (mode === "text" && !isClosing) {
      if (index > cursor) segments.push({ kind: "text", text: content.slice(cursor, index) });
      mode = "thinking";
      thinkingStart = index + tag.length;
      cursor = thinkingStart;
    } else if (mode === "thinking" && isClosing) {
      if (index > thinkingStart) {
        segments.push({ kind: "thinking", text: content.slice(thinkingStart, index), complete: true });
      }
      mode = "text";
      cursor = index + tag.length;
    }
  }

  if (mode === "thinking") {
    segments.push({ kind: "thinking", text: content.slice(thinkingStart), complete: false });
  } else if (cursor < content.length || segments.length === 0) {
    segments.push({ kind: "text", text: content.slice(cursor) });
  }

  return segments.filter((segment) => segment.text.length > 0 || segment.kind === "thinking");
}

function transformMarkdownUrl(url: string) {
  if (parseWorkspaceFileLink(url)) return url;
  if (parseReferenceLink(url) || parseInternalLink(url) || /^subagent:\/\//i.test(url)) return url;
  return defaultUrlTransform(url);
}

function CodeBlock({
  className,
  children,
  inline,
  editableFiles,
  streaming,
  notesHeadings,
  publicShare,
  node,
  ...props
}: HTMLAttributes<HTMLElement> & { inline?: boolean; editableFiles?: boolean; streaming?: boolean; notesHeadings?:NotesHeading[]; publicShare?: PublicMarkdownShare; node?:{position?:{start?:{offset?:number}}} }) {
  const code = String(children).replace(/\n$/, "");
  const isInline = inline ?? (!className && !code.includes("\n"));
  const fileRoot = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  if (isInline) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
  const declaredLanguage = className?.match(/language-([\w-]+)/)?.[1];
  if (isHtmlEmbedLanguage(declaredLanguage)) return <HtmlEmbed source={code} streaming={streaming} />;
  if (declaredLanguage === "metis-block") return <NotesRichBlockPreview source={code} headings={notesHeadings} sourceOffset={node?.position?.start?.offset} publicShare={publicShare} />;
  const file = declaredLanguage === "file" ? parseFileEmbed(code) : null;
  if (file && publicShare) {
    const url = publicMarkdownAssetUrl(file.url, publicShare);
    return url ? <FileEmbed file={{...file, url}} resizable={false} className="my-2 min-h-40 rounded border border-border/40" /> : <span>{file.name} (file unavailable)</span>;
  }
  if (file && !editableFiles) return <FileLink href={file.url} file={file}>{file.name}</FileLink>;
  if (file) return <div ref={fileRoot} data-editor-control="file" onPointerDown={e=>e.stopPropagation()}>
    <FileEmbed file={file} className="my-2 min-h-40 rounded border border-border/40"
      onChange={editableFiles ? next => { fileRoot.current?.dispatchEvent(new CustomEvent("metis:markdown-embed-change", {bubbles:true,detail:{kind:"file",source:JSON.stringify(next)}})); } : undefined}
      onRemove={editableFiles ? () => { fileRoot.current?.dispatchEvent(new CustomEvent("metis:markdown-embed-change",{bubbles:true,detail:{kind:"file",source:""}})); } : undefined}/>
  </div>;
  if (isChartSource(declaredLanguage, code)) {
    return <ChartBoard code={code} language={declaredLanguage} readOnly={Boolean(publicShare)} />;
  }
  if (isGraphSource(declaredLanguage, code)) {
    return <GraphBoard code={code} language={declaredLanguage} readOnly={Boolean(publicShare)} />;
  }
  if (isMermaidSource(declaredLanguage, code)) {
    return <MermaidDiagram code={code} language={declaredLanguage} publicShare={Boolean(publicShare)} />;
  }
  const detectedLanguage =
    declaredLanguage && hljs.getLanguage(declaredLanguage)
      ? declaredLanguage
      : hljs.highlightAuto(code).language;
  const highlighted = detectedLanguage
    ? hljs.highlight(code, { language: detectedLanguage }).value
    : hljs.highlightAuto(code).value;
  return (
    <div className="markdown-code-container group">
      <pre className="markdown-code-block" {...props}>
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-sans uppercase tracking-wide text-muted-foreground/70">
          <span>{detectedLanguage || "text"}</span>
        </div>
        <code
          className={className}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
      <div className="markdown-code-toolbar">
        <button
          type="button"
          aria-label={copied ? "Code copied" : "Copy code"}
          className="pointer-events-auto rounded border border-border/50 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground opacity-100 transition-opacity hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function TaskCheckbox({
  interactive,
  checked,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { interactive?: boolean }) {
  const [value, setValue] = useState(Boolean(checked));
  useEffect(() => {
    setValue(Boolean(checked));
  }, [checked]);
  return (
    <input
      {...props}
      type="checkbox"
      checked={value}
      disabled={!interactive}
      contentEditable={false}
      onPointerDown={(event) => {
        event.stopPropagation();
        props.onPointerDown?.(event);
      }}
      onChange={(event) => {
        setValue(event.currentTarget.checked);

      }}
    />
  );
}

function MarkdownHeading({ level, headings, node, children, ...props }: HTMLAttributes<HTMLHeadingElement> & {level:number;headings:NotesHeading[];node?:{position?:{start?:{offset?:number}}}}) {
  const id = headings.find((heading) => heading.path === undefined && heading.sourceOffset === node?.position?.start?.offset)?.id;
  return createElement("h" + level,{...props,id},children);
}

export const Markdown = memo(function Markdown({
  content,
  streaming = false,
  interactiveTasks = false,
  thinkingDurationMs,
  editableFiles = false,
  publicShare: suppliedShare,
  animateText = streaming,
  initialBornAt,
}: {
  content: string;
  streaming?: boolean;
  interactiveTasks?: boolean;
  thinkingDurationMs?: number;
  editableFiles?: boolean;
  publicShare?: PublicMarkdownShare;
  animateText?: boolean;
  initialBornAt?: number;
}) {
  const inheritedShare = usePublicMarkdownShare();
  const publicShare = inheritedShare || suppliedShare;
  const { ready, pending } = streaming ? splitStreamingMath(content) : { ready: normalizeMath(content), pending: "" };
  const protectedMath = useMemo(() => protectMathTablePipes(wrapBareMermaid(ready)), [ready]);
  const source = protectedMath.source;
  const noteHeadings = useMemo(() => source.includes("tableOfContents") && source.includes("metis-block") ? collectNotesMarkdownHeadings(source) : [], [source]);
  const markdownComponentsWithCode = useMemo(() => ({
    ...markdownComponents,
    ...(publicShare ? { a: ({href, children, title, className}: AnchorHTMLAttributes<HTMLAnchorElement>) => <PublicMarkdownLink href={href || ""} share={publicShare} title={title} className={className}>{children}</PublicMarkdownLink> } : {}),
    pre: ({ children }: HTMLAttributes<HTMLPreElement>) => <>{children}</>,
    code: (props: HTMLAttributes<HTMLElement>) => <CodeBlock {...props} editableFiles={editableFiles && !publicShare} streaming={streaming} notesHeadings={noteHeadings} publicShare={publicShare}/>,
    h1: (props: HTMLAttributes<HTMLHeadingElement>) => <MarkdownHeading {...props} level={1} headings={noteHeadings}/>,
    h2: (props: HTMLAttributes<HTMLHeadingElement>) => <MarkdownHeading {...props} level={2} headings={noteHeadings}/>,
    h3: (props: HTMLAttributes<HTMLHeadingElement>) => <MarkdownHeading {...props} level={3} headings={noteHeadings}/>,
    h4: (props: HTMLAttributes<HTMLHeadingElement>) => <MarkdownHeading {...props} level={4} headings={noteHeadings}/>,
    h5: (props: HTMLAttributes<HTMLHeadingElement>) => <MarkdownHeading {...props} level={5} headings={noteHeadings}/>,
    h6: (props: HTMLAttributes<HTMLHeadingElement>) => <MarkdownHeading {...props} level={6} headings={noteHeadings}/>,
    img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
      if (publicShare) {
        const src = typeof props.src === "string" ? publicMarkdownImageUrl(props.src, publicShare) : undefined;
        return src ? <img src={src} alt={props.alt || "Image"} title={props.title} loading="lazy" referrerPolicy="no-referrer" /> : <span>{props.alt || "Image unavailable"}</span>;
      }
      return typeof props.src === "string" && isFileUrl(props.src) ? <FileEmbed file={{url:props.src,name:props.alt || "Image",mimeType:mimeTypeFromFileName(props.alt || "image.png")}} className="my-2 max-h-96"/> : <img {...props} alt={props.alt || "Image"}/>;
    },
    p: ({children}: HTMLAttributes<HTMLParagraphElement>) => Children.toArray(children).some(child => isValidElement<{href?:string;src?:string}>(child) && isFileUrl(child.props.src || "")) ? <div className="my-2">{children}</div> : <p>{children}</p>,
    table: (props: HTMLAttributes<HTMLTableElement>) => <div className="max-w-full overflow-x-auto"><table {...props}/></div>,
    input: (props: InputHTMLAttributes<HTMLInputElement>) => (
      <TaskCheckbox {...props} interactive={interactiveTasks && !publicShare} />
    ),
  }), [editableFiles, interactiveTasks, noteHeadings, publicShare, streaming]);
  const [arrivalState, setArrivalState] = useState(() => initialStreamingArrival(source, Date.now(), initialBornAt));
  const arrival = appendStreamingArrival(arrivalState, source, Date.now());
  if (arrival !== arrivalState) setArrivalState(arrival);
  const [pendingState, setPendingState] = useState(() => initialStreamingArrival(pending, Date.now(), initialBornAt));
  const pendingArrival = appendStreamingArrival(pendingState, pending, Date.now());
  if (pendingArrival !== pendingState) setPendingState(pendingArrival);
  const rehypePlugins: PluggableList = [[rehypeKatex, { throwOnError: false, strict: "ignore" }]];
  if (animateText) rehypePlugins.push([rehypeStreamingText, { from: arrival.from, born: arrival.born, source }]);
  const thinkingSegments = splitThinkingBlocks(content);
  if (thinkingSegments.some((segment) => segment.kind === "thinking")) {
    return (
      <div className="markdown-body">
        {thinkingSegments.map((segment, index) =>
          segment.kind === "thinking" ? (
            <ThinkingBlock
              key={`thinking-${index}`}
              text={segment.text}
              done={Boolean(segment.complete)}
              durationMs={thinkingDurationMs}
            />
          ) : segment.text ? (
            <Markdown
              key={`text-${index}`}
              content={segment.text}
              streaming={streaming}
              animateText={animateText}
              initialBornAt={initialBornAt}
              interactiveTasks={interactiveTasks}
              editableFiles={editableFiles}
              publicShare={publicShare}
              thinkingDurationMs={thinkingDurationMs}
            />
          ) : null,
        )}
      </div>
    );
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, [remarkMathTablePipes, {marker:protectedMath.marker}], remarkChatIcons]}
        rehypePlugins={rehypePlugins}
        urlTransform={publicShare ? (url, key) => (key === "src" ? publicMarkdownImageUrl(url, publicShare) : publicMarkdownLinkTarget(url, publicShare) ? url : undefined) || "" : transformMarkdownUrl}
        components={markdownComponentsWithCode}
      >
        {source}
      </ReactMarkdown>
      {pending ? <span className="whitespace-pre-wrap text-muted-foreground/80">
        <StreamingText text={pending} initialFrom={pendingArrival.from} born={pendingArrival.born}/>
      </span> : null}
    </div>
  );
});

export const StreamingMarkdown = memo(function StreamingMarkdown({
  content,
  thinkingDurationMs,
  streaming = true,
  initialBornAt,
}: {
  content: string;
  thinkingDurationMs?: number;
  streaming?: boolean;
  initialBornAt?: number;
}) {
  const [shown, setShown] = useState(content);
  const latestRef = useRef(content);
  const shownRef = useRef(shown);
  const timerRef = useRef<number | null>(null);
  latestRef.current = content;
  shownRef.current = shown;

  useEffect(() => {
    const next = latestRef.current;
    const current = shownRef.current;
    if (next === current) return;
    if (!streaming || shouldFlushStreamingRender(current, next)) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setShown(next);
      return;
    }
    if (timerRef.current != null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setShown(latestRef.current);
    }, STREAMING_RENDER_INTERVAL_MS);
  }, [content, streaming]);

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  return <Markdown content={streaming ? shown : content} streaming={streaming} animateText initialBornAt={initialBornAt} thinkingDurationMs={thinkingDurationMs} />;
});
