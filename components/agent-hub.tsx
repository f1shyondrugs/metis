"use client";
import { useState } from "react";
import { BookOpen, PlugZap, SlidersHorizontal, MessagesSquare } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SkillLibrary } from "@/components/skill-library";
import { HubConnections, HubModes } from "@/components/agent-hub-managers";
import { AgentRulesSettings } from "@/components/agent-rules-settings";
import type { SkillSettingsView } from "@/lib/skills";
const sections = [
  { id: "skills", label: "Skills", icon: BookOpen },
  { id: "connections", label: "Connections/MCPs", icon: PlugZap },
  { id: "modes", label: "Modes", icon: SlidersHorizontal },
  { id: "rules", label: "Rules", icon: MessagesSquare },
];
export function AgentHub({ isHostAdmin, onModesChanged, onTrySkill, initialSkillId }: {
  initialSkillId?: string; isHostAdmin: boolean; onModesChanged: () => void; onTrySkill: (skill: SkillSettingsView) => void;
}) {
  const [section, setSection] = useState("skills");
  return <section aria-label="Agent Hub" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <Tabs value={section} onValueChange={setSection} className="min-h-0 flex-1 gap-0 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)]">
        <TabsList aria-label="Agent Hub sections" className="h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-muted/20 p-2 lg:h-full lg:flex-col lg:items-stretch lg:justify-start lg:border-b-0 lg:border-r lg:p-3">
          {sections.map(item => <TabsTrigger key={item.id} value={item.id} className="min-h-11 shrink-0 gap-2 px-3 lg:h-auto lg:flex-none lg:justify-start"><item.icon className="hidden size-4 sm:block" /><span>{item.label}</span></TabsTrigger>)}
        </TabsList>
        <div role="tabpanel" aria-label={sections.find(item => item.id === section)?.label} className="flex min-h-0 min-w-0 flex-col overflow-y-auto">
          {section === "skills" ? <SkillLibrary initialSkillId={initialSkillId} onTry={onTrySkill} isHostAdmin={isHostAdmin} />
            : section === "connections" ? <HubConnections isHostAdmin={isHostAdmin} />
            : section === "modes" ? <HubModes onModesChanged={onModesChanged} />
            : <section className="space-y-5 p-5 sm:p-7"><div><h3 className="text-xl font-semibold">Agent rules</h3><p className="mt-1 text-sm text-muted-foreground">Instructions for how your agent responds across chats.</p></div><AgentRulesSettings /></section>}
        </div>
      </Tabs>
  </section>;
}
