"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SharedSkill } from "@/lib/skill-sharing";
export function SharedSkillImport({ initialToken, onImported }: { initialToken?: string; onImported?: (id: string)=>void }) {
  const [link,setLink] = useState(""); const [token,setToken] = useState("");
  const [skill,setSkill] = useState<SharedSkill|null>(null); const [signedIn,setSignedIn] = useState(false);
  const [id,setId] = useState(""); const [selected,setSelected] = useState("SKILL.md");
  const [busy,setBusy] = useState(false); const [error,setError] = useState(""); const [imported,setImported] = useState(false);
  const preview = useCallback(async (value:string) => {
    setBusy(true); setError("");setSkill(null);setImported(false);
    try {
      let shareToken = value;
      if (!/^[a-f0-9]{48}$/.test(value)) {
        const url = new URL(value,window.location.origin);
        if (url.origin !== window.location.origin) throw new Error("Use a skill share link from this Metis workspace.");
        shareToken = url.pathname.match(/^\/skills\/share\/([a-f0-9]{48})\/?$/)?.[1] || "";
      }
      if (!shareToken) throw new Error("Enter a valid Metis skill share link.");
      const response = await fetch("/api/skills/shares/"+shareToken,{cache:"no-store"});
      const body = await response.json();if (!response.ok) throw new Error(body.error);
      setToken(shareToken);setSkill(body.skill);setSignedIn(body.signedIn);setId(body.skill.id);setSelected("SKILL.md");
    } catch(e) {setError(e instanceof Error ? e.message : "Could not open share link.");}
    finally {setBusy(false);}
  },[]);
  useEffect(()=>{if(initialToken)void preview(initialToken);},[initialToken,preview]);
  async function importSkill() {
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/skills/shares/"+token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});
      const body=await response.json();if(!response.ok)throw new Error(body.error || "Could not import skill.");
      setImported(true);onImported?.(body.skill.id);
    }catch(e){setError(e instanceof Error ? e.message : "Could not import skill.");}finally{setBusy(false);}
  }
  const file=skill?.files.find(item=>item.path===selected);
  return <section aria-label="Import shared skill" className="space-y-5">
    {!initialToken ? <form onSubmit={e=>{e.preventDefault();void preview(link.trim());}} className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium"><Link2 className="size-4" />Import from a share link</h3>
      <div className="flex flex-wrap gap-2"><Input aria-label="Metis skill share link" placeholder="Paste a Metis skill share link…" value={link} onChange={e=>setLink(e.target.value)} className="min-w-0 flex-1 basis-64" /><Button variant="outline" disabled={busy||!link.trim()}>Preview skill</Button></div>
    </form> : null}
    {busy ? <p role="status" className="text-sm text-muted-foreground">Loading…</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {skill ? <><div><h2 className="break-words text-xl font-semibold">{skill.title}</h2>{skill.description ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{skill.description}</p> : null}<p className="mt-2 text-xs text-muted-foreground">{skill.files.length} {skill.files.length===1 ? "file" : "files"} · Shared {new Date(skill.createdAt).toLocaleDateString("en")}</p></div>
      <div className="flex flex-wrap items-end gap-3 border-y border-border py-4">
        {imported ? <p role="status" className="text-sm">Skill imported into your library.</p> : signedIn ? <><label className="min-w-0 flex-1 basis-52 text-xs text-muted-foreground">Import as<Input aria-label="Imported skill id" value={id} onChange={e=>setId(e.target.value)} className="mt-2" /></label><Button disabled={busy||!id.trim()} onClick={()=>void importSkill()}>Import skill</Button></> : <div className="space-y-3"><p className="text-sm text-muted-foreground">Sign in to Metis, then return to this link to import the skill.</p><Button asChild variant="outline"><Link href="/">Open Metis</Link></Button></div>}
      </div>
      <div className="grid min-w-0 gap-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Shared skill files" className="max-h-48 overflow-auto sm:max-h-none">{skill.files.map(item=><button key={item.path} type="button" onClick={()=>setSelected(item.path)} aria-current={selected===item.path?"page":undefined} className={"flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted "+(selected===item.path?"bg-muted":"")}><FileText className="size-4 shrink-0"/><span className="break-all">{item.path}</span></button>)}</nav>
        <div className="min-w-0 break-words text-sm leading-6 [&_h1]:mb-4 [&_h1]:text-xl [&_h2]:my-4 [&_h2]:font-semibold [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto [&_pre]:whitespace-pre-wrap [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_a]:underline">
          {file?.encoding==="base64" ? <p className="text-muted-foreground">This asset is included in the imported package.</p> : file?.path.endsWith(".md") ? <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{img:()=>null,a:({href,children})=><a href={href?.startsWith("https://")?href:undefined} target="_blank" rel="noopener noreferrer">{children}</a>}}>{file.content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/,"")}</ReactMarkdown> : <pre className="whitespace-pre-wrap break-words font-mono text-xs">{file?.content}</pre>}
        </div>
      </div>
    </> : null}
  </section>;
}
