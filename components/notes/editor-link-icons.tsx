"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { LinkIcon } from "@/components/link-icon";

/** Portals retain the caller's authenticated/public context without editing ProseMirror DOM. */
export function EditorLinkIcons({ editor, resolveUrl }: {
  editor: Editor | null; resolveUrl?: (url: string, kind: "image" | "link") => string;
}) {
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const update = () => {
      const next = Array.from(dom.querySelectorAll<HTMLElement>("[data-editor-link-icon]"));
      setHosts(previous => previous.length === next.length && previous.every((host, index) => host === next[index]) ? previous : next);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(dom, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [editor]);
  return hosts.map((host, index) => {
    const href = host.dataset.editorLinkIcon || "";
    return createPortal(<LinkIcon href={resolveUrl?.(href, "link") || href} />, host, String(index));
  });
}
