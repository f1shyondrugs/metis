import{BookOpen,Star}from"lucide-react";
import React,{useState}from"react";import{createRoot}from"react-dom/client";import{ModelPicker}from"../components/model-picker";import{ReferencePicker}from"../components/reference-picker";import{AutomationsPanel}from"../components/automations-panel";import{useReferenceSearch}from"../components/use-reference-search";import type{ModelInfo}from"../components/settings-panel";import type{ReferenceKind}from"../lib/reference-search";
const wait=(n=150)=>new Promise(r=>setTimeout(r,n));async function until(check:()=>boolean,label:string){for(let i=0;i<160;i++){if(check())return;await wait(50);}throw Error(label);}
async function press(node:Element|null|undefined){if(!(node instanceof HTMLElement))throw Error("Missing control");if(node.getAttribute("aria-haspopup")==="menu"){node.focus();node.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));}else node.click();await wait();}
const longName="Synthetic model with a deliberately extremely long model name and extended provider/account label · Long internal connection display name for overflow regression";
export function renderIconFixture(Footer:React.ComponentType<{label:string}>){
 function Fixture(){
  const[kind,setKind]=useState<ReferenceKind|null>("note"),[query,setQuery]=useState(""),[model,setModel]=useState("synthetic-long");
  const refs=useReferenceSearch({enabled:true,kind,query});
  const models=[{id:"synthetic-long",displayName:longName,providerId:"openai",providerName:"Synthetic provider",connectionLabel:"Very long synthetic organization connection account"},{id:"synthetic-second",displayName:"Other synthetic model",providerId:"openai",connectionLabel:"Another connection"}] as ModelInfo[];
  const[report,setReport]=useState<string[]>([]);
  async function run(){
   const results:string[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);results.push("PASS "+label);setReport([...results]);};
   const row=(label:string)=>[...document.querySelectorAll<HTMLElement>("[data-reference-fixture] [role=option]")].find(e=>e.textContent?.includes(label));
   const category=async(label:string)=>{await press(document.querySelector('[data-reference-fixture] [aria-label="All categories"]'));await press(document.querySelector('[data-reference-fixture] [aria-label="'+label+'"]'));await until(()=>document.querySelector('[data-reference-fixture] [aria-busy]')?.getAttribute("aria-busy")==="false","category ready "+label);};
   try{
    await until(()=>!!row("Colorful project note")&&!!document.querySelector('[aria-label="Edit Morning report"]'),"initial data");
    const footer=document.querySelector<HTMLElement>("[data-model-footer]")!,quota=document.querySelector<HTMLElement>("[data-quota]")!,f=footer.getBoundingClientRect(),q=quota.getBoundingClientRect();
    check(q.right<=f.right+1&&q.left>=f.left&&q.width>60,"Context and Usage fit inside the actual composer footer");
    if(innerWidth>=768){const button=footer.querySelector<HTMLButtonElement>('button[aria-label^="Model:"]')!;check(getComputedStyle(button).flexShrink==="1","model trigger yields space to quota controls");check(button.getBoundingClientRect().width<=352.1,"long model/provider label has a bounded trigger");check(button.getAttribute("aria-label")?.includes(longName),"full model/account label remains accessible");}
    else check(footer.getBoundingClientRect().right<=innerWidth,"mobile footer remains bounded");
    const picker=document.querySelector<HTMLButtonElement>('[aria-label="Fixture model"]')!;check(picker.getBoundingClientRect().right<=innerWidth&&picker.getAttribute("aria-description")?.includes(longName),"shared model picker is bounded and discloses the full selected value");
    await press(picker);await until(()=>!!document.querySelector('[role=menuitem]'),"model menu");
    check([...document.querySelectorAll<HTMLElement>('[role=menuitem]')].some(e=>e.title.includes(longName)),"full long model is available in the operable picker");
    await press([...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(e=>e.textContent?.includes("Other synthetic model")));await until(()=>picker.textContent?.includes("Other synthetic model")===true,"model changed");check(true,"selecting another model still works");
    const note=row("Colorful project note")!;
    const glyph=(scope:Element|null|undefined)=>scope?.querySelector("svg")?.innerHTML;
    await until(()=>glyph(note.querySelector("[data-reference-result-icon]"))===glyph(document.querySelector("[data-expected-book]")),"note glyph loaded");
    check(true,"note results show their custom glyph");
    check(getComputedStyle(note.querySelector<HTMLElement>('[data-reference-result-icon] span[style]')!).color==="rgb(48, 160, 112)","note glyph keeps its custom color");
    check(!!note.querySelector('[data-reference-project] .lucide-rocket'),"note breadcrumb includes the actual project icon");
    check(getComputedStyle(note.querySelector<HTMLElement>('[data-reference-project] span[style]')!).color==="rgb(229, 86, 68)","project icon keeps its stored color");
    await category("Chats");await until(()=>!!row("Project discussion"),"chat row");check(!!row("Project discussion")!.querySelector('[data-reference-project] .lucide-rocket'),"chat results carry their project icon and name");
    await category("Calendar events");await until(()=>!!row("Project planning"),"calendar row");
    const event=row("Project planning")!;check(event.textContent?.includes("Synthetic work"),"calendar event results show their calendar name");check(getComputedStyle(event.querySelector<HTMLElement>('[aria-label="Calendar color"]')!).backgroundColor==="rgb(18, 164, 86)","calendar event results show the actual calendar color");
    await category("Automations");await until(()=>!!row("Morning report"),"automation row");check(true,"Automations are selectable in the Add/context menu");
    const data=await(await fetch("/api/automations")).json(),id=data.automations[0].id;
    await fetch("/api/automations/"+id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({icon:null})});
    await press(document.querySelector('[aria-label="Edit Morning report"]'));await until(()=>!!document.querySelector('button[aria-label$="automation icon"]'),"icon editor");
    const trigger=document.querySelector<HTMLButtonElement>('button[aria-label$="automation icon"]')!;check(trigger.getBoundingClientRect().height>=44,"automation icon picker has an accessible touch target");await press(trigger);
    await until(()=>!!document.querySelector('[aria-label="Automation icon picker"]'),"native picker");
    check(true,"automation editor reuses the native searchable icon picker");
    const color=document.querySelector<HTMLButtonElement>('[aria-label^="Icon color #"]')!;await press(color);const hex=color.getAttribute("aria-label")!.slice("Icon color ".length);
    await press(document.querySelector<HTMLButtonElement>('[data-page-icon][aria-label="Select Star"]'));await until(()=>!document.querySelector('[aria-label="Automation icon picker"]'),"icon chosen");
    const original=window.fetch;let fail=true,lastPatchKeys:string[]=[];window.fetch=async(input,init)=>{if(String(input).startsWith("/api/automations/")&&init?.method==="PATCH"){lastPatchKeys=Object.keys(JSON.parse(String(init.body)));if(fail){fail=false;return Response.json({error:"Synthetic icon save failure"},{status:503});}}return original(input,init);};
    const form=document.querySelector<HTMLFormElement>(".automation-edit-form")!;
    try{await until(()=>!form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,"destinations loaded");form.requestSubmit();await until(()=>document.querySelector('[role="alert"]')?.textContent?.includes("Synthetic icon save failure")===true,"save failure");
     check(!!document.querySelector(".automation-edit-form")&&glyph(trigger)===glyph(document.querySelector("[data-expected-star]")),"failed save keeps the chosen icon and editable draft");
     form.requestSubmit();await until(()=>!document.querySelector(".automation-edit-form"),"saved icon");
    }finally{window.fetch=original;}
    check(lastPatchKeys.length===1&&lastPatchKeys[0]==="icon","an icon-only editor save never submits execution or schedule changes");
    const saved=await(await fetch("/api/automations/"+id)).json();check(saved.automation.icon==="lucide:star:"+hex,"selected glyph and color persist through the canonical API");
    await until(()=>glyph(document.querySelector(".automation-list-icon"))===glyph(document.querySelector("[data-expected-star]"))&&glyph(document.querySelector(".automation-detail-icon"))===glyph(document.querySelector("[data-expected-star]")),"saved glyph rendered");check(true,"saved custom icon appears in automation list and details");
    await category("Notes");await category("Automations");await until(()=>!!row("Morning report")&&glyph(row("Morning report")!.querySelector("[data-reference-result-icon]"))===glyph(document.querySelector("[data-expected-star]")),"updated reference icon");
    check(true,"saved automation icon appears in the Add/context menu");
    check(!!row("Morning report")!.querySelector('[data-reference-project] .lucide-rocket'),"automation references include their project appearance");
    document.documentElement.classList.remove("dark");await wait();check(document.body.scrollWidth<=innerWidth,"light theme remains within the viewport");document.documentElement.classList.add("dark");await wait();check(document.body.scrollWidth<=innerWidth,"dark theme remains within the viewport");
    await fetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,passed:true,results})});
   }catch(e){const failed=[...results,"FAIL "+String(e)];setReport(failed);await fetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,passed:false,results:failed})});}
  }
  return <main className="bg-background text-foreground p-4 space-y-4"><span data-expected-book className="sr-only"><BookOpen/></span><span data-expected-star className="sr-only"><Star/></span><h1>Model footer and reference icons · synthetic data</h1><button className="min-h-11 border border-border rounded px-3" onClick={()=>void run()}>Run icon checks</button>
   <div data-footer-width style={{width:"100%",maxWidth:620}}><Footer label={longName}/></div>
   <div style={{maxWidth:450}}><ModelPicker models={models} value={model} onValueChange={setModel} favoriteModelKeys={[]} onToggleFavorite={()=>{}} ariaLabel="Fixture model"/></div>
   <div data-reference-fixture style={{maxWidth:450}} className="border border-border rounded-lg p-2"><ReferencePicker id="icons-fixture" kind={kind} query={query} results={refs.results} loading={refs.loading} indexing={refs.indexing} error={refs.error} retry={refs.retry} index={0} onIndex={()=>{}} onCategory={setKind} onQuery={setQuery} onSelect={()=>{}} onKeyDown={()=>{}}/></div>
   <div className="h-[800px]"><AutomationsPanel modes={[{id:"agent",name:"Agent",description:"Synthetic agent mode"}] as never} models={models} onOpenChat={()=>{}}/></div>
   <pre className="text-xs whitespace-pre-wrap">{report.join("\n")}</pre>
  </main>;
 }document.documentElement.classList.add("dark");createRoot(document.getElementById("root")!).render(<Fixture/>);
}
