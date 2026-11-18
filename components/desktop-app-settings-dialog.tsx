"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, PlugZap, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import { DesktopClientSettings, type DesktopSettingsCategory } from "@/components/desktop-client-settings";
import { SettingsDialog } from "@/components/settings-dialog";
import { CustomSelect, SettingsTile } from "@/components/settings-navigation-controls";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const categories = [
  { value: "general", label: "General", description: "Version, updates and local preferences", icon: SlidersHorizontal },
  { value: "assistant", label: "Assistant", description: "Desktop Assistant and keyboard shortcuts", icon: Sparkles },
  { value: "connection", label: "Connection", description: "Pairing, server and system permissions", icon: PlugZap },
] as const;

export function DesktopAppSettingsDialog({ open, onOpenChange, mobile, returnFocus, onReplayOnboarding }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mobile: boolean;
  returnFocus: () => HTMLElement | null;
  onReplayOnboarding?: () => void;
}) {
  const replayPending = useRef(false);
  return (
    <SettingsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="App settings"
      description="Preferences for this device’s Metis app and Remote Client."
      fullscreen={mobile}
      returnFocus={returnFocus}
      onAfterClose={() => {
        if (!replayPending.current) return false;
        replayPending.current = false;
        onReplayOnboarding?.();
        return true;
      }}
    >
      <AppSettingsNavigation mobile={mobile} onReplay={onReplayOnboarding ? () => {
        replayPending.current = true;
        onOpenChange(false);
      } : undefined} />
    </SettingsDialog>
  );
}

function AppSettingsNavigation({ mobile, onReplay }: { mobile: boolean; onReplay?: () => void }) {
  const [category, setCategory] = useState<DesktopSettingsCategory>("general");
  const [showCategories, setShowCategories] = useState(true);
  const categoryId = useId();
  const backButton = useRef<HTMLButtonElement>(null);
  const categoryContent = useRef<HTMLDivElement>(null);
  useEffect(() => { if (categoryContent.current) categoryContent.current.scrollTop = 0; }, [category]);
  const categoryMenu = mobile && showCategories;
  const selected = categories.find(item => item.value === category)!;
  return (
    <section aria-label="Desktop app preferences" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-4 py-3 pr-12 sm:px-8 sm:py-4 sm:pr-12">
        <h2 className="text-sm font-semibold">App settings</h2>
        <p className="mt-1 text-xs text-muted-foreground">Preferences for this device’s Metis app and Remote Client.</p>
      </header>
      {categoryMenu ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <nav aria-label="App settings categories" className="divide-y divide-border/60">
            {categories.map(item => (
              <SettingsTile key={item.value} id={categoryId + item.value}
                title={item.label} meta={item.description} icon={item.icon}
                onOpen={() => {
                  setCategory(item.value);
                  setShowCategories(false);
                  requestAnimationFrame(() => backButton.current?.focus());
                }} />
            ))}
          </nav>
        </div>
      ) : (
        <Tabs orientation="vertical" value={category} onValueChange={value => setCategory(value as DesktopSettingsCategory)}
          className="min-h-0 flex-1 flex-col gap-0 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]">
          {mobile ? (
            <div className="shrink-0 border-b border-border px-4 py-1">
              <button ref={backButton} type="button" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => {
                  setShowCategories(true);
                  requestAnimationFrame(() => document.getElementById(categoryId + category)?.focus());
                }}>
                <ArrowLeft aria-hidden="true" className="size-4" /> Back to App settings
              </button>
            </div>
          ) : (
            <div className="shrink-0 border-b border-border px-4 py-2 lg:hidden">
              <CustomSelect value={category} ariaLabel="App settings section" className="h-10 w-full"
                options={categories.map(({ value, label }) => ({ value, label }))}
                onValueChange={value => setCategory(value as DesktopSettingsCategory)} />
            </div>
          )}
          <TabsList aria-label="App settings categories" className="hidden h-full min-h-0 w-full items-stretch justify-start gap-1.5 overflow-y-auto rounded-none border-r border-border bg-muted/20 px-3 py-4 lg:flex lg:h-full!">
            {categories.map(item => (
              <TabsTrigger key={item.value} value={item.value}
                className="min-h-10 flex-none justify-start px-2.5 py-2.5 pl-4 has-data-[icon=inline-start]:pl-4 lg:h-auto">
                <item.icon data-icon="inline-start" aria-hidden="true" /> {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent ref={categoryContent} value={category} aria-label={selected.label}
            className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 py-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-8 sm:py-5">
            <h3 className="mb-4 text-sm font-semibold">{selected.label}</h3>
            <DesktopClientSettings category={category} />
          </TabsContent>
        </Tabs>
      )}
      {onReplay ? (
        <footer className="flex shrink-0 justify-end border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8">
          <Button variant="outline" size="action" onClick={onReplay}><RotateCcw aria-hidden="true" />Replay onboarding</Button>
        </footer>
      ) : null}
    </section>
  );
}
