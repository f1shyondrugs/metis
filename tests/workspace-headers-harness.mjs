// Render the production header JSX, not a separately maintained approximation.
import fs from "node:fs";
import ts from "typescript";
const root=new URL("../",import.meta.url);
function source(file){return ts.createSourceFile(file,fs.readFileSync(new URL(file,root),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);}
function header(file){const tree=source(file),matches=[];function visit(n){if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(tree)==="header")matches.push(n.getText(tree));ts.forEachChild(n,visit);}visit(tree);if(matches.length!==1)throw Error("Expected one production header in "+file);return matches[0];}
export function workspaceHeadersSource(){
 const account=source("components/account/account-panel.tsx");let titles="";
 function visit(n){if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(account)==="ACCOUNT_TITLES"))titles=n.getText(account);ts.forEachChild(n,visit);}visit(account);
 if(!titles)throw Error("Missing account title inventory");
 return `
 import React from "react";
 import {ArrowLeft, Menu, PanelLeft} from "lucide-react";
 import {Button} from "./components/ui/button";
 ${titles}
 export function AccountHeader({view,onClose=()=>{},onOpenNav=()=>{}}){return (${header("components/account/account-panel.tsx")});}
 export function CalendarHeader({sidebarOpen=true,onOpenSidebar=()=>{},onToggleSidebar=()=>{}}){return (${header("components/calendar/calendar-workspace.tsx")});}
 export function PrimaryHeader({section,onOpenNav=()=>{},onToggleSidebar=()=>{}}){
  const notesOpen=section==="notes",automationsOpen=section==="automations",projectHomeId=section==="project"?"fixture-project":null;
  const sidebarProjects=[{id:"fixture-project",name:"A very long project name that should truncate rather than push navigation controls out of the header"}];
  const isAgentChat=false,isDraft=true,isEmpty=true,activeChatIncognito=false,desktopSidebarOpen=true;
  const setMobileNavOpen=onOpenNav,toggleDesktopSidebar=onToggleSidebar;
  return (${header("components/app-shell.tsx")});
 }
 `;
}
