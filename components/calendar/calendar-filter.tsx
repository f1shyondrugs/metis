"use client";

import {useLayoutEffect, useRef, useState, type ReactNode} from "react";
import {CalendarDays, ChevronDown} from "lucide-react";
import {Button} from "@/components/ui/button";
import {DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem} from "@/components/ui/dropdown-menu";
import type {CalendarGroup} from "@/lib/calendar/types";

export function CalendarFilter({calendars, hidden, onToggle, children}: {
  calendars: CalendarGroup[];
  hidden: string[];
  onToggle: (id: string, visible: boolean) => void;
  children?: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useLayoutEffect(() => {
    const host = container.current, row = measure.current;
    if (!host || !row) return;
    // Measure the natural single-row layout, never the collapsed trigger itself.
    // This lets resizing, font changes and sync-discovered calendars switch both ways.
    const update = () => setCollapsed(row.getBoundingClientRect().width > host.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  const selected = calendars.filter(c => !hidden.includes(c.id)).length;
  function choices(measuring = false) {
    return calendars.map(c => <label key={c.id} className="flex min-h-8 shrink-0 items-center gap-2 text-xs">
      <input type="checkbox" checked={!hidden.includes(c.id)} tabIndex={measuring ? -1 : undefined} disabled={measuring} onChange={e => onToggle(c.id, e.target.checked)}/>
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{backgroundColor:c.color}}/>
      <span className="max-w-44 truncate" title={c.name}>{c.name}{c.readOnly ? " · Read only" : ""}</span>
    </label>);
  }

  return <div className="shrink-0 border-b border-border px-4 py-2">
    <div ref={container} className="relative min-w-0" data-calendar-filter={collapsed ? "dropdown" : "inline"}>
      <div aria-hidden="true" inert className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
        <div ref={measure} className="flex w-max items-center gap-4">{choices(true)}{children}</div>
      </div>
      <div className="flex min-h-8 min-w-0 items-center gap-4">
        {collapsed ? <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" className="h-8 shrink-0 gap-2 text-xs pointer-coarse:h-11" aria-label="Choose calendars">
            <CalendarDays aria-hidden="true" className="size-3.5"/>Calendars
            <span className="text-muted-foreground">{selected}/{calendars.length}</span>
            <ChevronDown aria-hidden="true" className="size-3.5"/>
          </Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-72 max-w-[calc(100vw-2rem)]" aria-label="Visible calendars">
            {calendars.map(c => <DropdownMenuCheckboxItem key={c.id} checked={!hidden.includes(c.id)}
              className="min-h-11 gap-2" onSelect={e => e.preventDefault()} onCheckedChange={checked => onToggle(c.id, checked === true)}>
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{backgroundColor:c.color}}/>
              <span className="min-w-0 whitespace-normal break-words">{c.name}{c.readOnly ? <span className="block text-xs text-muted-foreground">Read only</span> : null}</span>
            </DropdownMenuCheckboxItem>)}
          </DropdownMenuContent>
        </DropdownMenu> : choices()}
        <div className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{children}</div>
      </div>
    </div>
  </div>;
}
