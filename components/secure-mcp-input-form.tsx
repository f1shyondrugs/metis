"use client";
import {useState,type FormEvent} from "react";
import {Input} from "@/components/ui/input";
import {QuestionFormFrame} from "@/components/question-form-frame";
import type {PendingChatQuestion,QuestionAnswers} from "@/lib/question-contract";

export function SecureMcpInputForm({form,disabled,error,onSubmit,onCancel}:{form:PendingChatQuestion;disabled?:boolean;error?:string|null;onSubmit:(result:QuestionAnswers)=>void;onCancel:()=>void}){
 const [values,setValues]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[filled,setFilled]=useState(false),[failure,setFailure]=useState("");
 const fields=form.secureBrowserInput?.envFields??[];
 const clear=()=>setValues({});
 async function submit(event:FormEvent){
  event.preventDefault();if(disabled||busy)return;
  setBusy(true);setFailure("");
  try{
   if(!filled){
    const response=await fetch("/api/mcp-protected-input",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({questionId:form.questionId,values})});
    if(!response.ok)throw Error("MCP credentials could not be configured. Request a fresh protected form.");
    setFilled(true);
   }
   clear();onSubmit({answers:["MCP credentials configured securely."],values:{secure_login:"MCP credentials configured securely."}});
  }catch(e){setFailure(e instanceof Error?e.message:"MCP configuration failed.");}finally{clear();setBusy(false);}
 }
 return <QuestionFormFrame title="Configure MCP credentials securely" description={`Connection: ${form.secureBrowserInput?.origin}\nValues go directly to this account-owned connection. The AI receives status only.`} submitLabel={filled?"Continue agent":"Save encrypted credentials"} disabled={disabled||busy} error={failure||error} onSubmit={submit} onCancel={()=>{clear();onCancel();}}>
  {!filled&&fields.map((name,index)=><div key={name} className="mt-3 min-w-0 space-y-2"><label htmlFor={`mcp-${form.questionId}-${index}`} className="text-sm font-medium">{name}</label><Input id={`mcp-${form.questionId}-${index}`} type="password" autoComplete="off" autoFocus={index===0} required maxLength={16384} value={values[name]??""} disabled={disabled||busy} onChange={e=>setValues(current=>({...current,[name]:e.target.value}))}/></div>)}
  <p className="mt-3 text-xs text-muted-foreground">Saved encrypted for this MCP connection, not in chat history. Manage or remove values in Settings → MCP. Existing calls finish unchanged; new calls use the updated configuration.</p>
 </QuestionFormFrame>;
}
