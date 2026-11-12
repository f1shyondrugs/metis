"use client";

import { LinkIcon } from "@/components/link-icon";
import { LinkPreview } from "@/components/link-preview";
import { FileLink } from "@/components/file-link";
import { internalLinkNavigation, parseInternalLink } from "@/lib/internal-link";
import { parseWorkspaceFileLink } from "@/lib/workspace-file-link";
import { isFileUrl } from "@/lib/file-types";
import { parseRichUserText } from "@/lib/user-text-links";
import { ReferenceLink } from "@/components/reference-link";
import { parseReferenceLink } from "@/lib/reference-link";
import type { ReferenceResult } from "@/lib/reference-search";
import { ExternalLink } from "lucide-react";
import { memo, useEffect, useState } from "react";

type Reference = {
  kind?: string;
  id?: string;
  label: string;
  chatId?: string;
  path?: string;
  sessionId?: string;
  target?: string;
  detail?: string;
};

function dispatchInternalLink(href: string) {
  const target = parseInternalLink(href);
  if (!target) return false;
  const navigation = internalLinkNavigation(target);
  window.dispatchEvent(new CustomEvent(navigation.event, { detail: navigation.detail }));
  return true;
}

function RichLink({ href, children, ...props }: { href: string; children: string; "aria-describedby"?: string }) {
  const [hovered, setHovered] = useState(false);
  const [modifierHeld, setModifierHeld] = useState(false);
  const internal = Boolean(parseInternalLink(href));
  useEffect(() => {
    if (!hovered || internal) return;
    const update = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") setModifierHeld(true);
    };
    const clear = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") setModifierHeld(false);
    };
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", clear);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", clear);
    };
  }, [hovered, internal]);
  return (
    <a
      {...props}
      href={href}
      className="inline-flex items-center underline underline-offset-2 hover:text-primary"
      onMouseEnter={(event) => {
        setHovered(true);
        setModifierHeld(event.ctrlKey || event.metaKey);
      }}
      onMouseLeave={() => {
        setHovered(false);
        setModifierHeld(false);
      }}
      onClick={(event) => {
        event.preventDefault();
        if (dispatchInternalLink(href)) return;
        if (event.ctrlKey || event.metaKey) {
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
        window.dispatchEvent(new CustomEvent("ai-chat:open-browser", { detail: href }));
      }}
    >
      <LinkIcon href={href} />{children}
      {hovered && modifierHeld && !internal ? (
        <ExternalLink className="ml-1 size-3.5 animate-in fade-in text-muted-foreground" aria-label="Ctrl-click opens in a new tab" />
      ) : null}
    </a>
  );
}

export const RichUserText = memo(function RichUserText({
  content,
  references = [],
}: {
  content: string;
  references?: Reference[];
}) {
  const labels = references
    .map((reference) => reference.label.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const parts = parseRichUserText(content, labels);

  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "mention") {
          const reference = references.find(
            (item) => `@${item.label.trim()}` === part.text,
          );
          return reference?.kind && reference.id
            ? <ReferenceLink key={index} reference={reference as ReferenceResult}>{part.text}</ReferenceLink>
            : <span key={index}>{part.text}</span>;
        }
        if (part.kind === "link") {
          const reference=parseReferenceLink(part.href);
          if(reference)return <ReferenceLink key={index} reference={reference}>{part.label}</ReferenceLink>;
          if (parseWorkspaceFileLink(part.href) || isFileUrl(part.href)) {
            return <FileLink key={`${part.href}-${index}`} href={part.href}>{part.label}</FileLink>;
          }
          return <LinkPreview key={`${part.href}-${index}`} href={part.href}>
            <RichLink href={part.href}>{part.label}</RichLink>
          </LinkPreview>;
        }
        return <span key={`${part.text}-${index}`}>{part.text}</span>;
      })}
    </>
  );
});
