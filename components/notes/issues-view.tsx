"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Circle, CircleDashed, Columns3, List, Plus, Search, SlidersHorizontal, X, ExternalLink, Trash2, Loader2, MessageSquare, Link2, CalendarDays, Flag, UserRound, Bookmark, Settings2, SquareCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EditableMarkdown } from "@/components/editable-markdown";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IssueStatusMenu, IssuePriorityMenu, StatusIcon, issueStatusTone } from "./issue-controls";
import { IssueRow } from "./issue-row";
import { DEFAULT_ISSUE_FILTERS, ISSUE_PRIORITIES, ISSUE_PRIORITY_LABELS, ISSUE_BOARD_STATUSES, ISSUE_STATUSES, ISSUE_STATUS_LABELS, type Issue, type IssueDetail, type IssueFilters, type IssueListResponse, type IssueMember, type IssueStatus, type IssueViewSettings, type IssueWriteInput } from "@/lib/issue-types";

const selectClass="h-8 max-w-full rounded-lg border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
const smallLabel="flex flex-col gap-1.5 text-xs text-muted-foreground";
class IssueRequestError extends Error { constructor(message:string,public status:number){super(message);} }
async function request<T>(url:string,method="GET",body?:unknown,signal?:AbortSignal):Promise<T> {
  const response=await fetch(url,{method,headers:body===undefined?undefined:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",signal});
  const data=await response.json();
  if(!response.ok) throw new IssueRequestError(data.error||"Could not update issues.",response.status);
  return data as T;
}
function Select({className,...props}:ComponentProps<"select">) { return <select className={cn(selectClass,className)} {...props}/>; }
function memberName(members:IssueMember[],id:string|null) { return members.find(member=>member.userId===id)?.displayName||members.find(member=>member.userId===id)?.username||(id?"Former member":"Unassigned"); }
function changed(projectId:string|null) { window.dispatchEvent(new CustomEvent("metis-issues-changed",{detail:{projectId}})); }

/** The active container is always an existing Project, or the account's private No Project. */
export function IssuesView({projectId,issuebookId,onOpenNote,onOpenDocument,focusIssueId,className}:{className?:string;projectId:string|null;issuebookId?:string;onOpenNote?:(noteId:string)=>void;onOpenDocument?:(noteId:string)=>void;focusIssueId?:string|null}) {
  const [issues,setIssues]=useState<Issue[]>([]);
  const [members,setMembers]=useState<IssueMember[]>([]);
  const [currentUserId,setCurrentUserId]=useState("");
  const [settings,setSettings]=useState<IssueViewSettings>({layout:"list",filters:{...DEFAULT_ISSUE_FILTERS},savedViews:[]});
  const [ready,setReady]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [selecting,setSelecting]=useState(false);
  const [openId,setOpenId]=useState<string|null>(focusIssueId||null);
  const [quickTitle,setQuickTitle]=useState("");
  const [quickStatus,setQuickStatus]=useState<IssueStatus>("todo");
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [saveOpen,setSaveOpen]=useState(false);
  const [viewName,setViewName]=useState("");
  const [activeView,setActiveView]=useState("");
  const createRef=useRef<HTMLInputElement>(null);
  const searchRef=useRef<HTMLInputElement>(null);
  const surfaceRef=useRef<HTMLDivElement>(null);
  const scopeRef=useRef(projectId);
  scopeRef.current=projectId;
  const settingsScope=useRef<string|null|undefined>(undefined);
  const pendingSettings=useRef<{projectId:string|null;settings:IssueViewSettings}|null>(null);
  const settingsQueue=useRef<Promise<void>>(Promise.resolve());
  const persistSettings=useCallback((pending:{projectId:string|null;settings:IssueViewSettings})=>{
    settingsQueue.current=settingsQueue.current.catch(()=>{}).then(()=>request("/api/issues/views","PUT",pending)).then(()=>{}).catch(err=>{if(scopeRef.current===pending.projectId)setError(err instanceof Error?err.message:"Could not save view.");});
  },[]);
  const refresh=useCallback(async()=>{
    const scope=projectId;
    try {
      const data=await request<IssueListResponse>("/api/issues?projectId="+encodeURIComponent(scope||"none")+(issuebookId?"&issuebookId="+encodeURIComponent(issuebookId):""));
      if(scopeRef.current!==scope) return;
      setIssues(data.issues);setMembers(data.members);setCurrentUserId(data.currentUserId);setReady(true);setLoading(false);setError("");
      if(settingsScope.current!==scope){settingsScope.current=scope;setSettings(data.settings);}
      setSelected(previous=>new Set([...previous].filter(id=>data.issues.some(issue=>issue.id===id))));
    } catch(err) { if(scopeRef.current===scope) setError(err instanceof Error?err.message:"Could not load issues."); }
  },[projectId,issuebookId]);
  useEffect(()=>{
    const controller=new AbortController();
    settingsScope.current=undefined;
    setReady(false);setLoading(true);setIssues([]);setMembers([]);setCurrentUserId("");setSelected(new Set());setSelecting(false);setOpenId(null);setError("");setActiveView("");setQuickTitle("");setSaveOpen(false);setSettings({layout:"list",filters:{...DEFAULT_ISSUE_FILTERS},savedViews:[]});
    request<IssueListResponse>("/api/issues?projectId="+encodeURIComponent(projectId||"none")+(issuebookId?"&issuebookId="+encodeURIComponent(issuebookId):""),"GET",undefined,controller.signal).then(data=>{
      setIssues(data.issues);setMembers(data.members);setCurrentUserId(data.currentUserId);setSettings(data.settings);settingsScope.current=projectId;setReady(true);
    }).catch(err=>{if(!controller.signal.aborted) setError(err instanceof Error?err.message:"Could not load issues.");}).finally(()=>{if(!controller.signal.aborted) setLoading(false);});
    return ()=>controller.abort();
  },[projectId,issuebookId]);
  useEffect(()=>{if(focusIssueId) setOpenId(focusIssueId);},[focusIssueId]);
  useEffect(()=>{
    const listener=(event:Event)=>{
      const detail=(event as CustomEvent<{projectId:string|null}>).detail;
      if(!detail || detail.projectId===projectId) void refresh();
    };
    window.addEventListener("metis-issues-changed",listener);
    return ()=>window.removeEventListener("metis-issues-changed",listener);
  },[projectId,refresh]);
  useEffect(()=>{
    if(!ready) return;
    const pending={projectId,settings};
    pendingSettings.current=pending;
    const timer=setTimeout(()=>{if(pendingSettings.current===pending){pendingSettings.current=null;persistSettings(pending);}},500);
    return ()=>clearTimeout(timer);
  },[projectId,ready,settings,persistSettings]);
  useEffect(()=>()=>{const pending=pendingSettings.current;if(pending&&pending.projectId===projectId){pendingSettings.current=null;persistSettings(pending);}},[projectId,persistSettings]);
  const filters=settings.filters;
  const updateFilters=(patch:Partial<IssueFilters>)=>{setSettings(previous=>({...previous,filters:{...previous.filters,...patch}}));setActiveView("");};
  const filtered=useMemo(()=>{
    const query=filters.search.trim().toLowerCase();
    const priority=(issue:Issue)=>ISSUE_PRIORITIES.indexOf(issue.priority);
    return issues.filter(issue=>
      (!query || [issue.key,issue.title,issue.description,...issue.labels].some(value=>value.toLowerCase().includes(query))) &&
      (filters.status==="all" || issue.status===filters.status) &&
      (filters.priority==="all" || issue.priority===filters.priority) &&
      (filters.assignee==="all" || (filters.assignee==="unassigned"?!issue.assigneeId:issue.assigneeId===filters.assignee)) &&
      (filters.label==="all" || issue.labels.includes(filters.label)) &&
      (!filters.mine || issue.assigneeId===currentUserId)
    ).sort((a,b)=>filters.sort==="priority"?priority(b)-priority(a)||b.updatedAt.localeCompare(a.updatedAt):filters.sort==="due"?(a.dueDate||"9999").localeCompare(b.dueDate||"9999"):filters.sort==="created"?b.createdAt.localeCompare(a.createdAt):b.updatedAt.localeCompare(a.updatedAt));
  },[issues,filters,currentUserId]);
  const labels=useMemo(()=>[...new Set(issues.flatMap(issue=>issue.labels))].sort(),[issues]);
  const filterCount=[filters.status,filters.priority,filters.assignee,filters.label].filter(value=>value!=="all").length;
  async function mutate(action:()=>Promise<unknown>) {
    setBusy(true);setError("");
    try {await action();await refresh();changed(projectId);}
    catch(err){if(err instanceof IssueRequestError&&err.status===409)await refresh();setError(err instanceof Error?err.message:"Could not update issue.");}
    finally{setBusy(false);}
  }
  async function create() {
    if(!quickTitle.trim() || busy) return;
    const title=quickTitle;
    await mutate(async()=>{
      const data=await request<{issue:Issue}>("/api/issues","POST",{projectId,issuebookId,title,status:quickStatus});
      setQuickTitle("");if(data.issue.noteId&&onOpenDocument)onOpenDocument(data.issue.noteId);else setOpenId(data.issue.id);
    });
  }
  const toggle=(id:string)=>setSelected(previous=>{const next=new Set(previous);if(next.has(id)) next.delete(id);else next.add(id);return next;});
  const bulk=(patch:IssueWriteInput)=>void mutate(async()=>{await request("/api/issues","PATCH",{ids:[...selected],patch});setSelected(new Set());});
  const card=(issue:Issue,board=false)=><IssueRow key={issue.id} issue={issue} board={board} busy={busy} selecting={selecting} selected={selected.has(issue.id)} assigneeName={memberName(members,issue.assigneeId)}
    onSelect={()=>{setSelecting(true);toggle(issue.id);}}
    onOpen={()=>{if(issue.noteId&&onOpenDocument)onOpenDocument(issue.noteId);else setOpenId(issue.id);}}
    onDetails={()=>setOpenId(issue.id)}
    onUpdate={patch=>void mutate(()=>request("/api/issues/"+issue.id,"PATCH",{...patch,expectedVersion:issue.version}))}/>;
  return <div ref={surfaceRef} tabIndex={-1} className={cn("relative flex h-full min-h-0 flex-col bg-background text-foreground",className)} onKeyDown={event=>{
    if(event.defaultPrevented||(event.target as HTMLElement).closest("input,textarea,select,[contenteditable=true],.cm-editor,[role=menu],[role=dialog]")) return;
    if(event.key==="c"&&!event.metaKey&&!event.ctrlKey){event.preventDefault();createRef.current?.focus();}
    if(event.key==="/"){event.preventDefault();searchRef.current?.focus();}
    if(event.key==="Escape"){setSelected(new Set());setSelecting(false);}
  }}>
    <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
      <div className="relative min-w-32 flex-1 sm:max-w-72"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"/><Input ref={searchRef} aria-label="Search issues" placeholder="Search issues…" value={filters.search} disabled={!ready} onChange={event=>updateFilters({search:event.target.value})} className="h-9 bg-muted/30 pl-8 text-xs"/></div>
      <Button variant={filterCount||filters.mine?"secondary":"ghost"} size="sm" className="h-9 max-sm:w-9 max-sm:px-0" disabled={!ready} aria-label="Filter issues" title="Filter issues" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(value=>!value)}><SlidersHorizontal/><span className="hidden sm:inline">Filter</span>{filterCount+(filters.mine?1:0)>0&&<span className="text-[10px]">{filterCount+(filters.mine?1:0)}</span>}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant={activeView?"secondary":"ghost"} size="sm" className="h-9 max-sm:w-9 max-sm:px-0" disabled={!ready} aria-label="View options" title="View options"><Settings2/><span className="hidden sm:inline">View</span></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={filters.sort} onValueChange={value=>updateFilters({sort:value as IssueFilters["sort"]})}>
            {([["updated","Last updated"],["created","Newest"],["priority","Priority"],["due","Due date"]] as const).map(([value,label])=><DropdownMenuRadioItem className="min-h-9 text-xs max-sm:min-h-11" key={value} value={value}>{label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator/>
          {settings.savedViews.length>0&&<><DropdownMenuLabel className="text-xs text-muted-foreground">Saved views</DropdownMenuLabel><DropdownMenuRadioGroup value={activeView} onValueChange={value=>{const view=settings.savedViews.find(view=>view.id===value);setActiveView(value);if(view)setSettings(previous=>({...previous,filters:view.filters}));}}>{settings.savedViews.map(view=><DropdownMenuRadioItem className="min-h-9 text-xs max-sm:min-h-11" key={view.id} value={view.id}>{view.name}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></>}
          <DropdownMenuItem className="min-h-9 text-xs max-sm:min-h-11" onSelect={()=>{setViewName("");setSaveOpen(true);}}><Bookmark/>Save current view</DropdownMenuItem>
          {activeView&&<DropdownMenuItem className="min-h-9 text-xs max-sm:min-h-11" onSelect={()=>{setSettings(previous=>({...previous,savedViews:previous.savedViews.filter(view=>view.id!==activeView)}));setActiveView("");}}><Trash2/>Delete saved view</DropdownMenuItem>}
          <DropdownMenuSeparator/>
          <DropdownMenuItem className="min-h-9 text-xs max-sm:min-h-11" onSelect={()=>{setSelecting(value=>!value);setSelected(new Set());}}><SquareCheck/>{selecting?"Exit selection":"Select issues"}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5" role="group" aria-label="Issue layout"><Button variant={settings.layout==="list"?"secondary":"ghost"} size="icon-sm" className="size-8" aria-label="List view" aria-pressed={settings.layout==="list"} disabled={!ready} onClick={()=>setSettings(previous=>({...previous,layout:"list"}))}><List/></Button><Button variant={settings.layout==="board"?"secondary":"ghost"} size="icon-sm" className="size-8" aria-label="Board view" aria-pressed={settings.layout==="board"} disabled={!ready} onClick={()=>setSettings(previous=>({...previous,layout:"board"}))}><Columns3/></Button></div>
    </div>
    {filtersOpen&&<div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-muted/20 px-4 py-2 sm:px-6">
      <Select aria-label="Filter by status" value={filters.status} onChange={event=>updateFilters({status:event.target.value})}><option value="all">All statuses</option>{ISSUE_STATUSES.map(status=><option key={status} value={status}>{ISSUE_STATUS_LABELS[status]}</option>)}</Select>
      <Select aria-label="Filter by priority" value={filters.priority} onChange={event=>updateFilters({priority:event.target.value})}><option value="all">All priorities</option>{ISSUE_PRIORITIES.map(priority=><option key={priority} value={priority}>{ISSUE_PRIORITY_LABELS[priority]}</option>)}</Select>
      <Select aria-label="Filter by assignee" value={filters.assignee} onChange={event=>updateFilters({assignee:event.target.value})}><option value="all">All assignees</option><option value="unassigned">Unassigned</option>{members.map(member=><option key={member.userId} value={member.userId}>{member.displayName||member.username}</option>)}</Select>
      <Select aria-label="Filter by label" value={filters.label} onChange={event=>updateFilters({label:event.target.value})}><option value="all">All labels</option>{labels.map(label=><option key={label}>{label}</option>)}</Select>
      <Button variant={filters.mine?"secondary":"ghost"} size="sm" aria-pressed={filters.mine} onClick={()=>updateFilters({mine:!filters.mine})}><UserRound className="size-3.5"/>My issues</Button>
      <Button variant="ghost" size="sm" onClick={()=>{setSettings(previous=>({...previous,filters:{...DEFAULT_ISSUE_FILTERS}}));setActiveView("");}}>Clear filters</Button>
    </div>}
    {error&&<div role="alert" className="flex items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive"><span>{error}</span><Button variant="ghost" size="sm" onClick={()=>{setError("");void refresh();}}>Retry</Button></div>}
    {selected.size>0&&<div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs"><span>{selected.size} selected</span><Select aria-label="Set selected issues status" value="" disabled={busy} onChange={event=>bulk({status:event.target.value as IssueStatus})}><option value="" disabled>Set status…</option>{ISSUE_STATUSES.map(status=><option key={status} value={status}>{ISSUE_STATUS_LABELS[status]}</option>)}</Select><Select aria-label="Set selected issues priority" value="" disabled={busy} onChange={event=>bulk({priority:event.target.value as Issue["priority"]})}><option value="" disabled>Set priority…</option>{ISSUE_PRIORITIES.map(priority=><option key={priority} value={priority}>{ISSUE_PRIORITY_LABELS[priority]}</option>)}</Select><Select aria-label="Assign selected issues" value="" disabled={busy} onChange={event=>bulk({assigneeId:event.target.value==="unassigned"?null:event.target.value})}><option value="" disabled>Assign…</option><option value="unassigned">Unassigned</option>{members.map(member=><option key={member.userId} value={member.userId}>{member.username}</option>)}</Select><Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={()=>{setSelected(new Set());setSelecting(false);}}><X/></Button></div>}
    <form className="flex items-center gap-1.5 border-b border-border/70 px-3 py-2 focus-within:bg-muted/20 sm:px-5" onSubmit={event=>{event.preventDefault();void create();}}>
      <IssueStatusMenu status={quickStatus} issueKey="new issue" disabled={!ready||busy} onChange={setQuickStatus}/>
      <Input ref={createRef} aria-label="New issue title" placeholder="Add an issue…" className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1 text-[13px] shadow-none focus-visible:ring-1" maxLength={300} value={quickTitle} disabled={!ready||busy} onChange={event=>setQuickTitle(event.target.value)}/>
      {quickTitle.trim()?<Button type="submit" size="sm" className="h-8" disabled={!ready||busy}>{busy?<Loader2 className="animate-spin"/>:<Plus/>}Add</Button>:<kbd aria-hidden="true" className="mr-2 hidden text-[10px] text-muted-foreground/60 sm:inline">C</kbd>}
    </form>
    <div className="min-h-0 flex-1 overflow-auto">
      {loading?<div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>Loading issues…</div>
      :!ready?<div className="px-6 py-16 text-center text-sm text-muted-foreground">Issues could not be loaded. Use Retry to try again.</div>
      :filtered.length===0?<div className="mx-auto flex max-w-sm flex-col items-center px-6 py-20 text-center"><CircleDashed className="mb-4 size-7 text-muted-foreground"/><h3 className="text-sm font-medium">{issues.length?"No matching issues":"No issues yet"}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{issues.length?"Adjust the search or filters to see more issues.":"Capture work here or turn a page checkbox or selection into an issue."}</p><Button variant="outline" size="sm" className="mt-4" onClick={()=>issues.length?setSettings(previous=>({...previous,filters:{...DEFAULT_ISSUE_FILTERS}})):createRef.current?.focus()}>{issues.length?"Clear filters":"Create an issue"}</Button></div>
      :settings.layout==="board"?<div className="flex min-h-full gap-4 p-4 sm:p-6">{ISSUE_BOARD_STATUSES.map(status=><section key={status} aria-label={ISSUE_STATUS_LABELS[status]+" column"} className="flex w-64 shrink-0 flex-col" onDragOver={event=>{if(event.dataTransfer.types.includes("text/metis-issue"))event.preventDefault();}} onDrop={event=>{event.preventDefault();if(busy||selecting)return;const id=event.dataTransfer.getData("text/metis-issue");const issue=issues.find(issue=>issue.id===id);if(issue)void mutate(()=>request("/api/issues/"+id,"PATCH",{status,expectedVersion:issue.version}));}}><h3 className="mb-3 flex items-center gap-2 text-xs font-medium"><StatusIcon status={status}/>{ISSUE_STATUS_LABELS[status]}<span className="text-muted-foreground">{filtered.filter(issue=>issue.status===status).length}</span></h3><div className="space-y-2">{filtered.filter(issue=>issue.status===status).map(issue=>card(issue,true))}</div><Button variant="ghost" size="sm" className="mt-2 justify-start text-muted-foreground" onClick={()=>{setQuickStatus(status);createRef.current?.focus();}}><Plus/>Add issue</Button></section>)}</div>
      :<div className="pb-12">
        <div className="flex min-h-9 items-center gap-2 px-4 text-[11px] text-muted-foreground sm:px-6">
          {selecting?<><label className="flex min-h-9 items-center gap-2"><input ref={node=>{if(node)node.indeterminate=filtered.some(issue=>selected.has(issue.id))&&!filtered.every(issue=>selected.has(issue.id));}} type="checkbox" className="size-3.5 accent-primary" aria-label="Select all visible issues" checked={filtered.length>0&&filtered.every(issue=>selected.has(issue.id))} disabled={busy} onChange={event=>setSelected(event.target.checked?new Set(filtered.map(issue=>issue.id)):new Set())}/>Select all</label><Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={()=>{setSelecting(false);setSelected(new Set());}}>Done selecting</Button></>:<><span>{filtered.length} {filtered.length===1?"issue":"issues"}</span><button type="button" className="ml-auto inline-flex min-h-8 items-center gap-1 rounded px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>setSelecting(true)}><SquareCheck className="size-3.5"/>Select</button></>}
        </div>
        {ISSUE_STATUSES.filter(status=>filtered.some(issue=>issue.status===status)).map(status=><section key={status} aria-label={ISSUE_STATUS_LABELS[status]+" issues"}><h3 className="sticky top-0 z-10 flex items-center gap-2 border-y border-border/50 bg-background px-4 py-1.5 text-[11px] font-medium sm:px-6"><span className={cn("rounded-md px-2 py-1",issueStatusTone[status])}>{ISSUE_STATUS_LABELS[status]}</span><span className="text-muted-foreground/70">{filtered.filter(issue=>issue.status===status).length}</span></h3>{filtered.filter(issue=>issue.status===status).map(issue=>card(issue))}</section>)}
      </div>}

    </div>
    <IssuePanel key={projectId||"none"} issueId={openId} issues={issues} members={members} projectId={projectId} onClose={()=>{setOpenId(null);surfaceRef.current?.focus();}} onOpenIssue={setOpenId} onOpenNote={onOpenNote} onChanged={()=>{void refresh();changed(projectId);}}/>
    <Dialog open={saveOpen} onOpenChange={setSaveOpen}><DialogContent><DialogHeader><DialogTitle>Save issue view</DialogTitle><DialogDescription>Save these filters for this project and your account.</DialogDescription></DialogHeader><form className="space-y-3" onSubmit={event=>{event.preventDefault();if(!viewName.trim())return;const id=crypto.randomUUID();setSettings(previous=>({...previous,savedViews:[...previous.savedViews,{id,name:viewName.trim(),filters:{...previous.filters}}].slice(-30)}));setActiveView(id);setSaveOpen(false);}}><Input autoFocus aria-label="View name" placeholder="View name" maxLength={80} value={viewName} onChange={event=>setViewName(event.target.value)}/><Button type="submit" disabled={!viewName.trim()}>Save view</Button></form></DialogContent></Dialog>
  </div>;
}

/** Issue properties follow the shared page header, before the Markdown body. */
export function IssueFileProperties({issueId,projectId,onOpenNote,onBeforeChange,onChanged}:{issueId:string;projectId:string|null;onOpenNote:(id:string)=>void;onBeforeChange:()=>Promise<boolean>;onChanged:()=>void}) {
  const [detail,setDetail]=useState<IssueDetail|null>(null);
  const [listing,setListing]=useState<IssueListResponse|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [panel,setPanel]=useState(false);
  const refresh=useCallback(async()=>{
    try {
      const [next,list]=await Promise.all([request<IssueDetail>("/api/issues/"+issueId),request<IssueListResponse>("/api/issues?projectId="+encodeURIComponent(projectId||"none"))]);
      setDetail(next);setListing(list);setError("");
    } catch(cause) {setError(cause instanceof Error?cause.message:"Could not load issue properties.");}
  },[issueId,projectId]);
  useEffect(()=>{void refresh();},[refresh]);
  async function update(patch:IssueWriteInput) {
    if(!detail || !await onBeforeChange())return;
    setBusy(true);
    try {
      const current=await request<IssueDetail>("/api/issues/"+issueId);
      await request("/api/issues/"+issueId,"PATCH",{...patch,expectedVersion:current.issue.version});
      await refresh();onChanged();changed(projectId);
    } catch(cause) {setError(cause instanceof Error?cause.message:"Could not save issue properties.");}
    finally {setBusy(false);}
  }
  return <section aria-label="Issue properties" className="mb-6 border-b border-border pb-4">
    {detail?<div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="mr-1 font-mono text-muted-foreground">{detail.issue.key}</span>
      <IssueStatusMenu issueKey={detail.issue.key} status={detail.issue.status} disabled={busy} showLabel onChange={status=>void update({status})}/>
      <IssuePriorityMenu issueKey={detail.issue.key} priority={detail.issue.priority} disabled={busy} showLabel onChange={priority=>void update({priority})}/>
      <Button variant="ghost" size="sm" disabled={busy} onClick={()=>void onBeforeChange().then(ok=>{if(ok){void refresh();setPanel(true);}})}>Issue details</Button>
      {detail.issue.issuebookId&&<Button variant="ghost" size="sm" onClick={()=>onOpenNote(detail.issue.issuebookId!)}>Open issuebook</Button>}
    </div>:!error?<p role="status" className="text-xs text-muted-foreground">Loading issue properties…</p>:null}
    {error&&<p role="alert" className="mt-2 text-xs text-destructive">{error}<button className="ml-2 underline" onClick={()=>void refresh()}>Retry</button></p>}
    <IssuePanel issueId={panel?issueId:null} projectId={projectId} issues={listing?.issues||[]} members={listing?.members||[]} onClose={()=>setPanel(false)} onOpenIssue={id=>{const issue=listing?.issues.find(issue=>issue.id===id);if(issue?.noteId){setPanel(false);onOpenNote(issue.noteId);}}} onOpenNote={onOpenNote} onChanged={()=>{void refresh();onChanged();changed(projectId);}}/>
  </section>;
}

function IssuePanel({issueId,issues,members,projectId,onClose,onOpenIssue,onOpenNote,onChanged}:{issueId:string|null;issues:Issue[];members:IssueMember[];projectId:string|null;onClose:()=>void;onOpenIssue:(id:string)=>void;onOpenNote?:((id:string)=>void);onChanged:()=>void}) {
  const [detail,setDetail]=useState<IssueDetail|null>(null);
  const [draft,setDraft]=useState<IssueWriteInput>({});
  const [labels,setLabels]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [comment,setComment]=useState("");
  const [subTitle,setSubTitle]=useState("");
  const [relationTarget,setRelationTarget]=useState("");
  const [relationKind,setRelationKind]=useState<"related"|"blocks">("related");
  const [deleteOpen,setDeleteOpen]=useState(false);
  const [activity,setActivity]=useState(false);
  const [revision,setRevision]=useState(0);
  const previousIssueId=useRef<string|null>(null);
  const draftDirty=useRef(false);
  const draftVersion=useRef(1);
  useEffect(()=>{
    const sameIssue=previousIssueId.current===issueId;
    previousIssueId.current=issueId;
    const preserveDraft=sameIssue&&draftDirty.current;
    if(!sameIssue)setDetail(null);setError("");setComment("");setSubTitle("");setRelationTarget("");setDeleteOpen(false);
    if(!issueId)return;
    const controller=new AbortController();
    setLoading(true);
    request<IssueDetail>("/api/issues/"+issueId,"GET",undefined,controller.signal).then(data=>{
      if(data.issue.projectId!==projectId) throw new Error("Issue is outside this project.");
      setDetail(data);if(!preserveDraft){draftVersion.current=data.issue.version;setDraft({title:data.issue.title,description:data.issue.description,status:data.issue.status,priority:data.issue.priority,assigneeId:data.issue.assigneeId,dueDate:data.issue.dueDate,parentId:data.issue.parentId});setLabels(data.issue.labels.join(", "));}
    }).catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:"Could not load issue.");}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[issueId,projectId,revision]);
  const dirty=detail && (["title","description","status","priority","assigneeId","dueDate","parentId"] as const).some(field=>draft[field]!==detail.issue[field]) || !!detail&&labels!==detail.issue.labels.join(", ");
  draftDirty.current=!!dirty;
  async function action(run:()=>Promise<unknown>,refresh=true) {
    setBusy(true);setError("");
    try {await run();onChanged();if(refresh)setRevision(value=>value+1);return true;}
    catch(err){setError(err instanceof Error?err.message:"Could not update issue.");return false;}
    finally{setBusy(false);}
  }
  const relationIssues=issues.filter(issue=>issue.id!==issueId);
  return <Sheet open={!!issueId} onOpenChange={open=>{if(!open)onClose();}}><SheetContent side="right" className="flex flex-col gap-0 overflow-hidden p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
    <SheetHeader className="shrink-0 border-b border-border px-5 py-4 pr-12"><SheetTitle className="flex items-center gap-2 text-sm">{detail&&<StatusIcon status={detail.issue.status}/>}<span className="font-mono text-xs text-muted-foreground">{detail?.issue.key||"Issue"}</span></SheetTitle><SheetDescription className="sr-only">Edit issue properties, description, subissues, links and comments.</SheetDescription></SheetHeader>
    <div className="min-h-0 flex-1 overflow-auto p-5">
      {loading&&<div role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>Loading issue…</div>}
      {error&&<div role="alert" className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-destructive/30 p-3 text-xs text-destructive">{error}<Button variant="ghost" size="sm" onClick={()=>{draftDirty.current=false;setRevision(value=>value+1);}}>Reload</Button></div>}
      {detail&&!loading&&<>
        <form inert={busy||undefined} onSubmit={event=>{event.preventDefault();void action(async()=>{const result=await request("/api/issues/"+issueId,"PATCH",{...draft,labels:labels.split(",").map(label=>label.trim()).filter(Boolean),expectedVersion:draftVersion.current});draftDirty.current=false;return result;});}} className="space-y-5">
          <Input aria-label="Issue title" value={draft.title||""} maxLength={300} required disabled={busy} className="h-auto rounded-none border-0 px-0 py-1 text-xl font-semibold shadow-none md:text-xl" onChange={event=>setDraft(previous=>({...previous,title:event.target.value}))}/>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className={smallLabel}><span className="flex items-center gap-1"><Circle className="size-3"/>Status</span><Select disabled={busy} value={draft.status} onChange={event=>setDraft(previous=>({...previous,status:event.target.value as IssueStatus}))}>{ISSUE_STATUSES.map(status=><option key={status} value={status}>{ISSUE_STATUS_LABELS[status]}</option>)}</Select></label>
            <label className={smallLabel}><span className="flex items-center gap-1"><Flag className="size-3"/>Priority</span><Select disabled={busy} value={draft.priority} onChange={event=>setDraft(previous=>({...previous,priority:event.target.value as Issue["priority"]}))}>{ISSUE_PRIORITIES.map(priority=><option key={priority} value={priority}>{ISSUE_PRIORITY_LABELS[priority]}</option>)}</Select></label>
            <label className={smallLabel}><span className="flex items-center gap-1"><UserRound className="size-3"/>Assignee</span><Select disabled={busy} value={draft.assigneeId||""} onChange={event=>setDraft(previous=>({...previous,assigneeId:event.target.value||null}))}><option value="">Unassigned</option>{draft.assigneeId&&!members.some(member=>member.userId===draft.assigneeId)&&<option value={draft.assigneeId}>Former member</option>}{members.map(member=><option key={member.userId} value={member.userId}>{member.displayName||member.username}</option>)}</Select></label>
            <label className={smallLabel}><span className="flex items-center gap-1"><CalendarDays className="size-3"/>Due date</span><Input type="date" aria-label="Due date" disabled={busy} value={draft.dueDate||""} className="h-8 text-xs" onChange={event=>setDraft(previous=>({...previous,dueDate:event.target.value||null}))}/></label>
            <label className={smallLabel}>Labels<Input aria-label="Issue labels, comma separated" disabled={busy} value={labels} maxLength={1800} placeholder="Comma separated" className="h-8 text-xs" onChange={event=>setLabels(event.target.value)}/></label>
            <label className={smallLabel}>Parent issue<Select disabled={busy} value={draft.parentId||""} onChange={event=>setDraft(previous=>({...previous,parentId:event.target.value||null}))}><option value="">No parent</option>{issues.filter(issue=>issue.id!==issueId).map(issue=><option key={issue.id} value={issue.id}>{issue.key} · {issue.title}</option>)}</Select></label>
          </div>
          <div className="min-h-32 rounded-lg border border-border"><EditableMarkdown aria-label="Issue description" value={draft.description||""} onChange={description=>setDraft(previous=>({...previous,description}))} placeholder="Add a description…" hideAttachmentButton/></div>
          <div className="flex items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground">{dirty?"Unsaved changes":"Saved"} · Created {new Date(detail.issue.createdAt).toLocaleDateString("en")}</span><Button type="submit" size="sm" disabled={busy||!dirty||!draft.title?.trim()}>{busy?<Loader2 className="animate-spin"/>:null}Save changes</Button></div>
        </form>
        {detail.issue.source&&<section className="mt-6 border-t border-border pt-4"><h3 className="mb-2 text-xs font-medium">Source page</h3><button type="button" disabled={!onOpenNote} onClick={()=>{onOpenNote?.(detail.issue.source!.noteId);onClose();}} className="flex items-center gap-2 text-xs text-primary underline-offset-4 hover:underline disabled:text-muted-foreground"><ExternalLink className="size-3.5"/>Open {detail.issue.source.kind==="checkbox"?"original checkbox":"page selection"}</button>{detail.issue.source.excerpt&&<blockquote className="mt-2 border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">{detail.issue.source.excerpt}</blockquote>}</section>}
        <section className="mt-6 border-t border-border pt-4"><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-medium">Subissues <span className="ml-1 text-muted-foreground">{detail.subissues.length}</span></h3></div>{detail.subissues.map(issue=><button type="button" key={issue.id} onClick={()=>onOpenIssue(issue.id)} className="flex w-full items-center gap-2 py-2 text-left text-xs hover:text-primary"><StatusIcon status={issue.status}/><span className="font-mono text-[10px] text-muted-foreground">{issue.key}</span><span className="truncate">{issue.title}</span></button>)}<form className="mt-2 flex gap-2" onSubmit={event=>{event.preventDefault();if(!subTitle.trim())return;void action(async()=>{await request("/api/issues","POST",{projectId,parentId:issueId,title:subTitle,status:"todo"});setSubTitle("");});}}><Input aria-label="New subissue title" placeholder="Add a subissue…" className="h-8 text-xs" maxLength={300} value={subTitle} disabled={busy} onChange={event=>setSubTitle(event.target.value)}/><Button type="submit" variant="ghost" size="sm" disabled={busy||!subTitle.trim()}><Plus/>Add</Button></form></section>
        <section className="mt-6 border-t border-border pt-4"><h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium"><Link2 className="size-3.5"/>Relations</h3>{detail.relations.length===0&&<p className="mb-2 text-xs text-muted-foreground">No linked issues.</p>}{detail.relations.map(relation=>{const otherId=relation.issueId===issueId?relation.targetId:relation.issueId;const other=issues.find(issue=>issue.id===otherId);return <div key={relation.id} className="flex items-center gap-2 py-1.5 text-xs"><span className="w-16 shrink-0 text-muted-foreground">{relation.kind==="related"?"Related":relation.issueId===issueId?"Blocks":"Blocked by"}</span><button type="button" className="min-w-0 flex-1 truncate text-left hover:text-primary" onClick={()=>onOpenIssue(otherId)}>{other?other.key+" · "+other.title:"Open linked issue"}</button><Button variant="ghost" size="icon-sm" aria-label="Remove relation" disabled={busy} onClick={()=>void action(()=>request("/api/issues/"+issueId+"/relations","DELETE",{relationId:relation.id}))}><X/></Button></div>;})}<form className="mt-2 flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();if(!relationTarget)return;void action(()=>request("/api/issues/"+issueId+"/relations","POST",{targetId:relationTarget,kind:relationKind}));}}><Select aria-label="Relation type" value={relationKind} onChange={event=>setRelationKind(event.target.value as "related"|"blocks")}><option value="related">Related to</option><option value="blocks">Blocks</option></Select><Select aria-label="Linked issue" className="min-w-0 flex-1" value={relationTarget} onChange={event=>setRelationTarget(event.target.value)}><option value="">Choose an issue…</option>{relationIssues.map(issue=><option key={issue.id} value={issue.id}>{issue.key} · {issue.title}</option>)}</Select><Button type="submit" variant="ghost" size="sm" disabled={busy||!relationTarget}>Link</Button></form></section>
        <section className="mt-6 border-t border-border pt-4"><div className="mb-4 flex items-center justify-between"><h3 className="flex items-center gap-1.5 text-xs font-medium"><MessageSquare className="size-3.5"/>Comments <span className="text-muted-foreground">{detail.comments.length}</span></h3><Button variant="ghost" size="sm" aria-pressed={activity} onClick={()=>setActivity(value=>!value)}>History</Button></div>
          {activity&&<ol className="mb-4 space-y-3 border-l border-border pl-3">{detail.history.map(item=><li key={item.id} className="text-[11px] leading-5"><span className="font-medium">{item.actorName}</span> <span className="text-muted-foreground">{item.action}{Object.keys(item.changes).length?" · "+Object.entries(item.changes).map(([field,value])=>field+": "+(Array.isArray(value.after)?value.after.join(", "):String(value.after??"cleared"))).join(" · "):""}</span><time className="block text-[10px] text-muted-foreground">{new Date(item.createdAt).toLocaleString("en")}</time></li>)}</ol>}
          {detail.comments.length===0&&!activity&&<p className="mb-4 text-xs text-muted-foreground">No comments yet.</p>}{detail.comments.map(item=><article key={item.id} className="mb-4"><div className="mb-1 flex items-center gap-2 text-[11px]"><span className="font-medium">{item.authorName}</span><time className="text-muted-foreground">{new Date(item.createdAt).toLocaleString("en")}</time></div><p className="whitespace-pre-wrap break-words text-xs leading-5">{item.body}</p></article>)}<form className="space-y-2" onSubmit={event=>{event.preventDefault();if(!comment.trim())return;void action(async()=>{await request("/api/issues/"+issueId+"/comments","POST",{body:comment});setComment("");});}}><textarea aria-label="Add a comment" className="min-h-20 w-full resize-y rounded-lg border border-border bg-background p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Leave a comment…" maxLength={20_000} value={comment} disabled={busy} onChange={event=>setComment(event.target.value)}/><Button type="submit" size="sm" disabled={busy||!comment.trim()}>Comment</Button></form>
        </section>
        <div className="mt-8 flex justify-end border-t border-border pt-4"><Button variant="destructive" size="sm" disabled={busy} onClick={()=>setDeleteOpen(true)}><Trash2/>Delete issue</Button></div>
      </>}
    </div>
    <Dialog open={deleteOpen} onOpenChange={open=>{if(!busy)setDeleteOpen(open);}}><DialogContent className="z-[1100]"><DialogHeader><DialogTitle>Delete issue?</DialogTitle><DialogDescription>This permanently removes this issue, its comments and relations. Subissues are kept.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={()=>setDeleteOpen(false)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={()=>void (async()=>{const ok=await action(()=>request("/api/issues/"+issueId,"DELETE"),false);if(ok)onClose();})()}>Delete issue</Button></div></DialogContent></Dialog>
  </SheetContent></Sheet>;
}
