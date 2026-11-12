import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {SignInScreen} from "../components/sign-in-screen";
import {PasskeySettings} from "../components/passkey-settings";
import {AssistantConversationPanel} from "../components/assistant-conversation-panel";
import {ProductTour} from "../components/client-onboarding";
import {AppearanceProvider} from "../components/appearance-provider";
import type {TourTarget} from "../lib/client-onboarding";
import "../components/desktop-assistant.css";
const view=new URLSearchParams(location.search).get("view")||"login";
function App(){
 const [size,setSize]=useState({width:360,height:360}),[text,setText]=useState("A short answer."),[message,setMessage]=useState(1),[index,setIndex]=useState(0),[target,setTarget]=useState<TourTarget>("chat");
 Object.assign(window,{fixture:{long:()=>setText(("A longer response with useful detail. ").repeat(70)),short:()=>{setMessage(i=>i+1);setText("Short new reply.");},setIndex:(i:number)=>{setIndex(i);setTarget(["chat","projects","notes","devices","integrations","settings"][i] as TourTarget);}}});
 if(view==="login")return <SignInScreen onSignedIn={()=>{document.body.dataset.signedIn="true";}}/>;
 if(view==="settings")return <div style={{maxWidth:560,margin:"40px auto",padding:20}}><PasskeySettings/></div>;
 if(view==="panel")return <main className="desktop-assistant"><AssistantConversationPanel size={size} messageKey={String(message)} onChange={s=>setSize(s)} onMenuOpen={()=>{}} actions={null}><div className="assistant-messages"><div className="assistant-message assistant-message-assistant"><p>{text}</p></div></div></AssistantConversationPanel><div className="assistant-compose"><section className="assistant-input assistant-surface" style={{height:80}}>Synthetic composer</section></div></main>;
 return <><div style={{position:"fixed",left:target==="chat"?"45%":24,top:target==="chat"?"70%":120,width:target==="chat"?"40%":90,height:44}} data-onboarding-target={target}>Target: {target}</div><ProductTour index={index} onIndex={setIndex} onNavigate={setTarget} onPause={()=>{}} onBack={()=>{}} onFinish={()=>{document.body.dataset.finished="true";}}/></>;
}
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(<AppearanceProvider><App/></AppearanceProvider>);
