"use client";

import { useEffect, useMemo, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { createEditorValueSync } from "@/lib/editor-value-sync";
import { minimalMarkdownChange } from "@/lib/markdown-editor";
import { markdownLengthChangeFitsLimit } from "@/lib/shared-markdown-editor";
import { resolveMarkdownSourceLocation } from "@/lib/markdown-source-location";
import type { WorkspaceFileLocation } from "@/lib/workspace-file-link";
import "./block-editor.css";

export function MarkdownSourceEditor({ value, onChange, disabled, maxLength, ariaLabel, placeholderText, autoFocus, sourceLocation, onExceeded, onFiles }: {
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
