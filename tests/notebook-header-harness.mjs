import fs from "node:fs";
import ts from "typescript";
export function notebookBreadcrumbSource(){
 const tree=ts.createSourceFile("notes-workspace.tsx",fs.readFileSync(new URL("../components/notes/notes-workspace.tsx",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const matches=[];
 function visit(n){if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(tree)==="button"&&n.getText(tree).includes("{containerName}"))matches.push(n.getText(tree));ts.forEachChild(n,visit);}visit(tree);
 if(matches.length!==1)throw Error("Expected actual notebook breadcrumb root button");
 return `import React from "react";import {NotebookProjectIcon} from "./components/notes/notebook-project-icon";
 export function Breadcrumb({project,onRoot,blocked=false}){
 const containerProject=project,containerName=project?.name||"No Project",flush=async()=>!blocked,setSelectedId=()=>onRoot?.();
 return (${matches[0]});
 }`;
}
