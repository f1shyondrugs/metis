"use client";

import {AutomationIcon} from "./automation-icon";
import {Button} from "@/components/ui/button";
import {chatCardStyles} from "@/components/chat-card-styles";

export type AutomationCardProps = {
  actionLabel: string;
  title: string;
  icon?: string | null;
  prompt?: string;
  scheduleLabel?: string;
  automationLink?: string;
  onOpen?: () => void;
};

export function AutomationCard({actionLabel,title,icon,prompt,scheduleLabel,onOpen}:AutomationCardProps) {
  return <section data-chat-card="automation" className={chatCardStyles.frame}>
    <header className={chatCardStyles.header}>
      <span className={chatCardStyles.icon}><AutomationIcon value={icon} className="size-4"/></span>
      <div className="min-w-0 flex-1">
        <div className={chatCardStyles.metadata}><span className="font-medium">{actionLabel}</span></div>
        <h3 data-chat-card-title className={chatCardStyles.title}>{title}</h3>
      </div>
    </header>
    <div className="border-y border-border bg-background px-4 py-3">
      <p data-chat-card-description className="max-h-20 overflow-hidden whitespace-pre-wrap break-words text-sm text-foreground">{prompt || "No automation details available yet."}</p>
      {scheduleLabel?<div className="mt-2 text-xs text-muted-foreground">{scheduleLabel}</div>:null}
    </div>
    {onOpen?<footer className={chatCardStyles.footer+" justify-end"}>
      <Button type="button" size="action" variant="outline" onClick={onOpen}><AutomationIcon value={icon} className="size-4"/>Open automation</Button>
    </footer>:null}
  </section>;
}
