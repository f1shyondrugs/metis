"use client";
import {GitBranch,Play} from "lucide-react";
import {useMemo} from "react";
import {Button} from "@/components/ui/button";
import {WorkspaceCard} from "@/components/workspace-card";

export type PlanWorkspaceCardProps={
  title:string;content:string;workspaceLink?:string;onOpen?:()=>void;
  onBuild?:()=>void;onBuildWithAgents?:()=>void;showMultiAgent?:boolean;buildDisabled?:boolean;compact?:boolean;
};
function planStats(content:string){
  const checks=[...content.matchAll(/^\s*[-*]\s+\[([ xX])\]\s+/gm)];
  const completed=checks.filter(match=>/x/i.test(match[1]||"")).length;
  const steps=content.split("\n").filter(line=>/^\s*(?:\d+[.)]|[-*])\s+\S/.test(line)&&!/^\s*[-*]\s+\[[ xX]\]/.test(line)).length;
  return {total:checks.length||steps,completed:checks.length?completed:0,checklist:checks.length>0};
}
export function PlanWorkspaceCard({title,content,onOpen,onBuild,onBuildWithAgents,showMultiAgent=false,buildDisabled=false,compact=false}:PlanWorkspaceCardProps){
  const stats=useMemo(()=>planStats(content),[content]);
  const progress=stats.checklist&&stats.total?Math.round(stats.completed/stats.total*100):null;
  const actions=onBuild||showMultiAgent&&onBuildWithAgents?<>
    {showMultiAgent&&onBuildWithAgents?<Button type="button" size="action" variant="outline" disabled={buildDisabled} title="Build independent workstreams in parallel" onClick={onBuildWithAgents}><GitBranch className="size-4" aria-hidden="true"/>{buildDisabled?"Running":"Parallel"}</Button>:null}
    {onBuild?<Button type="button" size="action" disabled={buildDisabled} onClick={onBuild}><Play className="size-4" aria-hidden="true"/>{buildDisabled?"Running":"Build"}</Button>:null}
  </>:null;
  return <WorkspaceCard kind="plan" title={title} content={content} onOpen={onOpen} compact={compact} progress={progress} actions={actions} metadata={stats.total>0?<span className="tabular-nums">{stats.checklist?`${stats.completed}/${stats.total} tasks`:`${stats.total} steps`}</span>:null}/>;
}
