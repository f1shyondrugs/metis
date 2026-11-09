import {runChecks} from "./ui-consistency-browser-checks";
import React,{useState,useEffect} from "react";
import {createRoot} from "react-dom/client";
import {AppearanceProvider,useAppearance} from "../components/appearance-provider";
import {CanvasWorkspaceCard} from "../components/canvas-workspace-card";
import {PlanWorkspaceCard} from "../components/plan-workspace-card";
import {NotesBlockEditor} from "../components/notes/block-editor";
import {ComposerAddMenu} from "../components/composer-add-menu";
import {RichComposerInput} from "../components/rich-composer-input";
import {SettingsPanel} from "../components/settings-panel";
import {UsageDashboard} from "../components/account/usage-dashboard";
import {WorkspaceDesktopsPanel} from "../components/workspace-desktops-panel";
import {NoteShareDialog} from "../components/notes/note-share-dialog";
import {SharedPreviewDialog} from "../components/shared-preview-dialog";
import {RecentlyDeletedChats} from "../components/recently-deleted-chats";
import {ConfirmDialog} from "../components/confirm-dialog";
import {Button} from "../components/ui/button";
import {TooltipProvider} from "../components/ui/tooltip";
const query=new URLSearchParams(location.search),noop=()=>{};
const initialArea=query.get("area")||"cards";let mode=query.get("state")||"loaded";
const realFetch=window.fetch.bind(window);
const longTitle="Release checklist for an exceptionally long project name that should stay readable on small screens";
const sample="# Release checklist\n\n- [x] Draft complete\n- [ ] Review navigation\n- [ ] Check sharing\n\n"+Array.from({length:35},(_,i)=>"Section "+(i+1)+": Keep this complete line readable and reachable.").join("\n\n");
let fail=mode==="error";
window.fetch=async(url,options={})=>{
 const p=String(url);
 if(p.startsWith("/__audit/"))return realFetch(url,options);
 if(mode==="loading"&&!options.method)return new Promise(()=>{});
 if(fail && (p.startsWith("/api/chats")||p.startsWith("/api/account-usage")||p.startsWith("/api/remote-clients")||p.includes("/share")))return Response.json({error:"Synthetic connection failure. Your changes are safe."},{status:503});
 if(p.startsWith("/api/chats/deleted"))return Response.json(options.method?{ok:true}:{chats:[{id:"trash-a",title:"Synthetic deleted chat",deletedAt:"2026-11-09T12:00:00Z"}]});
 if(p.startsWith("/api/chats"))return Response.json({chats:mode==="empty"?[]:[{id:"archived-a",title:longTitle,archived:true,updatedAt:"2026-11-09T12:00:00Z",share:{id:"shared-a",active:true}}]});
 if(p.startsWith("/api/providers"))return Response.json({providers:[],connections:[]});
 if(p.includes("notifications"))return Response.json({prefs:{remoteClientIds:[],enabled:false},notifications:[]});
 if(p.startsWith("/api/remote-clients"))return Response.json({clients:mode==="empty"?[]:[{id:"offline-a",name:longTitle,hostname:"AUDIT-PC",os:"Windows",status:"offline",policy:{mode:"restricted",permissions:[],allowlist:[]}}]});
 if(p.startsWith("/api/account-usage"))return Response.json({usage:{from:"2026-10-11",to:"2026-11-09",timezone:"UTC",totals:{requests:0,tokens:0,inputTokens:0,outputTokens:0,costUsd:null,tokenReports:0,costReports:0,inputReports:0,outputReports:0},days:[],models:[],providers:[]}});
 if(p.includes("/share"))return Response.json({share:{id:"fixture-share",url:"/share/notes/fixture-share",active:false,passwordProtected:false}});
 if(p.includes("/usage-resets"))return Response.json({connections:[],accounts:[],providers:[]});
 return Response.json({});
};
window.addEventListener("unhandledrejection",event=>{document.getElementById("fixture-errors").textContent=String(event.reason);});
function Settings(){
 const [tab,setTab]=useState(query.get("tab")||"chats"),[width,setWidth]=useState(innerWidth);
 useEffect(()=>{const cb=()=>setWidth(innerWidth);addEventListener("resize",cb);return()=>removeEventListener("resize",cb);},[]);
 return <SettingsPanel {...{open:true,onOpenChange:noop,settingsTab:tab,onSettingsTabChange:setTab,sectionRequest:query.get("section"),mobile:width<768,memories:[],soundCuesEnabled:false,onSoundCuesEnabledChange:noop,
 voiceInputEnabled:false,voiceMaxDurationSeconds:60,voiceProvider:"openai",voiceModelId:"",voiceRealtime:false,voiceEndpoint:"",onVoiceApiKeySave:async()=>{},onVoiceInputSettingsChange:noop,
 browserEnabled:true,browserRealtime:false,browserFps:1,browserViewportWidth:1280,browserViewportHeight:800,onBrowserSettingsChange:noop,compressionEnabled:false,compressionMode:"standard",compressionToolResults:false,compressionChatHistory:false,onCompressionSettingsChange:noop,
 models:[],favoriteModelKeys:[],onToggleFavoriteModel:noop,subagentModelEnabled:false,onSubagentModelEnabledChange:noop,subagentModelId:"",onSubagentModelIdChange:noop,subagentModelParams:[],onSubagentModelParamsChange:noop,finishSound:null,onFinishSoundChange:noop,onTestFinishSound:noop,onMemoriesChanged:noop,onMemoryDeleted:noop,onChatsChanged:noop,usageSnapshot:null,onRefreshUsage:async()=>{},isHostAdmin:true}}/>;
}
function Fixture(){
 const appearance=useAppearance();
 useEffect(()=>{if(query.get("theme"))appearance.choose(query.get("theme")==="light"?"paper":"midnight");},[]);
 const [area,setArea]=useState(initialArea),[text,setText]=useState(""),[document,setDocument]=useState("# Review\n\nOriginal text.\n\n## Details\n- [ ] Keep this task\n\n[Public link](https://example.com)"),[dialog,setDialog]=useState(""),[opened,setOpened]=useState(0),[confirmCount,setConfirmCount]=useState(0);
 window.__audit={setArea,setDialog,setConfirmCount,opened,query,realFetch,setMode:value=>{mode=value;},setFailure:value=>{fail=value;}};
 return <TooltipProvider><div style={{height:"100dvh",display:"flex",flexDirection:"column",minWidth:0}}>
 <nav aria-label="Audit controls" style={{padding:8,borderBottom:"1px solid var(--border)",display:"flex",gap:8,flexWrap:"wrap",fontSize:12}}>
 <strong>Synthetic UI audit</strong><button id="run-audit" onClick={()=>void runChecks()}>Run checks</button><span id="audit-results"/><select aria-label="Audit area" value={area} onChange={e=>{setArea(e.target.value);setDialog("");}}>{["cards","editor","composer","settings","usage","devices","sharing","dialogs","recent"].map(s=><option key={s}>{s}</option>)}</select>
 <button onClick={()=>{appearance.choose(appearance.theme.mode==="light"?"midnight":"paper");}}>Toggle theme</button>
 <button onClick={()=>{fail=false;setArea("");setTimeout(()=>setArea(area),0);}}>Restore connection</button>
 <span id="fixture-count">Actions: {opened} · Confirmed: {confirmCount}</span><span id="fixture-errors" role="status"/>
 </nav>
 <main style={{flex:1,minHeight:0,overflow:"auto",display:"flex",flexDirection:"column",padding:area==="settings"?0:16}}>
 {area==="cards"?<div style={{width:"100%",maxWidth:760,margin:"0 auto"}}><CanvasWorkspaceCard title={longTitle} content={sample} workspaceLink="workspace://canvas/audit" onOpen={()=>setOpened(n=>n+1)}/><PlanWorkspaceCard title={longTitle} content={sample} workspaceLink="workspace://plan/audit" onOpen={()=>setOpened(n=>n+1)} onBuild={()=>setOpened(n=>n+1)} onBuildWithAgents={()=>setOpened(n=>n+1)} showMultiAgent/></div>:null}
 {area==="editor"?<NotesBlockEditor value={document} onChange={setDocument} editorId="audit-editor" aria-label="Audit notebook editor" />:null}
 {area==="composer"?<div style={{marginTop:"auto",display:"flex",gap:8,alignItems:"end",border:"1px solid var(--border)",borderRadius:12,padding:12}}><ComposerAddMenu onFiles={()=>setOpened(n=>n+1)} onContext={()=>setOpened(n=>n+1)}/><RichComposerInput aria-label="Message" value={text} onChange={setText} placeholder="Ask Metis…"/><Button onClick={()=>setText("")} disabled={!text}>Send</Button></div>:null}
 {area==="settings"?<Settings/>:null}
 {area==="usage"?<div style={{maxWidth:1100,width:"100%",margin:"auto"}}><UsageDashboard/></div>:null}
 {area==="recent"?<RecentlyDeletedChats onChatsChanged={noop}/>:null}
 {area==="devices"?<WorkspaceDesktopsPanel active onOpenDevices={()=>setOpened(n=>n+1)}/>:null}
 {area==="sharing"?<><Button onClick={()=>setDialog("share")}>Share note</Button><Button onClick={()=>setDialog("preview")}>Public preview</Button></>:null}
 {area==="dialogs"?<><Button onClick={()=>setDialog("confirm")}>Open confirmation</Button><Button onClick={()=>setDialog("long")}>Open long confirmation</Button></>:null}
 </main>
 {dialog==="share"?<NoteShareDialog note={{id:"fixture-note",title:longTitle}} onClose={()=>setDialog("")}/>:null}
 {dialog==="preview"?<SharedPreviewDialog title={longTitle} onClose={()=>setDialog("")}><p>{sample}</p></SharedPreviewDialog>:null}
 <ConfirmDialog open={dialog==="confirm"||dialog==="long"} onOpenChange={value=>{if(!value)setDialog("");}} title={longTitle} description={dialog==="long"?sample:"Confirm this synthetic action. The first attempt fails, and the second succeeds."} confirmLabel="Delete fixture" onConfirm={async()=>{setConfirmCount(n=>n+1);await new Promise(resolve=>setTimeout(resolve,500));if(confirmCount===0)throw Error("Synthetic save failed. Retry your action.");}}/>
 </div></TooltipProvider>;
}
createRoot(window.document.getElementById("root")).render(<AppearanceProvider><Fixture/></AppearanceProvider>);
