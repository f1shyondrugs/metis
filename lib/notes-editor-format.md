# Notes editor Markdown contract

Notes persist one Markdown string. Opening and saving a document without semantic changes preserves the original string, including line endings, whitespace and unsupported source. Editing a block serializes that block while retaining untouched sibling source and separators.

Standard paragraphs, headings, lists, tasks, quotes, rules, code, links, inline images, simple GFM tables and LaTeX math use CommonMark/GFM/math Markdown. Mermaid, chart, graph and file fences remain atomic blocks with a preview and an explicit source editor. Unknown HTML, reference definitions and unsupported syntax remain source blocks.

Rich containers (toggleBlock, callout, columns, pageReference, embedBlock and tableOfContents) use a fenced code block whose info string is metis-block. The body is one JSON editor node. The same envelope preserves underline, text colors and highlights, explicit empty blocks, multiline headings, or a table whose widths, headers or spans cannot be represented as a simple GFM table. Nested content is part of the JSON node. The shared Metis Markdown renderer displays these blocks through a safe, read-only React preview. This keeps the persisted content inspectable; generic Markdown readers show the JSON source.

Changed blocks are checked against the editor schema after Markdown parsing. A block that Markdown cannot reproduce exactly (for example a final hard break or edited source block) uses the same rich envelope. Separately moved lists and quotations retain their block boundaries instead of merging after reload. Untouched source remains byte-identical; the server still rejects forged source metadata. Ordered-list types are limited to the native 1/a/A/i/I values.

An explicit block link persists a comment after its block: <!-- metis:block:IDENTIFIER -->.
Its link is metis://note/NOTE_ID#block-IDENTIFIER. Page references use a noteId and title in their envelope. Ordinary internal inline links accept [Title](note://NOTE_ID), metis://note/NOTE_ID and issue://ISSUE_ID.

The tableOfContents envelope requires attrs.version: 1. It derives heading links from the current document; headings are not stored as a stale snapshot. Unsupported future versions remain recoverable source blocks. /page creates a subpage, while /reference and /linkpage link an existing page.

Keyboard controls use Tiptap defaults: Ctrl/Command B/I/U, undo/redo, Markdown input rules, Tab/Shift Tab inside lists, and native Shift selection across blocks. Type / at the beginning of an empty paragraph for the insertion menu, use arrows and Enter to choose or Escape to dismiss. Ctrl/Command / opens block actions. Alt Shift Up/Down moves selected top-level blocks. Shift-click a block handle to extend a block selection. Drag a block handle to move a block.

A task converted to an issue first receives a persisted blockId. The issue callback receives {kind:"checkbox",sourceId} and returns {id,key}. The editor replaces the unchanged task with its issue link in one local transaction, preserving sibling tasks and nested content. If the task changes during creation, an explicit recovery action preserves the edits. Task lists carrying source IDs use the rich envelope so provenance survives reload. Selection issue IDs combine persisted block anchors, relative selection offsets and a text digest, so identical excerpts at different locations remain separate sources.

Attachments use the existing resumable background-upload queue and authenticated file API. Upload failures expose Retry and Cancel. An upload completing after navigation appends to its original page with the existing version-checked notes API.
