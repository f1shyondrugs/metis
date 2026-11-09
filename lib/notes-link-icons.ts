import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";

/** Widgets are outside document content: undo, copy and Markdown stay byte-identical. */
export function linkIconDecorations(doc: Node) {
  const widgets: Decoration[] = [];
  let previousEnd = -1, previousHref = "";
  doc.descendants((node, pos) => {
    if (!node.isInline) return;
    const href = node.marks.find(mark => mark.type.name === "link")?.attrs.href;
    if (typeof href === "string" && href && (previousEnd !== pos || previousHref !== href)) {
      widgets.push(Decoration.widget(pos, () => {
        const host = document.createElement("span");
        host.dataset.editorLinkIcon = href;
        host.setAttribute("aria-hidden", "true");
        host.contentEditable = "false";
        return host;
      }, { side: -1, key: pos + ":" + href, marks: node.marks.filter(mark => mark.type.name === "link"), ignoreSelection: true }));
    }
    previousEnd = pos + node.nodeSize;
    previousHref = typeof href === "string" ? href : "";
  });
  return DecorationSet.create(doc, widgets);
}
export const NotesLinkIcons = Extension.create({
  name: "notesLinkIcons",
  addProseMirrorPlugins() {
    return [new Plugin({
      state: {
        init: (_, state) => linkIconDecorations(state.doc),
        apply: (transaction, previous) => transaction.docChanged ? linkIconDecorations(transaction.doc) : previous,
      },
      props: { decorations(state) { return this.getState(state); } },
    })];
  },
});
