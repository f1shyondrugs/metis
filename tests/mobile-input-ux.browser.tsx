import React,{useEffect,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {createPortal} from "react-dom";
import {RichComposerInput} from "../components/rich-composer-input";
import {Input} from "../components/ui/input";
import {Textarea} from "../components/ui/textarea";
import {Button} from "../components/ui/button";
import {QuestionForm} from "../components/question-form";
import {SecureBrowserLoginForm} from "../components/secure-browser-login-form";
import {shouldIgnoreComposerEnter} from "../lib/composer-send";
import {composerIsComposing} from "../lib/composer-references";

const noop=()=>{};
const mirrorProps={underlineMentions:true};
function Fixture(){
 const [text,setText]=useState("@SKILL.md test message"),[report,setReport]=useState("Waiting for layout…");
 const input=useRef<HTMLTextAreaElement>(null),sent=useRef(0),callbacks=useRef(0);
 const [answers,setAnswers]=useState(["","",""]);
 const key=(event:React.KeyboardEvent<HTMLTextAreaElement>)=>{
  callbacks.current++;
  if(composerIsComposing(event.nativeEvent))return;
  if(event.key==="Enter"&&!event.shiftKey&&!shouldIgnoreComposerEnter({key:event.key,shiftKey:event.shiftKey,repeat:event.repeat,isComposing:event.nativeEvent.isComposing,keyCode:event.nativeEvent.keyCode})){event.preventDefault();sent.current++;}
 };
 async function run(){
  const checks:string[]=[];const check=(name:string,ok:boolean)=>{if(!ok)throw Error(name);checks.push("PASS "+name);};
  try{
   const mobile=matchMedia("(max-width:767px), (pointer:coarse)").matches;
   const font=(el:Element)=>parseFloat(getComputedStyle(el).fontSize);
   const controls=document.querySelectorAll<HTMLElement>("[data-small-fields] input:not([type=checkbox]):not([type=radio]), [data-small-fields] textarea, [data-small-fields] select, [data-portal-field] input");
   check("representative native, Ask-User and protected fields are mounted",controls.length>=10);
   for(const [i,el] of [...controls].entries())check((mobile?"mobile 16px ":"desktop compact ")+i, mobile?font(el)>=16:font(el)<17);
   check("large title typography is not reduced",font(document.querySelector("#large-title")!)>=30);
   check("send hint is present",input.current?.enterKeyHint==="send");
   const before=sent.current;
   const enter=new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});input.current!.dispatchEvent(enter);
   check("plain Enter sends once",sent.current===before+1&&enter.defaultPrevented);
   const shift=new KeyboardEvent("keydown",{key:"Enter",shiftKey:true,bubbles:true,cancelable:true});input.current!.dispatchEvent(shift);
   check("Shift+Enter keeps native newline behavior",sent.current===before+1&&!shift.defaultPrevented);
   const repeat=new KeyboardEvent("keydown",{key:"Enter",repeat:true,bubbles:true,cancelable:true});input.current!.dispatchEvent(repeat);
   check("repeated Enter does not send twice",sent.current===before+1);
   const calls=callbacks.current;
   input.current!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true,cancelable:true}));
   check("IME Enter is intercepted before the send callback",sent.current===before+1&&callbacks.current===calls);
   const button=document.querySelector("#press-action")!;
   check("shared button preserves pinch zoom via manipulation",getComputedStyle(button).touchAction==="manipulation");
   const notes=document.querySelector(".notes-source-block textarea")!;
   check("note source field remains readable",mobile?font(notes)>=16:font(notes)===12);
   const mirror=document.querySelector<HTMLElement>("[data-composer-underline]");
   if(mirror){
    check("confirmed mention underline survives responsive typography",!!mirror.querySelector("[data-composer-reference]")&&!mirror.hidden);
    check("underline mirror matches textarea font",font(mirror)===font(input.current!));
    check("underline mirror matches native width",Math.abs(mirror.getBoundingClientRect().width-input.current!.getBoundingClientRect().width)<1.1);
   }
   check("layout does not overflow the viewport",document.documentElement.scrollWidth<=innerWidth+1);
   const value={ok:true,width:innerWidth,height:innerHeight,mobile,checks};
   setReport(checks.join("\n"));await fetch("/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)});
  }catch(error){const value={ok:false,width:innerWidth,error:String(error),checks};setReport(checks.join("\n")+"\nFAIL "+String(error));await fetch("/report",{method:"POST",body:JSON.stringify(value)});}
 }
 useEffect(()=>{let timer:ReturnType<typeof setTimeout>;const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void run(),350);};schedule();window.addEventListener("resize",schedule);return()=>{clearTimeout(timer);window.removeEventListener("resize",schedule);};},[]);
 return <main className="metis-shell mx-auto max-w-3xl space-y-5 p-4">
  <header><h1 className="text-xl font-semibold">Mobile interaction checks</h1><p className="text-sm text-muted-foreground">Isolated components · synthetic content · no account data</p></header>
  <section data-small-fields className="space-y-3 rounded-lg border p-4">
   <h2>Chat</h2><RichComposerInput {...mirrorProps} ref={input} value={text} mentionLabels={["SKILL.md"]} onChange={setText} onKeyDown={key} aria-label="Test message" className="max-sm:text-[15px]"/>
   <h2>Compact form controls</h2><Input aria-label="Small input" className="text-sm" placeholder="Input"/>
   <Textarea aria-label="Small textarea" className="text-sm" placeholder="Textarea"/>
   <Input aria-label="Email" type="email" autoComplete="email" className="text-sm" placeholder="Email"/>
   <Input aria-label="Decimal" type="number" inputMode="decimal" className="text-xs" placeholder="Decimal"/>
   <select aria-label="Native select" className="text-sm w-full rounded-lg border p-2"><option>Native select</option></select>
   <QuestionForm form={{questionId:"mobile-question",questions:[{id:"answer",question:"Short answer",type:"text"},{id:"long",question:"Long answer",type:"textarea"},{id:"select",question:"Choose one",type:"select",options:[{label:"One",value:"one"}]}]}} answers={answers} custom={["","",""]} customActive={[false,false,false]} onAnswersChange={setAnswers} onCustomChange={noop} onCustomActiveChange={noop} onSubmit={noop} onCancel={noop}/>
   <SecureBrowserLoginForm form={{questionId:"protected-fixture",questions:[],secureBrowserInput:{requestId:"synthetic-only",origin:"https://example.test",expiresAt:"2099-01-01T00:00:00Z",fields:["username","email","password"]}}} onSubmit={noop} onCancel={noop}/>
  </section>
  <section className="notes-block-editor rounded-lg border p-4"><h2>Notebook source</h2><div className="notes-source-block"><textarea aria-label="Notebook source" defaultValue="Synthetic code sample"/></div></section>
  <section><label htmlFor="large-title">Display-sized title stays large</label><input id="large-title" className="text-3xl w-full bg-transparent" defaultValue="Example title"/></section>
  <section className="flex gap-2"><Button id="press-action" onClick={()=>void run()}>Run checks</Button><button className="automation-create-button" aria-label="Automation test">+</button><button className="touch-manipulation rounded-lg border p-2 hover:border-foreground/40 active:border-foreground/60 active:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring">Image action</button></section>
  <pre id="report" className="whitespace-pre-wrap rounded-lg border p-3 text-xs" aria-live="polite">{report}</pre>
  {createPortal(<div data-portal-field className="fixed bottom-2 right-2 max-w-32 rounded-lg border bg-background p-2"><Input aria-label="Portal input" className="text-sm" placeholder="Portal field"/></div>,document.body)}
 </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
