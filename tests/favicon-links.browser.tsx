/** Isolated browser regressions; served by favicon-links.preview.mjs. */
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor } from "@tiptap/react";
import { Link2 } from "lucide-react";
import { WebsiteIcon } from "../components/website-icon";
import { LinkIcon } from "../components/link-icon";
import { RichUserText } from "../components/rich-user-text";
import { Markdown } from "../components/markdown";
import { LinkPreview } from "../components/link-preview";
import { ReferenceLink } from "../components/reference-link";
import { EditorLinkIcons } from "../components/notes/editor-link-icons";
import { NotesLinkIcons } from "../lib/notes-link-icons";
import { notesEditorExtensions } from "../lib/notes-editor-extensions";
import { parseNotesMarkdown, createNotesMarkdownSerializer } from "../lib/notes-editor-markdown";
import "../components/notes/block-editor.css";

const url = location.origin + "/article?q=example#section";
const source = "[Website](" + url + ") and [formatted **website**](" + url + ").";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function wait(check: () => boolean, label: string) {
  for (let i = 0; i < 200; i++) { if (check()) return; await sleep(30); }
  throw Error("Timed out: " + label);
}
function loaded(selector: string) {
  const host = document.querySelector(selector);
  const image = host?.querySelector("img");
  return Boolean(image?.complete && image.naturalWidth > 0 && host?.querySelector<HTMLElement>("[data-website-icon-fallback]")?.hidden);
}
function fallback(selector: string) {
  const host = document.querySelector(selector);
  return Boolean(host && !host.querySelector("img") && host.querySelector<HTMLElement>("[data-website-icon-fallback]")?.hidden === false);
}
function Fixture() {
  const editor = useEditor({ extensions: [...notesEditorExtensions(), NotesLinkIcons], content: parseNotesMarkdown(source), immediatelyRender: false });
  const [changing, setChanging] = useState("/missing.ico"), [report, setReport] = useState<string[]>([]);
  const once = useRef(false);
  useEffect(() => {
    if (!editor || once.current) return;
    once.current = true;
    void (async () => {
      const results: string[] = [];
      const check = (ok: unknown, label: string) => { if (!ok) throw Error(label); results.push("PASS " + label); setReport([...results]); };
      try {
        for (const id of ["chat", "markdown", "citation", "editor", "reference", "root-icon"]) {
          await wait(() => loaded("#" + id) || fallback("#" + id), id + " favicon resolves");
          check(true, id + (loaded("#" + id) ? " renders the favicon without the underlying generic icon" : " retains the original icon when the favicon is unavailable"));
        }
        await wait(() => loaded("#transparent"), "transparent SVG favicon");
        check(true, "successful transparent favicon replaces rather than overlays the original icon");
        for (const id of ["missing", "invalid", "empty", "changing"]) {
          await wait(() => fallback("#" + id), id + " fallback");
          check(true, id + " retains the original icon without a broken image");
        }
        check(Boolean(document.querySelector("#missing .lucide-link-2")), "custom original fallback is preserved");
        check(!document.querySelector("#internal img") && Boolean(document.querySelector("#internal .lucide-rocket")), "internal note keeps its custom icon and performs no favicon load");
        check(document.querySelector("#chat a")?.getAttribute("href") === url, "link destination is untouched");
        const serialize = createNotesMarkdownSerializer();
        check(serialize(editor.state.doc) === source, "editor Markdown is byte-identical");
        check(document.querySelectorAll("#editor [data-editor-link-icon]").length === 2, "formatted editor link has only one icon");
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        editor.commands.insertContent(" Added"); editor.commands.undo();
        check(serialize(editor.state.doc) === source, "typing and undo preserve Markdown");
        setChanging("/good.svg");
        await wait(() => loaded("#changing"), "source replacement loads");
        check(true, "failed image recovers when the source changes");
        setChanging("/missing.ico");
        await wait(() => fallback("#changing"), "source replacement fails");
        check(true, "a new failure restores the original fallback");
        const events: string[] = [];
        const listener = (event: Event) => events.push((event as CustomEvent<string>).detail);
        window.addEventListener("ai-chat:open-browser", listener);
        document.querySelector<HTMLAnchorElement>("#chat a")!.click();
        window.removeEventListener("ai-chat:open-browser", listener);
        check(events[0] === url, "normal web-link click still uses the Metis browser");
        document.querySelector<HTMLElement>("#preview a")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        await wait(() => loaded("[role=tooltip]"), "hover favicon");
        check(true, "hover preview uses the same favicon and fallback behavior");
        document.querySelector<HTMLElement>("#preview a")!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
        check(document.documentElement.scrollWidth <= innerWidth, "layout does not overflow at " + innerWidth + "px");
      } catch (error) { results.push("FAIL " + String(error)); setReport([...results]); }
      await fetch("/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ width: innerWidth, checks: results, failed: results.filter(line => line.startsWith("FAIL")), chatHtml: document.querySelector("#chat")?.innerHTML, diagnostics: Array.from(document.querySelectorAll<HTMLImageElement>("main img")).map(img => ({src: img.currentSrc || img.src, complete: img.complete, width: img.naturalWidth, box: img.getBoundingClientRect().toJSON(), parent: img.parentElement?.outerHTML})) }) });
    })();
  }, [editor]);
  return <main className="mx-auto max-w-3xl space-y-5 p-5 text-sm">
    <h1 className="text-xl font-medium">Website link icons</h1>
    <section><h2 className="text-muted-foreground">Chat</h2><p id="chat"><RichUserText content={"[Website](" + url + ")"} /></p></section>
    <section><h2 className="text-muted-foreground">Markdown and source citation</h2>
      <div id="markdown"><Markdown content={"[Website](" + url + ")"} /></div>
      <div id="citation"><Markdown content={"[Source: Website](" + url + ")"} /></div>
    </section>
    <section><h2 className="text-muted-foreground">Notes · Canvas · Plans editor</h2><div id="editor" className="notes-block-editor"><EditorLinkIcons editor={editor}/><EditorContent editor={editor}/></div></section>
    <p id="reference"><ReferenceLink reference={{ kind: "browser", id: "fixture", label: "Browser reference", path: url }}/></p>
    <p id="internal"><LinkIcon href="note://fixture" icon="lucide:rocket:#f97316"/>Internal note icon stays</p>
    <section className="space-y-2"><h2 className="text-muted-foreground">Image loading and error states</h2>
      <p id="transparent" className="flex items-center gap-2"><WebsiteIcon src="/good.svg"/>Transparent favicon</p>
      <p id="root-icon" className="flex items-center gap-2"><WebsiteIcon src="/favicon.ico"/>Origin favicon</p>
      <p id="missing" className="flex items-center gap-2"><WebsiteIcon src="/missing.ico" fallback={<Link2 className="size-full"/>}/>Missing favicon</p>
      <p id="invalid" className="flex items-center gap-2"><WebsiteIcon src="/invalid.ico"/>Invalid image</p>
      <p id="empty" className="flex items-center gap-2"><WebsiteIcon/>No favicon</p>
      <p id="changing" className="flex items-center gap-2"><WebsiteIcon src={changing}/>Source changes</p>
    </section>
    <p id="preview"><LinkPreview href={url}><a href={url}><LinkIcon href={url}/>Hover preview</a></LinkPreview></p>
    <pre id="results" className="whitespace-pre-wrap break-words text-xs">{report.join("\n")}</pre>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
