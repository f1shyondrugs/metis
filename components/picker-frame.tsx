"use client";

import { ArrowLeft, Check, Search } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type Ref, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export const composerPickerSurfaceClass = "absolute bottom-full left-2 right-2 z-40 mb-2 max-h-[min(18rem,45dvh)] overflow-y-auto overscroll-contain rounded-xl border border-border/60 bg-popover p-1.5 text-sm shadow-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200";
export const pickerOptionId = (prefix: string, index: number) => prefix + "-option-" + index;

export function PickerFrame({ id, optionIdPrefix = id, rootRef, inputRef, query, index, count, label, title, scope,
  loading, onBack, backLabel = "All categories", onQuery, onKeyDown, numeric, children, footer }: {
  id: string; optionIdPrefix?: string; rootRef?: Ref<HTMLDivElement>; inputRef?: Ref<HTMLInputElement>;
  query: string; index: number; count: number; label: string; title: string; scope?: string; loading?: boolean;
  onBack?: () => void; backLabel?: string; onQuery: (query: string) => void; onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  numeric?: boolean; children: ReactNode; footer?: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const surface = listRef.current?.closest<HTMLElement>("[data-composer-picker]");
    const option = document.getElementById(pickerOptionId(optionIdPrefix, index));
    if (!surface || !option || !listRef.current?.contains(option)) return;
    const bounds = surface.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    const top = headerRef.current?.getBoundingClientRect().bottom ?? bounds.top;
    if (row.bottom > bounds.bottom) surface.scrollTop += row.bottom - bounds.bottom;
    else if (row.top < top) surface.scrollTop -= top - row.top;
  }, [count, index, optionIdPrefix, query, scope]);

  return <div ref={rootRef} className="reference-picker text-sm">
    <div ref={headerRef} className="sticky top-0 z-10 -mx-1.5 -mt-1.5 mb-1 flex items-center gap-1 border-b border-border/50 bg-popover px-2 py-1.5">
      {onBack ? <button type="button" aria-label={backLabel} title={backLabel} className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onMouseDown={event => event.preventDefault()} onClick={onBack}><ArrowLeft className="size-4" aria-hidden="true"/></button>
        : <Search className="mx-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>}
      <input ref={inputRef} type={numeric ? "text" : "search"} inputMode={numeric ? "numeric" : "search"} role="combobox" aria-expanded="true"
        aria-label={title} placeholder={title + "…"} value={query} aria-autocomplete={numeric ? "none" : "list"} aria-controls={id}
        aria-activedescendant={index >= 0 && index < count ? pickerOptionId(optionIdPrefix, index) : undefined}
        className="h-9 min-w-0 flex-1 rounded-md bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/50"
        onKeyDown={onKeyDown} onChange={event => onQuery(event.target.value)} />
      {scope ? <span className="max-w-[36%] truncate pr-1 text-[11px] text-muted-foreground">{scope}</span> : null}
    </div>
    <div ref={listRef} id={id} role="listbox" aria-label={label} aria-busy={loading} className="flex flex-col gap-0.5">{children}</div>
    {footer}
  </div>;
}

export function PickerRow({ id, highlighted, label, icon, shortcut, badge, detail, checked, disabled, onHighlight, onSelect }: {
  id: string; highlighted: boolean; label: string; icon?: ReactNode; shortcut?: string; badge?: string; detail?: ReactNode;
  checked?: boolean; disabled?: boolean; onHighlight: () => void; onSelect: () => void;
}) {
  return <button id={id} role="option" type="button" tabIndex={-1} aria-selected={highlighted} aria-disabled={disabled || undefined}
    aria-label={label} aria-describedby={detail ? id + "-detail" : undefined}
    className={cn("flex min-h-9 max-sm:min-h-11 w-full gap-2 rounded-lg px-2.5 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring",
      detail ? "items-start" : "items-center", highlighted ? "bg-muted" : "hover:bg-muted/60", disabled && "opacity-55")}
    title={label} onMouseDown={event => event.preventDefault()} onMouseEnter={onHighlight} onClick={() => { if (!disabled) onSelect(); }}>
    {icon}
    <span className="min-w-0 flex-1">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-xs text-foreground">{label}</span>
        {badge ? <span className="shrink-0 rounded bg-secondary px-1.5 text-[10px] text-secondary-foreground">{badge}</span> : null}
      </span>
      {detail ? <span id={id + "-detail"} className="block min-w-0">{detail}</span> : null}
    </span>
    {checked ? <Check aria-label="Current selection" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : null}
    {shortcut ? <span className="shrink-0 text-[11px] text-muted-foreground">{shortcut}</span> : null}
  </button>;
}
