"use client";

import {useEffect, useId, useMemo, useRef, useState} from "react";
import {ArrowUpRight, Search, X} from "lucide-react";
import {Input} from "@/components/ui/input";
import {Popover, PopoverAnchor, PopoverContent} from "@/components/ui/popover";
import {searchSettings, settingsSearchEntries, type SettingsSearchEntry} from "@/lib/settings-navigation";
import {cn} from "@/lib/utils";

export function SettingsSearch({isHostAdmin, onSelect}: {
  isHostAdmin: boolean;
  onSelect: (entry: SettingsSearchEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const entries = useMemo(() => settingsSearchEntries(isHostAdmin), [isHostAdmin]);
  const results = useMemo(() => searchSettings(entries, query), [entries, query]);
  const showingResults = open && Boolean(query.trim());
  const activeResult = results[activeIndex];

  useEffect(() => {
    if (showingResults && activeResult) {
      document.getElementById(listId + "-" + activeResult.id)?.scrollIntoView({block: "nearest"});
    }
  }, [showingResults, activeResult, listId]);

  function select(entry: SettingsSearchEntry) {
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
    onSelect(entry);
  }

  return (
    <Popover open={showingResults} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative mt-4">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={input}
            type="search"
            value={query}
            placeholder="Search settings…"
            aria-label="Search settings"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showingResults}
            aria-controls={showingResults ? listId : undefined}
            aria-activedescendant={showingResults && activeResult ? listId + "-" + activeResult.id : undefined}
            autoComplete="off"
            className="h-11 pl-9 pr-11 sm:h-10 [&::-webkit-search-cancel-button]:appearance-none"
            onFocus={() => setOpen(true)}
            onChange={event => {setQuery(event.target.value); setActiveIndex(0); setOpen(true);}}
            onKeyDown={event => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
                setOpen(false);
              } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length) {
                event.preventDefault();
                setOpen(true);
                setActiveIndex(index => (index + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
              } else if (event.key === "Enter" && showingResults && activeResult) {
                event.preventDefault();
                select(activeResult);
              } else if (event.key === "Tab") {
                setOpen(false);
              }
            }}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear settings search"
              className="absolute right-0 top-0 flex h-full w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => {setQuery(""); setOpen(false); input.current?.focus();}}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
      </PopoverAnchor>
      {showingResults ? <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) gap-0 p-1"
        style={{maxWidth: "var(--radix-popover-content-available-width)"}}
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}
        onInteractOutside={event => {if (event.target instanceof Node && input.current?.parentElement?.contains(event.target)) event.preventDefault();}}
        onEscapeKeyDown={event => {event.preventDefault(); event.stopPropagation(); setQuery(""); setOpen(false); input.current?.focus();}}
      >
        <p className="sr-only" role="status" aria-live="polite">{results.length} settings found</p>
        {results.length ? (
          <div id={listId} role="listbox" aria-label="Settings search results" className="max-h-[min(22rem,var(--radix-popover-content-available-height))] overflow-y-auto">
            {results.map((entry, index) => (
              <button
                key={entry.id}
                id={listId + "-" + entry.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                className={cn("flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted", index === activeIndex && "bg-muted")}
                onPointerMove={() => setActiveIndex(index)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => select(entry)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{entry.label}</span>
                  <span className="block text-xs text-muted-foreground">{entry.category}</span>
                </span>
                <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        ) : (
          <p role="status" className="px-3 py-4 text-sm text-muted-foreground">No settings found. Try another search.</p>
        )}
      </PopoverContent> : null}
    </Popover>
  );
}
