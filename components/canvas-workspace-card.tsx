"use client";
import {useMemo} from "react";
import {WorkspaceCard} from "@/components/workspace-card";

export type CanvasWorkspaceCardProps={title:string;content:string;workspaceLink?:string;onOpen?:()=>void};
export function CanvasWorkspaceCard({title,content,onOpen}:CanvasWorkspaceCardProps){
  const stats=useMemo(()=>{
    const diagrams=(content.match(/\x60\x60\x60(?:mermaid|graphviz|dot)\b/gi)||[]).length;
    const graphs=(content.match(/\x60\x60\x60(?:graph|jsxgraph|geogebra|plot)\b/gi)||[]).length;
    const charts=(content.match(/\x60\x60\x60(?:chart|charts)\b/gi)||[]).length;
    const headings=(content.match(/^#{1,3}\s+\S/gm)||[]).length;
    return {diagrams,graphs,charts,headings};
  },[content]);
  return <WorkspaceCard kind="canvas" title={title} content={content} onOpen={onOpen} metadata={<>
    {stats.diagrams?<span>{stats.diagrams} diagram{stats.diagrams===1?"":"s"}</span>:null}
    {stats.graphs?<span>{stats.graphs} graph{stats.graphs===1?"":"s"}</span>:null}
    {stats.charts?<span>{stats.charts} chart{stats.charts===1?"":"s"}</span>:null}
    {!stats.diagrams&&stats.headings?<span>{stats.headings} section{stats.headings===1?"":"s"}</span>:null}
  </>}/>;
}
