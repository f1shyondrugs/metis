"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Compass, Download, Library, Plus, Puzzle, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SkillDetail } from "@/components/skill-detail";
import { SkillsSettings } from "@/components/skills-settings";
import type { SkillSettingsView } from "@/lib/skills";
import type { DirectorySkill } from "@/lib/skills-directory";
import { SharedSkillImport } from "@/components/shared-skill-import";

export function SkillLibrary({ onTry, isHostAdmin }: { onTry: (skill: SkillSettingsView) => void; isHostAdmin: boolean }) {
  const [skills, setSkills] = useState<SkillSettingsView[]>([]);
  const [catalog, setCatalog] = useState<DirectorySkill[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryNotice, setDirectoryNotice] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState("installed");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const load = useCallback(async (refresh = false) => {
    if (!refresh) setLoading(true);
    setError("");
    try {
      const responses = await Promise.all([fetch("/api/skills", { cache: "no-store" }), ...(!refresh ? [fetch("/api/skills/catalog", { cache: "no-store" })] : [])]);
      const bodies = await Promise.all(responses.map(response => response.json()));
      for (let i = 0; i < responses.length; i++) if (!responses[i].ok) throw new Error(bodies[i].error || "Could not load skill library.");
      setSkills(bodies[0].skills || []);
      if (!refresh) setCatalog(bodies[1].skills || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load skills."); }
    finally { if (!refresh) setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (view !== "discover") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setDirectoryLoading(true);setDirectoryNotice("");
      fetch("/api/skills/catalog?q=" + encodeURIComponent(query), {signal:controller.signal,cache:"no-store"}).then(async response=> {
        const body = await response.json();if (!response.ok) throw new Error(body.error || "Could not search skills.");
        setCatalog(body.skills || []);setDirectoryNotice(body.notice || (body.origin === "skills.sh" ? "Results from skills.sh" : "Featured skills · Search to explore skills.sh"));
      }).catch(e=>{if (!controller.signal.aborted)setDirectoryNotice(e.message);}).finally(()=>{if(!controller.signal.aborted)setDirectoryLoading(false);});
    }, 350);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[view,query]);
  async function update(id: string, flag: "enabledSkills" | "alwaysOnSkills", value: boolean) {
    try {
      const response = await fetch("/api/skills", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [flag]: { [id]: value } }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not update skill.");
      setSkills(body.skills || []);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Could not update skill."); }
  }
  async function install(skill: DirectorySkill) {
    setInstalling(skill.catalogId);
    try {
      const response = await fetch("/api/skills/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ catalogId: skill.catalogId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not install skill.");
      await load(true); toast.success("Skill installed");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Could not install skill."); }
    finally { setInstalling(null); }
  }
  const current = skills.find(skill => skill.id === selected);
  if (current) return <SkillDetail key={current.id} skill={current} onBack={() => setSelected(null)} onChange={update} onTry={onTry} />;
  const matching = (value: string) => query.toLowerCase().trim().split(/\s+/).every(term => value.toLowerCase().includes(term));
  const installed = skills.filter(skill => matching([skill.title, skill.description, skill.source, skill.category, ...(skill.tags || [])].join(" "))).sort((a, b) => a.id === "skill-creator" ? -1 : b.id === "skill-creator" ? 1 : a.title.localeCompare(b.title));
  const available = catalog;
  return <section className="min-w-0 overflow-auto p-5 sm:p-7" aria-label="Skill library">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-semibold">Skills</h3><p className="mt-1 text-sm text-muted-foreground">Reusable instructions, references and tools for your agent.</p></div><Button variant="outline" onClick={() => setView("import")}><Plus /> Add skill</Button></div>
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Tabs value={view} onValueChange={setView}>
        <TabsList>
          <TabsTrigger value="installed"><Library className="size-4" aria-hidden="true" />Installed</TabsTrigger>
          <TabsTrigger value="discover"><Compass className="size-4" aria-hidden="true" />Discover</TabsTrigger>
          <TabsTrigger value="import"><Download className="size-4" aria-hidden="true" />Import</TabsTrigger>
        </TabsList>
      </Tabs>
      {view !== "import" ? <div className="relative sm:w-64"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" /><Input className="h-10 pl-9" aria-label="Search skills" placeholder="Search skills…" value={query} onChange={event => setQuery(event.target.value)} /></div> : null}
    </div>
    {loading ? <p role="status" className="py-8 text-sm text-muted-foreground">Loading skill library…</p> : null}
    {error ? <div role="alert" className="py-6 text-sm"><p className="text-destructive">{error}</p><Button className="mt-3" variant="outline" onClick={() => void load()}>Try again</Button></div> : null}
    {view === "import" ? <div className="space-y-8"><SharedSkillImport onImported={() => { void load(true); }}/><SkillsSettings hideHeading importOnly onAdded={() => void load(true)} /></div> : !loading && !error ? <>
      {view === "discover" ? <p role="status" className="mb-4 text-xs text-muted-foreground">{directoryLoading ? "Searching skills.sh…" : directoryNotice}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {view === "installed" ? installed.map(skill => <button type="button" key={skill.id} onClick={() => setSelected(skill.id)} className="group flex min-h-44 min-w-0 flex-col rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-center justify-between"><Puzzle className="size-5 text-muted-foreground" /><ArrowUpRight className="size-4 text-muted-foreground" /></div><h4 className="mt-4 break-words text-sm font-semibold">{skill.title}</h4><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{skill.description || "Custom skill package"}</p>
        <p className="mt-auto break-words pt-4 text-[11px] text-muted-foreground">{skill.sourceType === "bundled" ? "Included with Metis" : skill.source || "Custom"} · {skill.enabled ? skill.alwaysOn ? "Always on" : "Enabled" : "Disabled"}</p>
      </button>) : available.map(skill => {
        const installedSkill = skills.find(item => item.id === skill.id && item.source === skill.source);
        return <article key={skill.catalogId} className="flex min-h-44 min-w-0 flex-col rounded-xl border border-border bg-card p-4"><Puzzle className="size-5 text-muted-foreground" /><h4 className="mt-4 break-words text-sm font-semibold">{skill.title}</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">{skill.description}</p><p className="mt-3 break-words text-[11px] text-muted-foreground">{skill.source}{typeof skill.installs === "number" ? " · " + skill.installs.toLocaleString("en") + " installs" : ""}</p>
        <a href={skill.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-9 w-fit items-center gap-1 text-xs underline underline-offset-4">View on skills.sh<ArrowUpRight className="size-3"/></a>
        <Button className="mt-4 w-fit" size="sm" variant="outline" disabled={Boolean(installing) || (!installedSkill && !isHostAdmin) || directoryLoading} onClick={() => installedSkill ? setSelected(skill.id) : void install(skill)}>{installedSkill ? "Open skill" : installing === skill.catalogId ? "Installing…" : "Install"}</Button></article>;
      })}
      </div>
      {!(view === "installed" ? installed.length : available.length) ? <p className="py-10 text-sm text-muted-foreground">{query ? "No skills match your search." : "No skills installed. Discover a skill or import your own."}</p> : null}
      {view === "discover" ? <div className="mt-6 space-y-2 border-t border-border pt-4 text-xs text-muted-foreground"><p>Catalog packages install on this Metis server. Each account controls which installed skills are enabled.</p>{!isHostAdmin ? <p>A host administrator can install additional shared packages.</p> : null}<a className="inline-flex min-h-9 items-center gap-1 underline underline-offset-4" href="https://skills.sh/" target="_blank" rel="noopener noreferrer">Explore the community library <ArrowUpRight className="size-3" /></a></div> : null}
    </> : null}
    <Button variant="ghost" className="mt-5 px-0" disabled={!skills.some(skill => skill.id === "skill-creator")} onClick={() => { setSelected("skill-creator"); setQuery(""); }}><Sparkles /> Create a skill with Metis</Button>
  </section>;
}
