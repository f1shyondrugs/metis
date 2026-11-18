"use client";

import { ReferenceResultIcon, ReferenceResultMetadata } from "./reference-appearance";
import { AutomationIcon } from "./automation-icon";
import { PickerFrame, PickerRow, pickerOptionId } from "./picker-frame";
import type { KeyboardEvent, Ref } from "react";
import { CalendarDays, Brain, ClipboardList, File as FileIcon, MessageSquare, Palette, PanelRight, Puzzle, StickyNote, Terminal } from "lucide-react";
import { REFERENCE_KINDS, type ReferenceKind, type ReferenceResult } from "@/lib/reference-search";
import { REFERENCE_SHORTCUTS } from "@/lib/reference-query";

export const referenceLabel = (kind: ReferenceKind) => ({
  file: "Files", canvas: "Canvases", plan: "Plans", note: "Notes", issue: "Issues", browser: "Browser",
  terminal: "Terminals", memory: "Memories", chat: "Chats", "calendar-event": "Calendar events", automation: "Automations", skill: "Skills",
})[kind];
export const referenceIcon = (kind: ReferenceKind) => ({
  file: FileIcon, canvas: Palette, plan: ClipboardList, note: StickyNote, issue: ClipboardList, browser: PanelRight,
  terminal: Terminal, memory: Brain, chat: MessageSquare, "calendar-event": CalendarDays, automation: AutomationIcon, skill: Puzzle,
})[kind];

export function ReferencePicker({ id, rootRef, inputRef, kind, query, results, loading, indexing, notice, error, retry,
  index, onIndex, onCategory, onQuery, onSelect, onKeyDown, optionIdPrefix = id,
}: {
  id: string; optionIdPrefix?: string; rootRef?: Ref<HTMLDivElement>; inputRef?: Ref<HTMLInputElement>; kind: ReferenceKind | null;
  query: string; results: readonly ReferenceResult[]; loading: boolean; indexing: boolean; notice?: string; error?: string;
  retry: () => void; index: number; onIndex: (index: number) => void; onCategory: (kind: ReferenceKind | null) => void;
  onQuery: (query: string) => void; onSelect: (item: ReferenceResult) => void; onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const categories = !kind && !query.trim();
  const scope = kind ? referenceLabel(kind) : undefined;
  const count = categories ? REFERENCE_KINDS.length : !loading && !error ? results.length : 0;
  return <PickerFrame id={id} optionIdPrefix={optionIdPrefix} rootRef={rootRef} inputRef={inputRef}
    title={scope ? "Search " + scope.toLowerCase() : "Search context"} label="Context references" scope={scope} loading={loading}
    query={query} index={index} count={count} onQuery={onQuery} onKeyDown={onKeyDown}
    onBack={categories ? undefined : () => onCategory(null)}
    footer={<>
      {indexing && results.length > 0 ? <p role="status" className="px-2.5 py-2 text-xs text-muted-foreground">Preparing more results…</p> : null}
      {notice ? <p role="status" className="px-2.5 py-2 text-xs text-muted-foreground">{notice} <button type="button" className="underline" onMouseDown={event => event.preventDefault()} onClick={retry}>Try again</button></p> : null}
    </>}>
    {categories ? REFERENCE_KINDS.map((category, position) => {
      const Icon = referenceIcon(category);
      return <PickerRow key={category} id={pickerOptionId(optionIdPrefix, position)} highlighted={position === index}
        label={referenceLabel(category)} shortcut={"@" + REFERENCE_SHORTCUTS[category]}
        icon={<Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        onHighlight={() => onIndex(position)} onSelect={() => onCategory(category)} />;
    }) : loading ? <p role="status" className="px-2.5 py-4 text-center text-xs text-muted-foreground">Searching…</p>
      : error ? <div role="alert" className="px-2.5 py-3 text-xs"><p>{error}</p><button type="button" className="mt-2 underline underline-offset-2" onMouseDown={event => event.preventDefault()} onClick={retry}>Try again</button></div>
      : results.length ? results.map((item, position) => <PickerRow
        key={[item.kind, item.id, item.chatId || ""].join(":")} id={pickerOptionId(optionIdPrefix, position)} highlighted={position === index}
        label={item.label} icon={<ReferenceResultIcon item={item} />} badge={item.isCurrentChat ? "In this chat" : undefined}
        detail={item.detail || item.project || item.calendar ? <ReferenceResultMetadata item={item} /> : undefined}
        onHighlight={() => onIndex(position)} onSelect={() => onSelect(item)} />)
      : <p role="status" className="px-2.5 py-4 text-center text-xs text-muted-foreground">{indexing ? "Preparing more results…" : notice ? "Search is incomplete." : query ? "No matching references." : "No " + (scope || "references").toLowerCase() + " available."}</p>}
  </PickerFrame>;
}
