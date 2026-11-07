import { getGlobalModelSettings, listChatsForUser, listMemories } from "@/lib/db-store";
import { listAccessibleIssues } from "@/lib/issues";
import { issueReference } from "@/lib/issue-types";
import { listProjects } from "@/lib/projects";
import { featureFlags } from "@/lib/feature-flags";
import { config } from "@/lib/config";
import { listNotes } from "@/lib/shared-context";
import { noteDisplayTitle } from "@/lib/notes-tree";
import { referenceMatches, type ReferenceKind } from "@/lib/reference-search";
import { indexedReferenceFiles,indexedChatMetadata,initializeReferenceIndex } from "./reference-file-index";
import { getDatabase } from "./sqlite";
import type { ReferenceResult } from "./reference-search";
import { canAccessChat } from "@/lib/project-access";

/** Initialize through the same module graph used by collection; avoid duplicate TS module loads. */
export function initializeReferenceSearch(){initializeReferenceIndex(getDatabase());}

export async function collectReferences(input: {ownerId:string; query:string; kind?:ReferenceKind|null; kinds?:readonly ReferenceKind[]; currentChatId:string}, cancelled:()=>boolean, schedule:(chatId:string,title:string,part?:"metadata"|"files")=>void=()=>{}) {
  const {ownerId,query,kind,currentChatId}=input;
  const includes=(value:ReferenceKind)=>(!kind || value===kind)&&(!input.kinds || input.kinds.includes(value));
  const perKindLimit=kind ? 80 : 8;
  const check=()=>{if(cancelled()) throw Object.assign(new Error("Search cancelled"),{name:"AbortError"});};
  const results: ReferenceResult[] = [];
  let indexing=false;
  const seen = new Set<string>();

  const push = (item: ReferenceResult) => {
    if (includes(item.kind) && referenceMatches(query, item.label, item.detail, item.path, item.content)) {
      const key = item.kind === "chat" ? "chat:" + (item.chatId || item.id) : item.kind === "file" ? [item.kind,item.chatId,item.path].join(":") : [item.kind,item.id,item.chatId || ""].join(":");
      if(seen.has(key))return;
      if(results.filter(result=>result.kind===item.kind).length>=perKindLimit) {
        const score=(candidate:ReferenceResult)=>Number(Boolean(candidate.isCurrentChat))*2+Number(referenceMatches(query,candidate.label));
        let index=-1;
        for(let i=0;i<results.length;i++)if(results[i].kind===item.kind && (index<0 || score(results[i])<score(results[index])))index=i;
        if(index<0 || score(item)<=score(results[index]))return;
        results.splice(index,1);
      }
      seen.add(key); results.push(item);
    }
  };

  const chatEntries = (["file","chat","canvas","plan","browser","terminal"] as const).some(includes) ? listChatsForUser(ownerId) : [];
  chatEntries.sort((a,b)=>Number(b.id===currentChatId)-Number(a.id===currentChatId));
  for (const entry of chatEntries) {
    check();
    if(results.length>=80) break;
    await new Promise<void>(resolve=>setImmediate(resolve));
    if (kind === "chat") {
      push({ kind: "chat", id: entry.id, label: entry.title || "Untitled chat", detail: entry.keywords?.join(" · "), chatId: entry.id, isCurrentChat: entry.id === currentChatId });
      continue;
    }
    const projection = indexedChatMetadata(getDatabase(),entry,ownerId,schedule);
    indexing=projection.indexing||indexing;
    const chat=projection.chat;
    push({
      kind: "chat",
      id: chat.id,
      label: chat.title || "Untitled chat",
      detail: `${chat.keywords?.join(" · ") || ""}`,
      chatId: chat.id,
      isCurrentChat: chat.id === currentChatId,
    });

    for (const workspace of chat.workspaces || []) {
      push({
        kind: workspace.type,
        id: workspace.id,
        label: workspace.name,
        detail: `in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        content: workspace.content.slice(0, 6_000),
      });
    }

    for (const tab of chat.browserContext?.tabs || []) {
      if (!tab.url && tab.title === "New tab") continue;
      push({
        kind: "browser",
        id: `${chat.id}:${tab.id}`,
        label: tab.title || tab.url || "Browser tab",
        detail: tab.url || `in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        path: tab.url,
      });
    }

    for (const tab of chat.sessionState?.terminalTabs || []) {
      push({
        kind: "terminal",
        id: `${chat.id}:${tab.id}`,
        label: tab.title || "Terminal",
        detail: `${tab.cwd} · in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        path: tab.cwd,
        sessionId: tab.sessionId,
      });
    }
    if (!chat.sessionState?.terminalTabs?.length && chat.sessionState?.terminalSessionId) {
      push({
        kind: "terminal",
        id: `${chat.id}:terminal-1`,
        label: "Terminal 1",
        detail: `${chat.sessionState.terminalCwd || chat.sessionState.remoteCwd || config.agentCwd} · in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        path: chat.sessionState.terminalCwd || chat.sessionState.remoteCwd || config.agentCwd,
        sessionId: chat.sessionState.terminalSessionId,
      });
    }

    if (!includes("file")) continue;
    const fileScore=(item:ReferenceResult)=>Number(Boolean(item.isCurrentChat))*2+Number(referenceMatches(query,item.label));
    const bestRemaining=Number(entry.id===currentChatId)*2+1;
    const fileResults=results.filter(item=>item.kind==="file");
    if(fileResults.length>=perKindLimit && fileResults.every(item=>fileScore(item)>=bestRemaining))continue;
    indexing=indexedReferenceFiles(getDatabase(), chat.id, chat.title || "Untitled chat", query, item=>push({...item,isCurrentChat:chat.id===currentChatId}), ()=>false, schedule,perKindLimit)||indexing;
  }

  check();
  if (includes("memory")) {
    for (const memory of listMemories(ownerId)) {
      push({
        kind: "memory",
        id: memory.id,
        label: memory.content.slice(0, 160),
        detail: memory.tags?.join(" · "),
        content: memory.content,
      });
    }
  }

  if (includes("note") || includes("memory")) {
    const notes=listNotes({ownerId});
    const accessible=new Map(notes.filter(note=>!note.chatId || canAccessChat(note.chatId,ownerId)).map(note=>[note.id,note]));
    const projects=new Map(listProjects(ownerId).map(project=>[project.id,project.name]));
    for (const note of accessible.values()) {
      const ancestors:string[]=[],visited=new Set([note.id]);
      let parent=note.parentId ? accessible.get(note.parentId) : undefined;
      while(parent && !visited.has(parent.id) && ancestors.length<32){
        visited.add(parent.id);ancestors.unshift(noteDisplayTitle(parent.title)||"Untitled note");
        parent=parent.parentId ? accessible.get(parent.parentId) : undefined;
      }
      const context=note.projectId ? projects.get(note.projectId)||"Project" : note.chatId ? "Chat" : "No Project";
      if (note.chatId && !canAccessChat(note.chatId, ownerId)) continue;
      push({
        kind: note.kind === "learned_fact" ? "memory" : "note",
        id: note.id,
        label: noteDisplayTitle(note.title) || note.content.slice(0, 80) || "Untitled note",
        detail: [context,...ancestors,ancestors.length ? "Subfile" : ""].filter(Boolean).join(" / "),
        ...(note.parentId ? {parentId:note.parentId} : {}),
        ...(note.chatId ? { chatId: note.chatId, isCurrentChat: note.chatId === currentChatId } : {}),
        content: note.content.slice(0, 6_000),
      });
    }
  }

  if (includes("issue") && featureFlags(getGlobalModelSettings(ownerId)).notes) {
    const projects = new Map(listProjects(ownerId).map(project => [project.id, project.name]));
    for (const issue of listAccessibleIssues(ownerId)) push(issueReference(issue, issue.projectId ? projects.get(issue.projectId) : undefined));
  }

  check();
  // Membership can change while extraction yields; never return revoked chat data.
  return {results:results.filter(item=>!item.chatId || canAccessChat(item.chatId,ownerId)).sort((a,b)=>Number(Boolean(b.isCurrentChat))-Number(Boolean(a.isCurrentChat)) || Number(referenceMatches(query,b.label))-Number(referenceMatches(query,a.label))),indexing};
}
