/** Isolated UI fixture; open using Metis browser tools. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor } from "@tiptap/react";
import { notesEditorExtensions } from "../lib/notes-editor-extensions";
import { NotesLinkIcons } from "../lib/notes-link-icons";
import { EditorLinkIcons } from "../components/notes/editor-link-icons";
import { LinkIcon } from "../components/link-icon";
import { LinkPreview } from "../components/link-preview";
import { RichUserText } from "../components/rich-user-text";
import { parseNotesMarkdown, createNotesMarkdownSerializer } from "../lib/notes-editor-markdown";
import { PublicMarkdownLink } from "../components/public-markdown-link";
import "../components/notes/block-editor.css";

Object.assign(globalThis, { React });
const source = "[Launch note](note://demo) and [a **formatted** note](note://demo).\n\n[Plan](workspace://plan/demo), [Canvas](workspace://canvas/demo), [Issue](issue://demo) and [Website](https://example.com).";
const results = document.createElement("pre"); results.id = "results";
const checks: string[] = [];
const check = (value: unknown, label: string) => { checks.push((value ? "PASS " : "FAIL ") + label); results.textContent = checks.join("\n"); };
document.body.style.cssText = "margin:0;background:#141414;color:#ececec;font:15px system-ui";
document.documentElement.style.cssText = "--background:#141414;--foreground:#ececec;--muted:#262626;--muted-foreground:#aaa;--border:#3c3c3c;--popover:#252525;--popover-foreground:#eee;--primary:#a3c7ff";
const host = document.createElement("main"); host.style.cssText = "max-width:850px;padding:24px;margin:auto;line-height:1.8"; document.body.append(host, results);
results.style.cssText = "white-space:pre-wrap;padding:24px;color:#a5d6a7;font-size:12px";
function Fixture() {
  const editor = useEditor({ extensions: [...notesEditorExtensions(), NotesLinkIcons], content: parseNotesMarkdown(source), immediatelyRender: false });
  const [tested, setTested] = useState(false);
  useEffect(() => {
    if (!editor || tested) return;
    const timer = setTimeout(() => {
      const serialize = createNotesMarkdownSerializer();
      check(serialize(editor.state.doc) === source, "Markdown remains byte-identical");
      check(host.querySelectorAll("[data-editor-link-icon]").length === 6, "one editor icon per link across formatting");
      check(host.querySelectorAll('[data-link-icon-kind="note"] .lucide-rocket').length >= 3, "saved colored note icon in chat and editor");
      const first = editor.view.dom.querySelector("a");
      check(first?.textContent === "Launch note", "icons do not alter link labels");
      const end = editor.state.doc.content.size - 1;
      editor.commands.setTextSelection(end);
      editor.commands.insertContent(" Added");
      editor.commands.undo();
      check(serialize(editor.state.doc) === source, "typing and undo preserve Markdown");
      setTested(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, [editor, tested]);
  return <>
    <h1 style={{fontSize:22}}>Links with their own icons</h1>
    <h2 style={{fontSize:15,color:"#aaa"}}>Chat</h2>
    <p id="chat"><RichUserText content="[Launch note](note://demo) · [Plan](workspace://plan/demo) · [Canvas](workspace://canvas/demo) · [Website](https://example.com)"/></p>
    <h2 style={{fontSize:15,color:"#aaa"}}>Notes · Canvas · Plans editor</h2>
    <button id="read-only" onClick={() => editor?.setEditable(false)} style={{fontSize:12}}>Read-only preview</button>
    <div className="notes-block-editor"><EditorLinkIcons editor={editor}/><EditorContent editor={editor}/></div>
    <h2 style={{fontSize:15,color:"#aaa"}}>Hover preview</h2>
    <p><LinkPreview href="note://demo"><a id="preview" href="note://demo"><LinkIcon href="note://demo"/>Launch note</a></LinkPreview></p>
    <h2 style={{fontSize:15,color:"#aaa"}}>Public note</h2>
    <PublicMarkdownLink href="note://demo" share={{noteIds:["demo"],noteIcons:{demo:"🦁"},assets:{}}}>Shared note</PublicMarkdownLink>
  </>;
}
createRoot(host).render(<Fixture/>);
