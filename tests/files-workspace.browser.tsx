import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { loader } from "@monaco-editor/react";
import { FileExplorerSearch } from "@/components/file-explorer-search";
import { EditedFiles } from "@/components/edited-files";
import { EditedFileEditorDiff } from "@/components/edited-file-diff";
import { editedFilesForMessage } from "@/lib/edited-files";
import type { EditedFileDiffRequest } from "@/lib/edited-file-diff";
import type { ToolPart } from "@/lib/store";
import type { WorkspaceFileLocation } from "@/lib/workspace-file-link";

loader.config({ paths: { vs: "/monaco/vs" } });
const monaco = loader.init();
const root = "/fixture";
const path = root + "/example.txt";
const lines = Array.from({ length: 240 }, (_, i) => "original line " + (i + 1));
const snap = (lines: string[]) => lines.join("\n") + "\n";
const first = lines.with(129, "first change at 130");
const second = first.with(174, "second change at 175").with(201, "second change at 202");
const third = second.toSpliced(217, 1);
const tool = (id: string, before?: string[], after?: string[]): ToolPart => ({
  id, name: "edit_file", status: "completed", editedFile: { path, target: "server" },
  ...(before && after ? { diff: { before: snap(before), after: snap(after) } } : {}),
});
const tools = [tool("unknown"), tool("first", lines, first), tool("second", first, second), tool("deletion", second, third)];
const files = editedFilesForMessage({ tools });
const names = [".env", ".hidden/.env.binary", ".env.large"];
const group = (type: string, entries: object[], skipped = {}) => ({
  type, root, pattern: ".env", count: entries.length, [type === "file_search" ? "files" : "matches"]: entries,
  truncated: false, skipped,
});
const nameSearch = group("file_search", names.map(path => ({ path, absolutePath: root + "/" + path })));
const contentSearch = group("text_search", [], { binary: 1, oversized: 1 });

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (input === "/api/remote") {
    const request = JSON.parse(String(init?.body));
    if (request.path !== root || request.query !== ".env") return Response.json({ error: "Unexpected test query" }, { status: 400 });
    return Response.json(request.searchMode === "files" ? { search: nameSearch } : { search: contentSearch, fileNames: nameSearch });
  }
  return nativeFetch(input, init);
};
const recorded = new Set<string>();
function report(check: string) {
  if (recorded.has(check)) return;
  recorded.add(check);
  void fetch("/report", { method: "POST", body: check });
}

function App() {
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState("");
  const [jump, setJump] = useState("");
  const [review, setReview] = useState<(EditedFileDiffRequest & { id: number }) | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const { diff } = (event as CustomEvent<{ diff: EditedFileDiffRequest }>).detail;
      setReview(previous => ({ ...diff, id: (previous?.id ?? 0) + 1 }));
      setJump("");
    };
    window.addEventListener("ai-chat:open-file", open);
    return () => window.removeEventListener("ai-chat:open-file", open);
  }, []);
  useEffect(() => {
    if (!review) return;
    const timer = window.setInterval(() => void monaco.then(api => {
      const diff = api.editor.getDiffEditors()[0];
      const current = document.querySelector<HTMLSelectElement>("[aria-label='Edit version']")?.value;
      const expected = current === "first" ? 130 : current === "second" ? review.focus?.range.startLine ?? 175 : current === "deletion" ? 218 : 0;
      if (!diff || !expected) return;
      const original = diff.getOriginalEditor();
      const modified = diff.getModifiedEditor();
      const side = current === "deletion" ? original : modified;
      const inline = !diff.getContainerDomNode().querySelector(".monaco-diff-editor.side-by-side");
      const visible = (inline ? modified : side).getVisibleRanges().some((r: { startLineNumber: number; endLineNumber: number }) => r.startLineNumber <= expected && r.endLineNumber >= expected);
      const selected = side.getSelection()?.startLineNumber === expected;
      if (visible && (selected || current === "deletion" && inline) && (inline ? modified : side).getScrollTop() > 0) {
        const marker = `JUMP ${current} L${expected} ${inline ? "inline" : "split"}`;
        setJump(marker);
        report(marker);
      }
    }), 150);
    return () => window.clearInterval(timer);
  }, [review]);
  useEffect(() => {
    const results = document.querySelector("[data-search-results]");
    if (!results) return;
    const capture = () => {
      if (results.getAttribute("aria-busy") === "true" || results.querySelectorAll("button[title^='.']").length !== 3) return;
      const inContents = Boolean(results.querySelector("[aria-label='File name matches']"));
      if (inContents && !results.textContent?.includes("0 content matches")) return;
      report(inContents ? "CONTENT NAME MATCHES" : "FILES NAME MATCHES");
    };
    const observer = new MutationObserver(capture);
    observer.observe(results, { attributes: true, subtree: true, childList: true });
    capture();
    return () => observer.disconnect();
  }, [query]);
  return <main className="mx-auto grid max-w-6xl gap-4 p-4 sm:grid-cols-[230px_minmax(0,1fr)]">
    <aside className="min-w-0 rounded-md border border-border">
      <FileExplorerSearch directory={root} query={query} onQueryChange={setQuery} disabled={false} revision={0}
        onOpen={({ path }: WorkspaceFileLocation) => { setOpened(path); if (path === root + "/.env") report("DOTFILE OPEN"); }} />
      {opened ? <output className="block p-2 text-xs">Opened {opened}</output> : null}
    </aside>
    <section className="min-w-0">
      <EditedFiles files={files} tools={tools} />
      {review ? <div className="h-[290px] rounded-md border border-border"><EditedFileEditorDiff key={review.id} {...review} language="plaintext" /></div> : null}
      <output className="block py-2 text-xs">{jump}</output>
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
