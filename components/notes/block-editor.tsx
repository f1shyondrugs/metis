"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useId, type ReactNode, type PointerEventHandler } from "react";
import { createPortal } from "react-dom";
import { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import { type Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Compartment, EditorState } from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ArrowDown, ArrowUp, Bold, Check, ChevronDown, ChevronRight, Code2, Copy, FileText, GripVertical, Italic, Link2, List, Paperclip, Plus, Redo2, Strikethrough, Trash2, Underline, Undo2, X } from "lucide-react";
import katex from "katex";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Markdown } from "@/components/markdown";
import { notesEditorExtensions, NotesMathBlock, NotesSourceBlock, NotesToggle, NotesInlineMath, NotesTableOfContents } from "@/lib/notes-editor-extensions";
import { parseNotesMarkdown, createNotesMarkdownSerializer, notesNodeSignature, type EditorNode } from "@/lib/notes-editor-markdown";
import { findNotesTask, notesSelectionSourceId, planNotesTaskIssueConversion, type NotesIssueContext, type NotesIssueReference } from "@/lib/notes-editor-tasks";
import { minimalMarkdownChange, replaceEmbeddedSource } from "@/lib/markdown-editor";
import { createEditorValueSync } from "@/lib/editor-value-sync";
import { createNotesEditorDropHandler } from "@/lib/notes-editor-drop";
import { cancelUpload, getUploadSnapshot, retryUpload, startUpload, subscribeUploads, type UploadTask } from "@/lib/background-uploads";
import { fileEmbedMarkdown } from "@/lib/file-types";
import { appendMarkdownAttachment, markdownAttachmentLimit, markdownAttachmentTarget, persistMarkdownAttachment } from "@/lib/markdown-editor-attachment";
import { markdownChangeFitsLimit, markdownLengthChangeFitsLimit, markdownDisplayImageExtension, markdownEditorGuard } from "@/lib/shared-markdown-editor";
import { resolveMarkdownSourceLocation } from "@/lib/markdown-source-location";
import { parseWorkspaceFileLink, type WorkspaceFileLocation } from "@/lib/workspace-file-link";
import { registerFileDrop } from "@/lib/file-drop";
import { internalLinkNavigation, parseInternalLink } from "@/lib/internal-link";
import { LinkPreview } from "@/components/link-preview";
import { useReferenceSearch } from "@/components/use-reference-search";
import { ReferencePicker } from "@/components/reference-picker";
import { composerReferenceKeyAction } from "@/lib/composer-references";
import { parseReferenceLink } from "@/lib/reference-link";
import { notesReferenceQuery, notesReferenceHref, NOTES_REFERENCE_KINDS } from "@/lib/notes-editor-references";
import type { ReferenceKind, ReferenceResult } from "@/lib/reference-search";
import { Type, Heading1, Heading2, Heading3, ListOrdered, ListTodo, Quote, Info, Minus, Table2, ImageIcon, Globe, Sigma, Columns2, ListTree, FilePlus2, CircleDot } from "lucide-react";
import { NotesContextToolbar } from "@/components/notes/context-toolbar";
import "./block-editor.css";

export type NotesBlockEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
  noteId?: string;
  workspace?: { chatId: string; id: string; type?: string; idempotencyKey?: string };
  /** Stable document identity for file buffers and other non-note editors. */
  editorId?: string;
  disabled?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  initialMode?: "blocks" | "markdown" | "source";
  sourceLocation?: WorkspaceFileLocation | null;
  resolveUrl?: (url: string, kind: "image" | "link") => string;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onFiles?: (files: File[]) => void | Promise<void>;
  hideAttachmentButton?: boolean;
  onCreateSubpage?: () => void;
  onCreateIssue?: (text: string, context?: NotesIssueContext) => Promise<NotesIssueReference | void> | void;
  onOpenNote?: (id: string, blockId?: string) => void;
};
type MenuPosition = { top: number; left: number };
type SlashMenu = MenuPosition & { from: number; to: number; query: string };
type HoverBlock = { pos: number; top: number };
type BlockCommand = { id: string; title: string; detail: string; keywords?: string; run: (editor: Editor) => void };
const paragraph = () => ({ type: "paragraph" });
const newId = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const safeUrl = (url: string) => /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(url) || Boolean(parseInternalLink(url)) || Boolean(parseReferenceLink(url)) || Boolean(parseWorkspaceFileLink(url));

function SourceBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onEmbedChange = (event: Event) => {
      if (!editor.isEditable) return;
      const detail = (event as CustomEvent<{kind?: string; source?: string}>).detail;
      const kind = detail?.kind;
      if (!detail || (kind !== "chart" && kind !== "graph" && kind !== "mermaid" && kind !== "file") || typeof detail.source !== "string") return;
      event.stopPropagation();
      updateAttributes({ source: replaceEmbeddedSource(String(node.attrs.source || ""), kind, 0, detail.source) });
    };
    root.addEventListener("metis:markdown-embed-change", onEmbedChange);
    return () => root.removeEventListener("metis:markdown-embed-change", onEmbedChange);
  }, [editor, node.attrs.source, updateAttributes]);
  return <NodeViewWrapper ref={rootRef} className={"notes-source-block" + (selected ? " is-selected" : "")} data-notes-source="">
    <div className="notes-source-header" contentEditable={false}>
      <span>{String(node.attrs.label || "Markdown source")}</span>
      <button type="button" disabled={!editor.isEditable} onClick={() => setEditing(!editing)}>{editing ? "Preview" : "Edit source"}</button>
    </div>
    {editing ? <textarea aria-label="Block Markdown source" readOnly={!editor.isEditable} value={String(node.attrs.source || "")} onChange={(event) => updateAttributes({ source: event.target.value })} rows={Math.min(18, Math.max(4, String(node.attrs.source).split("\n").length))} spellCheck={false} /> :
      <div contentEditable={false} className="notes-source-preview"><Markdown content={String(node.attrs.source || "")} editableFiles={editor.isEditable} /></div>}
  </NodeViewWrapper>;
}
function MathView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const latex = String(node.attrs.latex || "");
  const rendered = useMemo(() => katex.renderToString(latex, { throwOnError: false, displayMode: true, trust: false }), [latex]);
  return <NodeViewWrapper className={"notes-math-block" + (selected ? " is-selected" : "")} contentEditable={false}>
    <button type="button" className="notes-math-preview" aria-label="Edit equation" disabled={!editor.isEditable} onClick={() => setEditing(!editing)} dangerouslySetInnerHTML={{ __html: rendered }} />
    {editing && <label className="notes-math-input">LaTeX<input aria-label="Equation LaTeX" readOnly={!editor.isEditable} value={latex} onChange={(event) => updateAttributes({ latex: event.target.value })} /></label>}
  </NodeViewWrapper>;
}
function InlineMathView({ node, updateAttributes, editor }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const rendered = katex.renderToString(String(node.attrs.latex || ""), { throwOnError: false, trust: false });
  return <NodeViewWrapper as="span" className="notes-inline-math" contentEditable={false}>
    {editing ? <input autoFocus aria-label="Inline equation LaTeX" readOnly={!editor.isEditable} value={String(node.attrs.latex || "")} onChange={(event) => updateAttributes({ latex: event.target.value })} onBlur={() => setEditing(false)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Escape") setEditing(false); }} /> :
      <button type="button" aria-label="Edit inline equation" disabled={!editor.isEditable} onClick={() => setEditing(true)} dangerouslySetInnerHTML={{ __html: rendered }} />}
  </NodeViewWrapper>;
}
function ToggleView({ node, updateAttributes, editor }: NodeViewProps) {
  return <NodeViewWrapper className="notes-toggle-block" data-notes-toggle="">
    <div className="notes-toggle-heading" contentEditable={false}>
      <button type="button" aria-label={node.attrs.open ? "Collapse toggle" : "Expand toggle"} aria-expanded={Boolean(node.attrs.open)} disabled={!editor.isEditable} onClick={() => updateAttributes({ open: !node.attrs.open })}>{node.attrs.open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
      <input aria-label="Toggle title" readOnly={!editor.isEditable} value={String(node.attrs.title || "")} onChange={(event) => updateAttributes({ title: event.target.value })} />
    </div>
    <div hidden={!node.attrs.open}><NodeViewContent className="notes-toggle-content" /></div>
  </NodeViewWrapper>;
}

function TableOfContentsView({ editor }: NodeViewProps) {
  const [, refresh] = useState(0);
  useEffect(() => { const update = () => refresh((count) => count + 1); editor.on("transaction", update); return () => { editor.off("transaction", update); }; }, [editor]);
  const headings: {pos:number;level:number;title:string}[] = [];
  editor.state.doc.descendants((node,pos) => { if (node.type.name === "heading") headings.push({pos,level:Number(node.attrs.level),title:node.textContent || "Untitled heading"}); });
  return <NodeViewWrapper className="notes-table-of-contents" contentEditable={false}><nav aria-label="Table of contents"><strong>Table of contents</strong>{headings.length ? headings.map((heading) => <button key={heading.pos} type="button" style={{paddingLeft:(heading.level - 1) * 14}} onClick={() => editor.chain().focus().setTextSelection(heading.pos + 1).scrollIntoView().run()}>{heading.title}</button>) : <p>Add headings to build a table of contents.</p>}</nav></NodeViewWrapper>;
}
function MarkdownSourceEditor({ value, onChange, disabled, maxLength, ariaLabel, placeholderText, autoFocus, sourceLocation, onExceeded, onFiles }: {
  value: string; onChange: (value: string) => void; disabled: boolean; maxLength: number; ariaLabel: string; placeholderText?: string;
  autoFocus?: boolean; sourceLocation?: WorkspaceFileLocation | null; onExceeded: () => void; onFiles: (files: File[]) => Promise<void>;
}) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null);
  const callback = useRef(onChange), current = useRef(value), syncing = useRef(false);
  const valueSync = useRef(createEditorValueSync(value));
  const settings = useRef({ disabled, maxLength, onExceeded, onFiles }); settings.current = { disabled, maxLength, onExceeded, onFiles };
  const config = useMemo(() => new Compartment(), []), highlights = useMemo(() => new Compartment(), []);
  callback.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: current.current, extensions: [
        markdown(), history(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping,
        EditorState.lineSeparator.of(current.current.includes("\r\n") ? "\r\n" : "\n"),
        config.of([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled),
          placeholder(placeholderText || "Write Markdown…"), EditorView.contentAttributes.of({ "aria-label": ariaLabel, spellcheck: "true" })]),
        highlights.of([]),
        EditorState.changeFilter.of((transaction) => {
          if (syncing.current) return true;
          if (settings.current.disabled) return false;
          const separatorExtra = (transaction.startState.facet(EditorState.lineSeparator) || "\n").length - 1;
          const previousLength = transaction.startState.doc.length + (transaction.startState.doc.lines - 1) * separatorExtra;
          const nextLength = transaction.newDoc.length + (transaction.newDoc.lines - 1) * separatorExtra;
          if (markdownLengthChangeFitsLimit(previousLength, nextLength, settings.current.maxLength)) return true;
          settings.current.onExceeded(); return false;
        }),
        EditorView.domEventHandlers({
          paste(event) { const files = Array.from(event.clipboardData?.files || []); if (!files.length) return false; event.preventDefault(); void settings.current.onFiles(files); return true; },
          drop(event) { const files = Array.from(event.dataTransfer?.files || []); if (!files.length) return false; event.preventDefault(); void settings.current.onFiles(files); return true; },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncing.current) {
            current.current = update.state.sliceDoc();
            valueSync.current.published(current.current);
            // Synchronous by contract: parent Save/navigation must see the very last keystroke.
            callback.current(current.current);
          }
        }),
      ] }),
    });
    view.current = instance; if (autoFocus) instance.focus();
    return () => { view.current = null; instance.destroy(); };
    // Source instance owns cursor/history. Changing props is handled through compartments below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const instance = view.current; if (!instance) return;
    instance.dispatch({ effects: config.reconfigure([
      EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled), placeholder(placeholderText || "Write Markdown…"),
      EditorView.contentAttributes.of({ "aria-label": ariaLabel, spellcheck: "true" }),
    ]) });
  }, [ariaLabel, config, disabled, placeholderText]);
  useEffect(() => {
    if (!valueSync.current.receive(value)) return;
    current.current = value;
    const instance = view.current; if (!instance) return;
    const change = minimalMarkdownChange(instance.state.doc.toString(), instance.state.toText(value).toString());
    if (change) { syncing.current = true; try { instance.dispatch({ changes: change }); } finally { syncing.current = false; } }
  }, [value]);
  useEffect(() => {
    const instance = view.current; if (!instance || !sourceLocation) return;
    const location = resolveMarkdownSourceLocation(instance.state.doc.toString(), sourceLocation);
    const ranges = location.changes.filter((change) => change.to > change.from).map((change) =>
      Decoration.mark({ class: "notes-source-change notes-source-change-" + change.kind }).range(change.from, change.to));
    instance.dispatch({ selection: { anchor: location.from, head: location.to },
      effects: [highlights.reconfigure(EditorView.decorations.of(Decoration.set(ranges, true))), EditorView.scrollIntoView(location.from, { y: "center" })] });
    instance.focus();
  }, [sourceLocation, highlights]);
  return <div ref={host} className="notes-markdown-source" />;
}

