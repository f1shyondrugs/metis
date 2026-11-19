/** Actual Notebook UI with isolated API + collaboration routes supplied by the preview. */
import { createRoot } from "react-dom/client";
import { NotesWorkspace } from "@/components/notes/notes-workspace";

const source = await fetch("/fixture").then(response => response.json()) as { existing: string; book: string };
const open = (id: string) => window.dispatchEvent(new CustomEvent("ai-chat:open-note", { detail: { id } }));
function Fixture() {
  return <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
    <div className="flex shrink-0 items-center gap-3 border-b border-border p-2 text-xs">
      <button type="button" onClick={() => open(source.existing)}>Open fixture note</button>
      <button type="button" onClick={() => open(source.book)}>Open fixture issuebook</button>
    </div>
    <div className="min-h-0 flex-1"><NotesWorkspace /></div>
  </div>;
}
const title = () => document.querySelector<HTMLInputElement>("[data-note-title]")?.value || "";
function report(marker: string) {
  void fetch("/report", { method: "POST", body: marker });
}
document.addEventListener("focusin", event => {
  if ((event.target as HTMLElement).matches(".notes-prosemirror[contenteditable=true]")) report("FOCUS " + title());
});
const observed = new Set<string>();
new MutationObserver(() => {
  const name = title();
  if (!["Open fixture note", "Delayed focus"].includes(name) || observed.has(name) || !document.querySelector(".notes-prosemirror")) return;
  observed.add(name);
  setTimeout(() => {
    if (title() === name && !document.activeElement?.matches(".notes-prosemirror")) report("NO FOCUS " + name);
  }, 120);
}).observe(document.getElementById("root")!, { childList: true, subtree: true });
createRoot(document.getElementById("root")!).render(<Fixture />);
