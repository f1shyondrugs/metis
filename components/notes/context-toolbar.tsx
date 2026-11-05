"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { IndentDecrease, IndentIncrease, Code2, List, Table2, Check } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

type Context = "table" | "taskItem" | "listItem" | "codeBlock";
type Anchor = { kind: Context; contextElement: HTMLElement; getBoundingClientRect: () => DOMRect };

function contextAtSelection(editor: Editor): Context | null {
  if (editor.isActive("codeBlock")) return "codeBlock";
  if (editor.isActive("table")) return "table";
  if (editor.isActive("taskItem")) return "taskItem";
  return editor.isActive("listItem") ? "listItem" : null;
}

export function NotesContextToolbar({ editor, hidden, onEditCode, onCreateIssue, creatingIssue }: {
  editor: Editor | null; hidden: boolean; onEditCode: () => void;
  onCreateIssue?: () => void; creatingIssue: boolean;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const dismissed = useRef("");
  const selectionKey = () => editor ? [editor.state.selection.from, editor.state.selection.to, contextAtSelection(editor)].join(":") : "";
  const virtualRef = useMemo(() => ({ current: anchor }), [anchor]);

  useEffect(() => {
    if (!editor || hidden) { setAnchor(null); return; }
    const surface = editor.view.dom;
    let frame = 0;
    const update = () => {
      if (editor.isDestroyed) return;
      const focused = editor.isFocused || Boolean(toolbar.current?.contains(document.activeElement));
      const kind = contextAtSelection(editor);
      if (!focused || !kind || dismissed.current === [editor.state.selection.from, editor.state.selection.to, kind].join(":")) {
        setAnchor(null); return;
      }
      setAnchor({
        kind, contextElement: editor.view.dom,
        getBoundingClientRect: () => {
          const point = editor.view.coordsAtPos(editor.state.selection.head);
          return new DOMRect(point.left, point.top, Math.max(1, point.right - point.left), point.bottom - point.top);
        },
      });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "F10" && toolbar.current) {
        event.preventDefault();
        toolbar.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      }
    };
    editor.on("transaction", schedule); editor.on("focus", schedule); editor.on("blur", schedule);
    surface.addEventListener("keydown", keyboard);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", schedule); editor.off("focus", schedule); editor.off("blur", schedule);
      surface.removeEventListener("keydown", keyboard);
    };
  }, [editor, hidden]);

  if (!editor || !anchor || hidden) return null;
  const item = anchor.kind === "taskItem" ? "taskItem" : "listItem";
  const label = anchor.kind === "table" ? "Table actions" : anchor.kind === "codeBlock" ? "Code actions" : "List actions";
  const Icon = anchor.kind === "table" ? Table2 : anchor.kind === "codeBlock" ? Code2 : List;
  return <Popover open modal={false} onOpenChange={open => {
    if (!open) { dismissed.current = selectionKey(); setAnchor(null); }
  }}>
    <PopoverAnchor virtualRef={virtualRef} />
    <PopoverContent ref={toolbar} role="toolbar" aria-label={label} aria-keyshortcuts="Alt+F10"
      className="notes-context-toolbar" side="top" align="start" sideOffset={10} collisionPadding={8} sticky="always" hideWhenDetached
      onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
      onInteractOutside={event => { if (editor.view.dom.contains(event.target as Node)) event.preventDefault(); }}
      onEscapeKeyDown={() => { dismissed.current = selectionKey(); if (toolbar.current?.contains(document.activeElement)) editor.commands.focus(); }}
      onMouseDown={event => { if ((event.target as HTMLElement).closest("button")) event.preventDefault(); }}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const buttons = Array.from(toolbar.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }}>
      <span className="notes-context-label"><Icon size={14} aria-hidden="true"/>{anchor.kind === "table" ? "Table" : anchor.kind === "codeBlock" ? "Code" : "List"}</span>
      {anchor.kind === "table" ? <>
        <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row</button>
        <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Column</button>
        <button type="button" onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</button>
        <button type="button" onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</button>
        <button type="button" aria-pressed={editor.isActive("tableHeader")} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Header row</button>
        <button type="button" onClick={() => editor.chain().focus().deleteTable().run()}>Delete table</button>
      </> : anchor.kind === "codeBlock" ? <button type="button" onClick={onEditCode}>Language: {editor.getAttributes("codeBlock").language || "plain text"}</button> : <>
        <button type="button" disabled={!editor.can().sinkListItem(item)} onClick={() => editor.chain().focus().sinkListItem(item).run()}><IndentIncrease size={15} aria-hidden="true"/>Indent</button>
        <button type="button" disabled={!editor.can().liftListItem(item)} onClick={() => editor.chain().focus().liftListItem(item).run()}><IndentDecrease size={15} aria-hidden="true"/>Outdent</button>
        {anchor.kind === "taskItem" && onCreateIssue && <button type="button" disabled={creatingIssue} onClick={onCreateIssue}><Check size={15} aria-hidden="true"/>{creatingIssue ? "Creating issue…" : "Convert task to issue"}</button>}
      </>}
    </PopoverContent>
  </Popover>;
}
