"use client";

import { Menu, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CalendarPanel } from "@/components/calendar/calendar-panel";

/** A primary URL-backed workspace, independent of account pages and chat controls. */
export function CalendarWorkspace({ onOpenSidebar, onToggleSidebar, sidebarOpen }: {
  onOpenSidebar: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}) {
  return <div data-calendar-workspace="" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-2.5 border-b border-border/55 bg-background px-3.5 md:h-12 md:gap-2 md:px-4">
      <Button type="button" variant="ghost" size="icon" className="size-11 md:hidden" onClick={onOpenSidebar} aria-label="Open sidebar">
        <Menu className="size-[19px]" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="hidden size-8 md:inline-flex" onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
        <PanelLeft className="size-4" />
      </Button>
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title="Calendar">Calendar</h1>
    </header>
    <main aria-label="Calendar" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <CalendarPanel />
    </main>
  </div>;
}