function ToolButton({ label, children, active, disabled, onClick }: { label: string; children: ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick} className={active ? "is-active" : ""}>{children}</button>;
}
function topBlocks(editor: Editor) {
  const result: { node: ProseMirrorNode; pos: number }[] = [];
  editor.state.doc.forEach((node, pos) => result.push({ node, pos }));
  return result;
}
function selectedBlocks(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  return topBlocks(editor).filter(({ node, pos }) => empty ? from >= pos && from <= pos + node.nodeSize : pos < to && pos + node.nodeSize > from);
}
function moveBlocks(editor: Editor, direction: -1 | 1) {
  const all = topBlocks(editor), chosen = selectedBlocks(editor);
  if (!chosen.length) return;
  const first = all.findIndex((block) => block.pos === chosen[0].pos);
  const last = first + chosen.length - 1;
  if ((direction < 0 && first === 0) || (direction > 0 && last === all.length - 1)) return;
  const from = chosen[0].pos, to = chosen.at(-1)!.pos + chosen.at(-1)!.node.nodeSize;
  const slice = editor.state.doc.slice(from, to);
  const destination = direction < 0 ? all[first - 1].pos : all[last + 1].pos + all[last + 1].node.nodeSize;
  const tr = editor.state.tr.delete(from, to);
  const mapped = tr.mapping.map(destination);
  tr.insert(mapped, slice.content);
  tr.setSelection(TextSelection.near(tr.doc.resolve(mapped + 1))).scrollIntoView();
  editor.view.dispatch(tr);
}
export function NotesBlockEditor(props: NotesBlockEditorProps) {
  const instanceId = useId();
  const identity = props.workspace ? "workspace:" + props.workspace.chatId + ":" + props.workspace.id
    : props.noteId ? "note:" + props.noteId : "editor:" + (props.editorId || instanceId);
  return <NotesBlockEditorInstance key={identity} {...props} identity={identity}/>;
}
function NotesBlockEditorInstance({
  value, onChange, noteId, workspace, identity, onCreateSubpage, onCreateIssue, onOpenNote,
  disabled: disabledProp = false, readOnly = false, maxLength, autoFocus = false, initialMode = "blocks",
  sourceLocation, resolveUrl, placeholder: placeholderText, "aria-label": ariaLabel = "Page blocks", className, onPointerDown, onFiles, hideAttachmentButton = false,
}: NotesBlockEditorProps & { identity: string }) {
  const disabled = disabledProp || readOnly;
  const target = markdownAttachmentTarget(noteId, workspace);
  const limit = markdownAttachmentLimit(target, maxLength);
  const settings = useRef({ disabled, limit, onFiles, resolveUrl }); settings.current = { disabled, limit, onFiles, resolveUrl };
  const externalUpdate = useRef(false);
  const serialize = useMemo(createNotesMarkdownSerializer, [identity]);
  const root = useRef<HTMLDivElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const latest = useRef(value), mounted = useRef(true);
  const valueSync = useRef(createEditorValueSync(value));
  const [sourceMode, setSourceMode] = useState(initialMode !== "blocks" || Boolean(sourceLocation)), [draft, setDraft] = useState(value);
  const sourceModeRef = useRef(sourceMode); sourceModeRef.current = sourceMode;
  const [error, setError] = useState(""), [slash, setSlash] = useState<SlashMenu | null>(null), [menuIndex, setMenuIndex] = useState(0);
  const [hover, setHover] = useState<HoverBlock | null>(null), [blockMenu, setBlockMenu] = useState<MenuPosition | null>(null);
  const [reference, setReference] = useState<SlashMenu | null>(null);
  const [referenceKind,setReferenceKind] = useState<ReferenceKind | null>(null);
  const [referenceSearchText,setReferenceSearchText]=useState<string|undefined>();
  const referenceSearchInput=useRef<HTMLInputElement>(null),referenceMenuRoot=useRef<HTMLDivElement>(null);
  const referenceKeyHandler=useRef<(event:{key:string;shiftKey:boolean;repeat:boolean;isComposing?:boolean;nativeEvent?:{isComposing?:boolean};preventDefault:()=>void})=>boolean>(()=>false);
  const [referenceIndex,setReferenceIndex] = useState(0);
  const referenceRef=useRef<SlashMenu | null>(null), referenceIndexRef=useRef(0);
  const referenceDismissed=useRef("");
  const referenceResultsRef=useRef<ReferenceResult[]>([]);
  const selectReferenceRef=useRef<(item:ReferenceResult)=>void>(()=>{});
  const referenceQuery=referenceSearchText ?? reference?.query ?? "";
  const referenceCategories=Boolean(reference&&!referenceKind&&!referenceQuery.trim());
  const referenceSearch=useReferenceSearch<ReferenceResult>({enabled:Boolean(reference)&&!referenceCategories&&!disabled&&!sourceMode,chatId:workspace?.chatId,kind:referenceKind,query:referenceQuery});
  const referenceResults=useMemo(()=>referenceSearch.results.filter(item=>item.kind!=="note" || item.id!==noteId),[referenceSearch.results,noteId]);
  referenceResultsRef.current=referenceResults;
  const referenceMenuId=useId();
  const [previewAnchor,setPreviewAnchor]=useState<HTMLAnchorElement|null>(null);
  const [selectionMenu, setSelectionMenu] = useState<MenuPosition | null>(null);
  const [, render] = useState(0);
  const [dialog, setDialog] = useState<"link" | "image" | "page" | "embed" | "code" | null>(null);
  const [dialogValue, setDialogValue] = useState(""), [dialogTitle, setDialogTitle] = useState("");
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [fileDrag, setFileDrag] = useState(false);
  const [creatingIssue, setCreatingIssue] = useState(false);
  const creatingIssueRef = useRef(false);
  const [issueRecovery, setIssueRecovery] = useState<{sourceId:string;issue:NotesIssueReference} | null>(null);
  const uploadPositions = useRef(new Map<string, number>());
  const ownUploadIds = useRef(new Set<string>());
  const commandRef = useRef<(id: string) => void>(() => {});
  const linkDialogRef = useRef<() => void>(() => {});
  const slashRef = useRef<SlashMenu | null>(null), commandsRef = useRef<BlockCommand[]>([]), menuIndexRef = useRef(0);
  const publish = useCallback((next: string) => {
    if (settings.current.disabled) return;
    if (!markdownChangeFitsLimit(latest.current, next, settings.current.limit)) { setError("Document is full. Remove some content before adding more."); return; }
    if (next === latest.current) return;
    latest.current = next; valueSync.current.published(next); setDraft(next); onChangeRef.current(next);
  }, []);
  const extensions = useMemo(() => notesEditorExtensions().map((extension) => {
    if (extension.name === "image") return markdownDisplayImageExtension((src) => settings.current.resolveUrl?.(src, "image") || src, extension.options);
    if (extension.name === "sourceBlock") return NotesSourceBlock.extend({ addNodeView: () => ReactNodeViewRenderer(SourceBlockView) });
    if (extension.name === "mathBlock") return NotesMathBlock.extend({ addNodeView: () => ReactNodeViewRenderer(MathView) });
    if (extension.name === "inlineMath") return NotesInlineMath.extend({ addNodeView: () => ReactNodeViewRenderer(InlineMathView) });
    if (extension.name === "tableOfContents") return NotesTableOfContents.extend({ addNodeView: () => ReactNodeViewRenderer(TableOfContentsView) });
    if (extension.name === "toggleBlock") return NotesToggle.extend({ addNodeView: () => ReactNodeViewRenderer(ToggleView) });
    if (extension.name === "placeholder" && placeholderText) return extension.configure({ placeholder: placeholderText });
    return extension;
  }).concat(markdownEditorGuard({ maxLength: () => settings.current.limit, disabled: () => settings.current.disabled,
    externalUpdate: () => externalUpdate.current, serialize, onExceeded: () => setError("Document is full. Remove some content before adding more.") })), [placeholderText, serialize]);
  // Initial parsing belongs to the editor instance; controlled updates sync below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialContent = useMemo(() => parseNotesMarkdown(value) as JSONContent, [identity]);
  const editor = useEditor({
    extensions, immediatelyRender: false, shouldRerenderOnTransaction: false,
    enableContentCheck: true,
    onContentError: () => { setError("Could not open rich blocks. Your complete Markdown source is preserved."); setSourceMode(true); },
    content: initialContent, editable: !disabled, autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: { class: "notes-prosemirror", "aria-label": ariaLabel, role: "textbox", "aria-multiline": "true", spellcheck: "true" },
      handleKeyDown: (view, event) => {
        if (settings.current.disabled) return false;
        if (!event.isComposing && referenceRef.current) {
          if(referenceKeyHandler.current(event)){event.stopPropagation();return true;}
        }
        if (slashRef.current) {
          const available = commandsRef.current;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); const next = (menuIndexRef.current + (event.key === "ArrowDown" ? 1 : -1) + available.length) % Math.max(1, available.length); menuIndexRef.current = next; setMenuIndex(next); return true;
          }
          if (event.key === "Enter" && available.length) { event.preventDefault(); commandRef.current(available[menuIndexRef.current % available.length].id); return true; }
          if (event.key === "Escape") { setSlash(null); slashRef.current = null; return true; }
        }
        if (event.altKey && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); if (editorRef.current) moveBlocks(editorRef.current, event.key === "ArrowUp" ? -1 : 1); return true; }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); linkDialogRef.current(); return true; }
        if ((event.metaKey || event.ctrlKey) && event.key === "/") { event.preventDefault(); const rect = view.coordsAtPos(view.state.selection.from); setBlockMenu({ top: rect.bottom + 6, left: rect.left }); return true; }
        return false;
      },
      handlePaste: (_view, event) => {
        if (settings.current.disabled) return false;
        const files = Array.from(event.clipboardData?.files || []);
        if (files.length) { event.preventDefault(); void uploadRef.current(files); return true; }
        if (event.clipboardData?.getData("text/html")) return false;
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;
        event.preventDefault();
        const parsed = parseNotesMarkdown(text);
        editorRef.current?.chain().focus().insertContent(parsed.content as JSONContent[]).run();
        return true;
      },
      handleDrop: (view, event) => settings.current.disabled ? false : createNotesEditorDropHandler({ noteId: identity, onFiles: (files) => uploadRef.current(files), onError: setError })(view, event),
    },
    onUpdate: ({ editor: current }) => { try { publish(serialize(current.state.doc)); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not serialize this page. Your editor content is still available."); } },
    onTransaction: ({ transaction }) => {
      for (const [id, pos] of uploadPositions.current) uploadPositions.current.set(id, transaction.mapping.map(pos, 1));
      render((count) => count + 1);
    },
    onSelectionUpdate: () => render((count) => count + 1),
  }, [identity]);
  const editorRef = useRef(editor); editorRef.current = editor;
  const uploadRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!valueSync.current.receive(value)) return;
    latest.current = value; setDraft(value);
    if (editor) {
      try { externalUpdate.current = true; editor.commands.setContent(parseNotesMarkdown(value) as JSONContent, { emitUpdate: false, errorOnInvalidContent: true }); setError(""); }
      catch (reason) { setError("Could not open rich blocks. Markdown source is preserved. " + (reason instanceof Error ? reason.message : "")); setSourceMode(true); }
      finally { externalUpdate.current = false; }
    }
  }, [value, editor]);
  useEffect(() => {
    editor?.setEditable(!disabled, false);
    if (editor) editor.setOptions({ editorProps: { ...editor.options.editorProps, attributes: {
      class: "notes-prosemirror", "aria-label": ariaLabel, role: "textbox", "aria-multiline": "true", "aria-readonly": String(disabled), spellcheck: "true",
    } } });
    if (disabled) { setSlash(null); slashRef.current = null; setBlockMenu(null); setSelectionMenu(null); setHover(null); setDialog(null); }
  }, [ariaLabel, disabled, editor]);
  useEffect(() => { if (sourceLocation) setSourceMode(true); }, [sourceLocation]);
  useEffect(() => {
    if (!editor || sourceMode || disabled) { setSelectionMenu(null); return; }
    const update = () => {
      if (editor.isDestroyed || !root.current) return;
      // ProseMirror emits its blur transaction before the menu input receives focus.
      // The deferred blur handler owns dismissal during that transition.
      if(!editor.isFocused && referenceRef.current)return;
      const { from, to, empty, $from } = editor.state.selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc");
      const match = /^\/([\w -]*)$/.exec(textBefore);
      if (empty && match && $from.parent.type.name === "paragraph") {
        const rect = editor.view.coordsAtPos(from), next = { from: from - textBefore.length, to: from, query: match[1].toLowerCase(), top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 310) };
        setSlash(next); slashRef.current = next;
      } else { setSlash(null); slashRef.current = null; }
      const candidate=(editor.isFocused || Boolean(referenceMenuRoot.current?.contains(document.activeElement))) && empty && !$from.parent.type.spec.code && !editor.isActive("link") ? notesReferenceQuery(textBefore) : null;
      const mention=candidate && referenceDismissed.current!==[from-candidate.length,candidate.query].join(":") ? candidate : null;
      if(!candidate)referenceDismissed.current="";
      if(mention) {
        const rect=editor.view.coordsAtPos(from);
        const next={from:from-mention.length,to:from,query:mention.query,top:rect.bottom+8,left:Math.max(8,Math.min(rect.left,window.innerWidth-330))};
        const previous=referenceRef.current;
        if(!previous||previous.from!==next.from){setReferenceKind(null);setReferenceSearchText(undefined);}
        else if(previous.query!==next.query)setReferenceSearchText(undefined);
        setReference(next);referenceRef.current=next;
      } else {setReference(null);referenceRef.current=null;}
      if (!empty && !(editor.state.selection instanceof NodeSelection)) {
        const start = editor.view.coordsAtPos(from), end = editor.view.coordsAtPos(to);
        setSelectionMenu({ top: Math.max(8, Math.min(start.top, end.top) - 46), left: Math.max(8, Math.min((start.left + end.left) / 2 - 160, window.innerWidth - 340)) });
      } else setSelectionMenu(null);
    };
    let blurFrame=0;
    const blur=()=>{cancelAnimationFrame(blurFrame);blurFrame=requestAnimationFrame(()=>{if(!referenceMenuRoot.current?.contains(document.activeElement)&&!editor.isFocused){setReference(null);referenceRef.current=null;}});};
    editor.on("transaction", update);editor.on("focus",update);editor.on("blur",blur);update();
    return () => {cancelAnimationFrame(blurFrame);editor.off("transaction", update);editor.off("focus",update);editor.off("blur",blur); };
  }, [disabled, editor, sourceMode]);
  useEffect(()=>{setReferenceIndex(0);referenceIndexRef.current=0;},[referenceQuery,referenceKind]);
  useEffect(()=>{
    const dom=editor?.view.dom;
    if(!dom)return;
    if(reference){
      dom.setAttribute("aria-autocomplete","list");
      dom.setAttribute("aria-controls",referenceMenuId);
      const selected=(referenceCategories?NOTES_REFERENCE_KINDS.length:referenceResults.length) ? referenceMenuId+"-option-"+referenceIndex : "";
      if(selected)dom.setAttribute("aria-activedescendant",selected);
      else dom.removeAttribute("aria-activedescendant");
      document.getElementById(selected)?.scrollIntoView({block:"nearest"});
    }else{
      dom.removeAttribute("aria-autocomplete");dom.removeAttribute("aria-controls");dom.removeAttribute("aria-activedescendant");
    }
  },[editor,reference,referenceMenuId,referenceIndex,referenceResults,referenceCategories]);
  useEffect(()=>{ if(disabled || sourceMode){setReference(null);referenceRef.current=null;setPreviewAnchor(null);} },[disabled,sourceMode]);
  useEffect(()=>{setPreviewAnchor(null);},[draft]);
  useEffect(() => { setMenuIndex(0); menuIndexRef.current = 0; }, [slash?.query]);
  useEffect(() => {
    const update = () => setUploadTasks(getUploadSnapshot().filter((task) => ownUploadIds.current.has(task.id) && !["completed", "cancelled"].includes(task.status)));
    return subscribeUploads(update);
  }, []);
  const uploadFiles = async (files: File[]) => {
    if (!files.length || settings.current.disabled) return;
    if (settings.current.onFiles) { try { await settings.current.onFiles(files); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not attach files."); } return; }
    if (files.length > 10) { setError("Choose up to 10 files at a time. No files were omitted."); return; }
    setError("");
    try {
      for (const file of files) {
        let taskId = "";
        taskId = startUpload(file, {
          label: target?.kind === "workspace" ? "Workspace attachment" : target ? "Page attachment" : "Markdown attachment",
          onComplete: async (asset) => {
            const source = fileEmbedMarkdown({ ...asset, url: "/api/file-uploads/" + asset.id + "/file" });
            // Workspace attachments are saved independently of the panel's explicit Save button.
            // Always append against the latest server record; never send an old local draft over a concurrent edit.
            const saved = target?.kind === "workspace" ? await persistMarkdownAttachment(target, source, limit) : null;
            const current = editorRef.current;
            if (mounted.current && current && !current.isDestroyed && !settings.current.disabled) {
              if (!latest.current.includes(source)) {
                appendMarkdownAttachment(latest.current, source, settings.current.limit); // Validate before mutating.
                if (sourceModeRef.current) publish(appendMarkdownAttachment(latest.current, source, settings.current.limit));
                else {
                  const position = Math.min(uploadPositions.current.get(taskId) ?? current.state.selection.to, current.state.doc.content.size);
                  const previous = current.state.doc;
                  current.chain().focus().insertContentAt(position, parseNotesMarkdown(source).content as JSONContent[]).run();
                  if (previous.eq(current.state.doc)) throw new Error("Could not insert the attachment. Re-enable editing or remove content and retry.");
                }
              }
            } else if (target?.kind === "note") {
              await persistMarkdownAttachment(target, source, limit);
            } else if (!target) {
              throw new Error("The original Markdown editor was closed. Reopen it before retrying this attachment.");
            }
            uploadPositions.current.delete(taskId);
            if (target?.kind === "workspace" && saved) window.dispatchEvent(new CustomEvent("metis:workspace-upload-complete", { detail: { chatId: target.chatId, workspace: saved } }));
            if (target?.kind === "note") window.dispatchEvent(new Event("metis:notes-changed"));
          },
        });
        ownUploadIds.current.add(taskId);
        uploadPositions.current.set(taskId, editor?.state.selection.to ?? 0);
      }
      setUploadTasks(getUploadSnapshot().filter((task) => ownUploadIds.current.has(task.id)));
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not upload file."); }
  };
  uploadRef.current = uploadFiles;
  useEffect(() => {
    const host = root.current; if (!host || disabled) return;
    const surface = host.closest(".sticky-note") || host;
    return registerFileDrop(surface, { containsTarget: (node) => node instanceof Node && surface.contains(node),
      onActive: setFileDrag, onFiles: (files) => { void uploadRef.current(Array.from(files)); }, resetTarget: window });
  }, [disabled]);
  const openDialog = (type: typeof dialog) => {
    if (settings.current.disabled) return;
    setDialog(type); setDialogValue(type === "link" ? String(editor?.getAttributes("link").href || "") : type === "code" ? String(editor?.getAttributes("codeBlock").language || "") : "");
    setDialogTitle(""); setBlockMenu(null);
  };
  linkDialogRef.current = () => openDialog("link");
  const insert = (content: JSONContent) => editor?.chain().focus().insertContent(content).run();
  const applyTaskConversion = (sourceId: string, expected: string, issue: NotesIssueReference) => {
    const current = editorRef.current;
    if (!current || current.isDestroyed) return false;
    const plan = planNotesTaskIssueConversion(current.getJSON() as EditorNode, sourceId, expected, issue);
    if (!plan) return false;
    let parent = current.state.doc, pos = 0;
    for (const index of plan.listPath) { for (let sibling = 0; sibling < index; sibling++) pos += parent.child(sibling).nodeSize; const child = parent.child(index); parent = child; pos += 1; }
    const listPos = pos - 1;
    const replacements = plan.nodes.map((node) => current.schema.nodeFromJSON(node));
    current.view.dispatch(current.state.tr.replaceWith(listPos, listPos + parent.nodeSize, Fragment.fromArray(replacements)));
    return true;
  };
  const createIssueFromSelection = async () => {
    if (!editor || disabled || !onCreateIssue || creatingIssueRef.current) return;
    const { $from } = editor.state.selection;
    let task: {node:ProseMirrorNode;pos:number} | null = null;
    for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === "taskItem") { task = {node:$from.node(depth),pos:$from.before(depth)}; break; }
    if (!task && editor.state.selection instanceof NodeSelection && editor.state.selection.node.type.name === "taskList" && editor.state.selection.node.childCount === 1) task = {node:editor.state.selection.node.child(0),pos:editor.state.selection.from+1};
    setBlockMenu(null);
    if (!task) {
      const text = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "\n") || selectedBlocks(editor).map(({node}) => node.textBetween(0,node.content.size,"\n")).join("\n");
      if (!text.trim()) { setError("Select text or write a task before creating an issue."); return; }
      const blocks = selectedBlocks(editor);
      const anchored = blocks.map((block) => ({...block,id:String(block.node.attrs.blockId || newId())}));
      const transaction = editor.state.tr;
      for (const block of anchored) if (!block.node.attrs.blockId) transaction.setNodeMarkup(block.pos,undefined,{...block.node.attrs,blockId:block.id});
      if (transaction.docChanged) editor.view.dispatch(transaction);
      const first = anchored[0], last = anchored.at(-1)!;
      const {from,to,empty} = editor.state.selection;
      creatingIssueRef.current = true; setCreatingIssue(true);
      try {
        const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
        const hash = Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2,"0")).join("");
        const sourceId = notesSelectionSourceId(first.id,empty ? 0 : from - first.pos,last.id,empty ? last.node.nodeSize : to - last.pos,hash);
        await onCreateIssue(text,{kind:"selection",sourceId});
      } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not create issue."); }
      finally { creatingIssueRef.current = false; if (mounted.current) setCreatingIssue(false); }
      return;
    }
    const sourceId = String(task.node.attrs.blockId || newId());
    if (!task.node.attrs.blockId) editor.view.dispatch(editor.state.tr.setNodeMarkup(task.pos,undefined,{...task.node.attrs,blockId:sourceId}));
    const taskNode = editor.state.doc.nodeAt(task.pos)!;
    const signature = notesNodeSignature(taskNode.toJSON());
    creatingIssueRef.current = true; setCreatingIssue(true); setError("");
    try {
      const issue = await onCreateIssue(taskNode.textBetween(0,taskNode.content.size,"\n"), {kind:"checkbox",sourceId});
      if (!mounted.current) return;
      if (!issue) { setError("Issue creation did not return a reference. The source task is preserved."); return; }
      if (!applyTaskConversion(sourceId,signature,issue)) setIssueRecovery({sourceId,issue});
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not create issue. The source task is preserved."); }
    finally { creatingIssueRef.current = false; if (mounted.current) setCreatingIssue(false); }
  };
  const commands: BlockCommand[] = [
    { id: "text", title: "Text", detail: "Plain paragraph", run: (e) => { e.chain().focus().setParagraph().run(); } },
    ...[1,2,3].map((level): BlockCommand => ({ id: "h" + level, title: "Heading " + level, detail: ["Large section heading","Medium section heading","Small section heading"][level - 1], keywords: "title", run: (e) => { e.chain().focus().toggleHeading({ level: level as 1|2|3 }).run(); } })),
    { id: "bullet", title: "Bulleted list", detail: "An unordered list", run: (e) => { e.chain().focus().toggleBulletList().run(); } },
    { id: "number", title: "Numbered list", detail: "An ordered list", run: (e) => { e.chain().focus().toggleOrderedList().run(); } },
    { id: "task", title: "To-do list", detail: "Track a checklist", keywords: "task checkbox", run: (e) => { e.chain().focus().toggleTaskList().run(); } },
    { id: "toggle", title: "Toggle", detail: "Collapsible content", run: () => { insert({ type: "toggleBlock", attrs: { title: "Toggle", open: true }, content: [paragraph()] }); } },
    { id: "quote", title: "Quote", detail: "Quote a passage", run: (e) => { e.chain().focus().toggleBlockquote().run(); } },
    { id: "callout", title: "Callout", detail: "Highlight an important point", run: () => { insert({ type: "callout", attrs: { tone: "info" }, content: [paragraph()] }); } },
    { id: "divider", title: "Divider", detail: "A horizontal rule", run: (e) => { e.chain().focus().setHorizontalRule().run(); } },
    { id: "code", title: "Code", detail: "Code with a language", run: (e) => { e.chain().focus().toggleCodeBlock().run(); } },
    { id: "table", title: "Table", detail: "Three columns with a header", run: (e) => { e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
    { id: "image", title: "Image", detail: "Add an image by URL", run: () => openDialog("image") },
    { id: "file", title: "Upload file", detail: "Images, documents, audio or video", keywords: "attachment", run: () => fileInput.current?.click() },
    { id: "embed", title: "Bookmark / embed", detail: "Save a web address", run: () => openDialog("embed") },
    { id: "math", title: "Equation", detail: "A LaTeX equation", run: () => { insert({ type: "mathBlock", attrs: { latex: "x^2 + y^2 = z^2" } }); } },
    { id: "inline-math", title: "Inline equation", detail: "LaTeX inside a paragraph", run: () => { insert({ type: "inlineMath", attrs: { latex: "x^2" } }); } },
    { id: "columns", title: "Two columns", detail: "Side-by-side content", run: () => { insert({ type: "columns", content: [{type:"column",content:[paragraph()]},{type:"column",content:[paragraph()]}] }); } },
    { id: "toc", title: "Table of contents", detail: "Live links to the headings in this file", keywords: "outline toc", run: () => { insert({type:"tableOfContents",attrs:{version:1}}); } },
    { id: "reference", title: "Link page", detail: "Reference an existing page", keywords: "reference linkpage", run: () => openDialog("page") },
    ...(onCreateSubpage ? [{ id: "page", title: "Page", detail: "Create a subpage inside this page", keywords: "subpage new page",  run: () => onCreateSubpage() }] : []),
    ...(onCreateIssue ? [{ id: "issue", title: editor?.isActive("taskItem") ? "Convert task to issue" : "Create issue", detail: editor?.isActive("taskItem") ? "Replace this checkbox with its permanent issue link" : "Create an issue from selected text", run: () => { void createIssueFromSelection(); } }] : []),
  ];
  const filtered = commands.filter((command) => !slash?.query || (command.id + " " + command.title + " " + command.keywords).toLowerCase().includes(slash.query)).sort((a,b) => Number(b.id === slash?.query) - Number(a.id === slash?.query));
  commandsRef.current = filtered; menuIndexRef.current = menuIndex;
  const runCommand = (id: string) => {
    if (!editor || disabled) return;
    const command = commands.find((item) => item.id === id);
    if (!command) return;
    const currentSlash = slashRef.current;
    slashRef.current = null; setSlash(null); setBlockMenu(null);
    if (currentSlash) editor.chain().focus().deleteRange({ from: currentSlash.from, to: currentSlash.to }).run();
    command.run(editor);
  };
  commandRef.current = runCommand;
  selectReferenceRef.current=(item)=>{
    const current=referenceRef.current,href=notesReferenceHref(item);
    if(!editor || disabled || !current || !href)return;
    referenceRef.current=null;setReference(null);
    editor.chain().focus().insertContentAt({from:current.from,to:current.to},[
      {type:"text",text:item.label,marks:[{type:"link",attrs:{href}}]},
      {type:"text",text:" "},
    ]).run();
  };
  const selectReferenceCategory=(kind:ReferenceKind|null)=>{
    setReferenceKind(kind);setReferenceSearchText("");referenceIndexRef.current=0;setReferenceIndex(0);
    requestAnimationFrame(()=>referenceSearchInput.current?.focus());
  };
  referenceKeyHandler.current=event=>{
    if(!referenceRef.current || event.isComposing || event.nativeEvent?.isComposing)return false;
    if(event.key==="Backspace"&&referenceKind&&!referenceQuery&&document.activeElement===referenceSearchInput.current){event.preventDefault();selectReferenceCategory(null);return true;}
    const action=composerReferenceKeyAction({key:event.key,shiftKey:event.shiftKey,repeat:event.repeat,count:referenceCategories?NOTES_REFERENCE_KINDS.length:referenceResultsRef.current.length,index:referenceIndexRef.current});
    if(action){
      event.preventDefault();
      if(action.type==="move"){referenceIndexRef.current=action.index;setReferenceIndex(action.index);}
      else if(action.type==="dismiss"){referenceDismissed.current=[referenceRef.current.from,referenceRef.current.query].join(":");referenceRef.current=null;setReference(null);editor?.commands.focus();}
      else if(referenceCategories)selectReferenceCategory(NOTES_REFERENCE_KINDS[action.index]);
      else {const item=referenceResultsRef.current[action.index];if(item)selectReferenceRef.current(item);}
      return true;
    }
    if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();return true;}
    return false;
  };
  const commandIcons:Record<string,typeof List>={text:Type,h1:Heading1,h2:Heading2,h3:Heading3,bullet:List,number:ListOrdered,task:ListTodo,toggle:ChevronRight,quote:Quote,callout:Info,divider:Minus,code:Code2,table:Table2,image:ImageIcon,file:Paperclip,embed:Globe,math:Sigma,"inline-math":Sigma,columns:Columns2,toc:ListTree,reference:Link2,page:FilePlus2,issue:CircleDot};
  const commandIcon=(id:string)=>{const Icon=commandIcons[id] || FileText;return <Icon size={17} aria-hidden="true"/>;};
  const selectHovered = (extend = false) => {
    if (!editor || !hover) return;
    const node = editor.state.doc.nodeAt(hover.pos);
    if (!node) return;
    const selection = extend ? TextSelection.create(editor.state.doc, Math.min(editor.state.selection.from, hover.pos + 1), Math.max(editor.state.selection.to, hover.pos + node.nodeSize - 1)) : NodeSelection.create(editor.state.doc, hover.pos);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
  };
  const blockAction = async (action: string) => {
    if (!editor || disabled) return;
    const blocks = selectedBlocks(editor);
    if (!blocks.length) return;
    const from = blocks[0].pos, to = blocks.at(-1)!.pos + blocks.at(-1)!.node.nodeSize;
    if (action === "delete") editor.chain().focus().deleteRange({ from, to }).run();
    if (action === "duplicate") {
      const copies = blocks.map(({node}) => { const json = node.toJSON(); json.attrs = { ...json.attrs, blockId: null }; return json; });
      editor.chain().focus().insertContentAt(to, copies).run();
    }
    if (action === "up" || action === "down") moveBlocks(editor, action === "up" ? -1 : 1);
    if (action === "copy") {
      const id = String(blocks[0].node.attrs.blockId || newId());
      if (!blocks[0].node.attrs.blockId) editor.view.dispatch(editor.state.tr.setNodeMarkup(from, undefined, { ...blocks[0].node.attrs, blockId: id }));
      try { await navigator.clipboard.writeText(noteId ? "metis://note/" + encodeURIComponent(noteId) + "#block-" + id : window.location.href.split("#")[0] + "#block-" + id); }
      catch { setError("Could not copy the link. Allow clipboard access, then try again."); }
    }
    if (action === "issue") await createIssueFromSelection();
    setBlockMenu(null);
  };
  const submitDialog = () => {
    if (!editor || disabled || !dialog) return;
    setError("");
    const input = dialogValue.trim();
    if (dialog === "code") {
      if (!/^[a-zA-Z0-9_+.-]*$/.test(input)) { setError("Use a language identifier such as typescript, python or c++."); return; }
      editor.chain().focus().updateAttributes("codeBlock", { language: input || null }).run();
    }
    else if (dialog === "page") {
      const id = input.replace(/^(?:metis:\/\/note\/|note:\/\/)/, "").split("#")[0];
      if (!id) { setError("Enter a page ID or a Metis page link."); return; }
      insert({ type: "pageReference", attrs: { noteId: decodeURIComponent(id), title: dialogTitle.trim() || id } });
    } else {
      if (!safeUrl(input) || (dialog === "image" && !/^(https?:\/\/|\/(?!\/))/i.test(input))) { setError("Enter a valid HTTP, HTTPS or local address."); return; }
      if (dialog === "link") editor.chain().focus().extendMarkRange("link").setLink({ href: input }).run();
      if (dialog === "image") editor.chain().focus().setImage({ src: input, alt: dialogTitle.trim() }).run();
      if (dialog === "embed") insert({ type: "embedBlock", attrs: { url: input, title: dialogTitle.trim() || input } });
    }
    setDialog(null);
  };
  return <div ref={root} className={"notes-block-editor" + (disabled ? " is-readonly" : "") + (className ? " " + className : "")} data-note-drop-target={noteId || workspace?.id || identity} onPointerDown={onPointerDown} aria-disabled={disabled || undefined}
    onMouseOver={(event)=>{const anchor=(event.target as HTMLElement).closest<HTMLAnchorElement>(".notes-prosemirror a");setPreviewAnchor(anchor);}}
    onMouseOut={(event)=>{if(previewAnchor && !(event.relatedTarget instanceof Node && previewAnchor.contains(event.relatedTarget)))setPreviewAnchor(null);}}
    onFocusCapture={(event)=>setPreviewAnchor((event.target as HTMLElement).closest<HTMLAnchorElement>(".notes-prosemirror a"))}
    onBlurCapture={()=>setPreviewAnchor(null)}
    onClickCapture={(event) => {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if(!href)return;
    const resolved=settings.current.resolveUrl?.(href,"link") || href;
    const modified=event.ctrlKey || event.metaKey;
    if(/^https?:\/\//i.test(resolved) && (modified || disabled)) {
      event.preventDefault();event.stopPropagation();setPreviewAnchor(null);
      if(modified)window.open(resolved,"_blank","noopener,noreferrer");
      else window.dispatchEvent(new CustomEvent("ai-chat:open-browser",{detail:resolved}));
      return;
    }
    const fileLocation = parseWorkspaceFileLink(resolved);
    if (fileLocation) { event.preventDefault(); event.stopPropagation(); window.dispatchEvent(new CustomEvent("ai-chat:open-file", { detail: fileLocation })); return; }
    const referenceLink=parseReferenceLink(resolved);
    if(referenceLink){event.preventDefault();event.stopPropagation();window.dispatchEvent(new CustomEvent("ai-chat:open-reference",{detail:referenceLink}));return;}
    const internal = parseInternalLink(resolved);
    if (internal) {
      event.preventDefault(); event.stopPropagation();
      if (internal.kind === "note" && internal.id === noteId && internal.blockId) {
        root.current?.querySelector('[data-block-id="' + CSS.escape(internal.blockId) + '"]')?.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (internal.kind === "note" && onOpenNote) onOpenNote(internal.id, internal.blockId);
      else { const navigation = internalLinkNavigation(internal); window.dispatchEvent(new CustomEvent(navigation.event, { detail: navigation.detail })); }
    }
  }}>
    {previewAnchor && <LinkPreview key={previewAnchor.getAttribute("href")} href={settings.current.resolveUrl?.(previewAnchor.getAttribute("href") || "","link") || previewAnchor.getAttribute("href") || ""} anchorElement={previewAnchor}/>}
    <div className="notes-editor-topbar">
      <div className="notes-editor-mode" role="group" aria-label="Editor mode"><button type="button" className={!sourceMode ? "is-active" : ""} onClick={() => { if (!editor) return; try { const parsed = parseNotesMarkdown(latest.current); editor.schema.nodeFromJSON(parsed).check(); if (serialize(editor.state.doc) !== latest.current) { externalUpdate.current = true; try { editor.commands.setContent(parsed as JSONContent, { emitUpdate: false, errorOnInvalidContent: true }); } finally { externalUpdate.current = false; } } setSourceMode(false); setError(""); } catch { setError("Could not open rich blocks. Your complete Markdown source is preserved."); } }}>Blocks</button><button type="button" className={sourceMode ? "is-active" : ""} onClick={() => setSourceMode(true)}><Code2 size={13} /> Markdown</button></div>
      <div className="notes-editor-tools">
        {!disabled && !sourceMode && <><ToolButton label="Undo (⌘/Ctrl Z)" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={15}/></ToolButton><ToolButton label="Redo (⌘/Ctrl Shift Z)" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={15}/></ToolButton><ToolButton label="Insert block (type /)" onClick={() => { if (!editor) return; const rect = editor.view.coordsAtPos(editor.state.selection.from); setBlockMenu({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 310) }); }}><Plus size={16}/></ToolButton></>}
        {!disabled && !hideAttachmentButton && <ToolButton label="Upload images or files" onClick={() => fileInput.current?.click()}><Paperclip size={15}/></ToolButton>}
      </div>
    </div>
    <input ref={fileInput} type="file" multiple hidden onChange={(event) => { void uploadFiles(Array.from(event.currentTarget.files || [])); event.currentTarget.value = ""; }} />
    {error && <div className="notes-editor-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError("")}><X size={14}/></button></div>}
    {creatingIssue && <div className="notes-editor-uploads" role="status">Creating issue…</div>}
    {!disabled && issueRecovery && <div className="notes-editor-error" role="status"><span>Issue {issueRecovery.issue.key} was created. The source task changed or was removed while it was being created.</span><button type="button" onClick={() => {
      const current = editorRef.current; if (!current) return;
      const found = findNotesTask(current.getJSON() as EditorNode,issueRecovery.sourceId);
      if (found) applyTaskConversion(issueRecovery.sourceId,notesNodeSignature(found.task),issueRecovery.issue);
      else current.chain().focus().insertContent({type:"paragraph",content:[{type:"text",text:issueRecovery.issue.key,marks:[{type:"link",attrs:{href:"issue://" + encodeURIComponent(issueRecovery.issue.id)}}]}]}).run();
      setIssueRecovery(null);
    }}> {editor && findNotesTask(editor.getJSON() as EditorNode,issueRecovery.sourceId) ? "Convert updated task" : "Insert issue link"}</button><button type="button" aria-label="Dismiss issue notice" onClick={() => setIssueRecovery(null)}><X size={14}/></button></div>}
    {uploadTasks.length > 0 && <div className="notes-editor-uploads" aria-live="polite">{uploadTasks.map((task) => <div key={task.id}><span>{task.name} · {task.status === "error" ? task.error : Math.round(task.loaded / Math.max(1,task.size) * 100) + "%"}</span>{task.status === "error" && <button type="button" onClick={() => retryUpload(task.id)}>Retry</button>}<button type="button" aria-label={"Cancel upload " + task.name} onClick={() => cancelUpload(task.id)}><X size={13}/></button></div>)}</div>}
    {fileDrag && <div className="notes-editor-file-drag" role="status">Drop images or files here</div>}
    {sourceMode ? <MarkdownSourceEditor value={draft} onChange={publish} disabled={disabled} maxLength={limit} ariaLabel={ariaLabel + " Markdown source"} placeholderText={placeholderText} autoFocus sourceLocation={sourceLocation} onExceeded={() => setError("Document is full. Remove some content before adding more.")} onFiles={uploadFiles}/> :
      <div className="notes-editor-canvas" onMouseMove={(event) => {
        if (!editor || disabled || blockMenu) return;
        let element = event.target as HTMLElement;
        const surface = editor.view.dom;
        while (element.parentElement && element.parentElement !== surface) element = element.parentElement;
        if (element.parentElement !== surface) return;
        try { const position = editor.view.posAtDOM(element, 0); const resolved = editor.state.doc.resolve(position); const pos = resolved.depth > 0 ? resolved.before(1) : position; setHover({ pos, top: element.getBoundingClientRect().top - event.currentTarget.getBoundingClientRect().top }); } catch {}
      }}>
        {!editor ? <div role="status" className="notes-editor-loading">Opening editor…</div> : <EditorContent editor={editor}/>}
        {hover && editor && !disabled && <div className="notes-block-handle" style={{ top: hover.top }}>
          <button type="button" aria-label="Insert block below" title="Insert block below" onMouseDown={(event) => event.preventDefault()} onClick={() => {
            const node = editor.state.doc.nodeAt(hover.pos); if (!node) return; const pos = hover.pos + node.nodeSize; editor.chain().focus().insertContentAt(pos, paragraph()).setTextSelection(pos + 1).run(); const rect = editor.view.coordsAtPos(pos + 1); setBlockMenu({ top: rect.bottom + 8, left: rect.left });
          }}><Plus size={15}/></button>
          <button type="button" draggable aria-label="Drag block or open block actions" title="Drag to move · Shift-click to select blocks" onMouseDown={(event) => { if (event.shiftKey) event.preventDefault(); selectHovered(event.shiftKey); }} onClick={(event) => { if (!event.shiftKey) setBlockMenu({ top: event.clientY + 8, left: event.clientX }); }} onDragStart={(event) => { selectHovered(); event.dataTransfer.setData("application/x-metis-note-block", JSON.stringify({ noteId: identity, pos: hover.pos })); event.dataTransfer.effectAllowed = "move"; setBlockMenu(null); }}><GripVertical size={16}/></button>
        </div>}
      </div>}
    <NotesContextToolbar editor={editor} hidden={disabled || sourceMode || Boolean(selectionMenu || slash || blockMenu || reference || dialog)}
      onEditCode={() => openDialog("code")} onCreateIssue={onCreateIssue ? () => void createIssueFromSelection() : undefined} creatingIssue={creatingIssue} />
    {!disabled && selectionMenu && editor && !sourceMode && !dialog && createPortal(<div className="notes-selection-toolbar" role="toolbar" aria-label="Text formatting" style={{ top: selectionMenu.top, left: selectionMenu.left }}>
      <ToolButton label="Bold (⌘/Ctrl B)" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15}/></ToolButton>
      <ToolButton label="Italic (⌘/Ctrl I)" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15}/></ToolButton>
      <ToolButton label="Underline (⌘/Ctrl U)" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={15}/></ToolButton>
      <ToolButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15}/></ToolButton>
      <ToolButton label="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}><Code2 size={15}/></ToolButton>
      <ToolButton label="Link (⌘/Ctrl K)" active={editor.isActive("link")} onClick={() => openDialog("link")}><Link2 size={15}/></ToolButton>
      <label className="notes-color-control" title="Text color"><span>A</span><input aria-label="Text color" type="color" value={editor.getAttributes("textStyle").color || "#e8e5df"} onInput={(event) => editor.chain().focus().setColor(event.currentTarget.value).run()}/></label>
      <select aria-label="Highlight color" value={editor.getAttributes("highlight").color || ""} onChange={(event) => event.target.value ? editor.chain().focus().setHighlight({ color: event.target.value }).run() : editor.chain().focus().unsetHighlight().run()}><option value="">Highlight</option><option value="#5c4c24">Yellow</option><option value="#294c3b">Green</option><option value="#354963">Blue</option><option value="#613c43">Red</option></select>
      <ToolButton label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().run()}><X size={14}/></ToolButton>
    </div>, document.body)}
    {!disabled && (slash || blockMenu) && editor && !sourceMode && createPortal(<>
      <div className="notes-menu-dismiss" onMouseDown={() => { setSlash(null); slashRef.current = null; setBlockMenu(null); }} />
      <div className="notes-block-menu" role="listbox" aria-label={slash ? "Insert a block" : "Block actions and insert"} style={{ top: Math.min((slash || blockMenu)!.top, window.innerHeight - 360), left: Math.max(8, Math.min((slash || blockMenu)!.left, window.innerWidth - 310)) }}>
        {blockMenu && <div className="notes-block-actions">
          <button type="button" onClick={() => void blockAction("duplicate")}><Copy size={14}/> Duplicate</button><button type="button" onClick={() => void blockAction("copy")}><Link2 size={14}/> Copy block link</button><button type="button" onClick={() => void blockAction("up")}><ArrowUp size={14}/> Move up</button><button type="button" onClick={() => void blockAction("down")}><ArrowDown size={14}/> Move down</button>{onCreateIssue && <button type="button" disabled={creatingIssue} onClick={() => void blockAction("issue")}><Check size={14}/> {editor.isActive("taskItem") ? "Convert task to issue" : "Create issue"}</button>}<button type="button" className="notes-action-delete" onClick={() => void blockAction("delete")}><Trash2 size={14}/> Delete</button>
        </div>}
        <div className="notes-menu-label">{slash?.query ? "Blocks matching “" + slash.query + "”" : "Insert or turn into"}</div>
        {(slash ? filtered : commands).map((command, index) => <button key={command.id} type="button" role="option" aria-selected={Boolean(slash && index === menuIndex)} className={slash && index === menuIndex ? "is-selected" : ""} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => { setMenuIndex(index); menuIndexRef.current = index; }} onClick={() => runCommand(command.id)}><span className="notes-command-icon">{commandIcon(command.id)}</span><span><strong>{command.title}</strong><small>{command.detail}</small></span></button>)}
        {slash && !filtered.length && <div className="notes-menu-empty">No matching blocks. Try “table”, “toggle” or “image”.</div>}
      </div>
    </>, document.body)}
    {!disabled && reference && !sourceMode && createPortal(<>
      <div className="notes-menu-dismiss" onMouseDown={()=>{setReference(null);referenceRef.current=null;}}/>
      <div className="notes-reference-popover" style={{top:Math.max(8,Math.min(reference.top,window.innerHeight-304)),left:Math.max(8,Math.min(reference.left,window.innerWidth-392))}}>
        <ReferencePicker id={referenceMenuId} rootRef={referenceMenuRoot} inputRef={referenceSearchInput}
          kind={referenceKind} query={referenceQuery} results={referenceResults} loading={referenceSearch.loading}
          indexing={referenceSearch.indexing} notice={referenceSearch.notice} error={referenceSearch.error} retry={referenceSearch.retry}
          index={referenceIndex} onIndex={index=>{referenceIndexRef.current=index;setReferenceIndex(index);}}
          onCategory={selectReferenceCategory} onQuery={query=>{setReferenceSearchText(query);setReferenceIndex(0);referenceIndexRef.current=0;}}
          onSelect={item=>selectReferenceRef.current(item)}
          onKeyDown={event=>{if(referenceKeyHandler.current(event))event.stopPropagation();}}
        />
      </div>
    </>,document.body)}
    {dialog && <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) setDialog(null); }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="notes-editor-dialog-overlay"/><DialogPrimitive.Content asChild aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); editor?.commands.focus(); }}>
      <form className="notes-editor-dialog" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); submitDialog(); }}>
        <div><DialogPrimitive.Title asChild><strong>{dialog === "code" ? "Code language" : dialog === "page" ? "Page reference" : "Add " + dialog}</strong></DialogPrimitive.Title><button type="button" aria-label="Close dialog" onClick={() => setDialog(null)}><X size={16}/></button></div>
        <label>{dialog === "page" ? "Page ID or Metis page link" : dialog === "code" ? "Language identifier" : "Address"}<input autoFocus value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} placeholder={dialog === "code" ? "typescript" : dialog === "page" ? "metis://note/…" : "https://…"} onKeyDown={(event) => { if (event.key === "Escape") setDialog(null); }}/></label>
        {["image","page","embed"].includes(dialog) && <label>{dialog === "image" ? "Alternative text" : "Title"}<input value={dialogTitle} onChange={(event) => setDialogTitle(event.target.value)}/></label>}
        <footer>{dialog === "link" && editor?.isActive("link") && <button type="button" onClick={() => { editor.chain().focus().unsetLink().run(); setDialog(null); }}>Remove link</button>}<button type="button" onClick={() => setDialog(null)}>Cancel</button><button type="submit">Apply</button></footer>
      </form>
    </DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>}
  </div>;
}
