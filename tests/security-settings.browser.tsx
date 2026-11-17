import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {SettingsPanel} from "../components/settings-panel";
import {AppearanceProvider} from "../components/appearance-provider";
import {TooltipProvider} from "../components/ui/tooltip";
let lists=0;
window.fetch=async(input)=>{
 const url=String(input);
 if(url==="/api/passkeys/list"){lists++;document.title="Security fixture — list requests "+lists;return Response.json({passkeys:[]});}
 return Response.json({clients:[],settings:{},providers:[],definitions:[],connections:[],channels:[]});
};
document.title="Security fixture — list requests 0";
const noop=()=>{},done=async()=>{};
function App(){
 const [tab,setTab]=useState("security"),[mobile,setMobile]=useState(innerWidth<768);
 useEffect(()=>{const resize=()=>setMobile(innerWidth<768);window.addEventListener("resize",resize);return()=>window.removeEventListener("resize",resize);},[]);
 return <AppearanceProvider><TooltipProvider><SettingsPanel
 open onOpenChange={noop} mobile={mobile} settingsTab={tab} onSettingsTabChange={setTab}
 memories={[]} soundCuesEnabled={false} onSoundCuesEnabledChange={noop}
 voiceInputEnabled={false} voiceMaxDurationSeconds={60} voiceProvider="browser" voiceModelId="" voiceRealtime={false} voiceEndpoint="" onVoiceApiKeySave={done} onVoiceInputSettingsChange={noop}
 browserEnabled={false} browserRealtime={false} browserFps={1} browserViewportWidth={960} browserViewportHeight={720} onBrowserSettingsChange={noop}
 compressionEnabled={false} compressionMode="standard" compressionToolResults={false} compressionChatHistory={false} onCompressionSettingsChange={noop}
 models={[]} favoriteModelKeys={[]} onToggleFavoriteModel={noop} subagentModelEnabled={false} onSubagentModelEnabledChange={noop} subagentModelId="" onSubagentModelIdChange={noop} subagentModelParams={[]} onSubagentModelParamsChange={noop}
 finishSound={null} onFinishSoundChange={noop} onTestFinishSound={noop} onMemoriesChanged={noop} onMemoryDeleted={noop} onChatsChanged={noop} usageSnapshot={null} onRefreshUsage={done} isHostAdmin={false}
 /></TooltipProvider></AppearanceProvider>;
}
createRoot(document.getElementById("root")!).render(<App/>);
