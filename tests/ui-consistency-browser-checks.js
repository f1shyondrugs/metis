const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const visible=element=>element&&element.getBoundingClientRect().width>0;
function contrast(element){
 const canvas=document.createElement("canvas");canvas.width=canvas.height=1;const context=canvas.getContext("2d",{willReadFrequently:true});
 const rgba=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data].map((n,i)=>i===3?n/255:n);};
 let background=[255,255,255],parents=[];for(let node=element;node;node=node.parentElement)parents.push(node);
 for(const node of parents.reverse()){const color=rgba(getComputedStyle(node).backgroundColor);background=background.map((n,i)=>color[i]*color[3]+n*(1-color[3]));}
 const fg=rgba(getComputedStyle(element).color),foreground=background.map((n,i)=>fg[i]*fg[3]+n*(1-fg[3]));
 const luminance=rgb=>rgb.map(n=>{const s=n/255;return s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[0.2126,0.7152,0.0722][i],0);
 const a=luminance(foreground),b=luminance(background);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}
const findButton=text=>[...document.querySelectorAll("button")].find(button=>button.textContent.trim()===text&&visible(button));
export async function runChecks(){
 const rows=[],view=()=>window.__audit;
 const check=(label,pass,detail)=>rows.push({label,pass:Boolean(pass),...(detail!==undefined?{detail}:{})});
 const show=async area=>{view().setDialog("");view().setArea(area);await pause(300);};
 document.getElementById("audit-results").textContent="Checking…";
 view().setFailure(false);view().setMode("loaded");
 for(const area of ["cards","editor","composer","settings","usage","devices","sharing","dialogs"]){
   await show(area);
   check(area+" renders",document.querySelector("main")?.children.length>0);
   check(area+" fits viewport",document.documentElement.scrollWidth<=innerWidth+2,{scrollWidth:document.documentElement.scrollWidth,width:innerWidth});
   if(area==="cards"){
     for(const kind of ["canvas","plan"]){
       const card=document.querySelector('[data-workspace-card="'+kind+'"]');
       check(kind+" has one open action",[...card.querySelectorAll("button")].filter(button=>button.textContent.trim()==="Open "+kind).length===1);
       const preview=card.querySelector('[role="region"]');
       check(kind+" preview supports keyboard scrolling",preview.tabIndex===0&&getComputedStyle(preview).overflowY==="auto");
       preview.scrollTop=preview.scrollHeight;
       check(kind+" last paragraph reachable",preview.scrollTop>0);
       for(const element of card.querySelectorAll("header h3,header .text-muted-foreground")){const ratio=contrast(element);check(kind+" header text contrast",ratio>=4.5,Number(ratio.toFixed(2)));}
       const before=view().opened;findButton("Open "+kind)?.click();await pause(50);check(kind+" opens exactly once",view().opened===before+1);
     }
   }
   if(area==="sharing"){
     view().setDialog("share");await pause(250);
     check("note sharing opens with named dialog",document.querySelector('[role="dialog"]')?.textContent.includes("Share note"));
     check("note sharing remains inactive until explicit action",Boolean(findButton("Start sharing")));
     const close=document.querySelector('[role="dialog"] [aria-label="Close"]');
     check("shared close target meets selected size",close?.getBoundingClientRect().width>=(innerWidth<640?44:32));
     close?.click();await pause(80);
     view().setDialog("preview");await pause(200);
     check("public preview uses named close",Boolean(document.querySelector('[aria-label="Close preview"]')));
     document.querySelector('[aria-label="Close preview"]')?.click();await pause(80);
   }
 }
 await show("dialogs");view().setConfirmCount(0);view().setDialog("long");await pause(250);
 let dialog=document.querySelector('[role="dialog"]'),rect=dialog?.getBoundingClientRect();
 check("long confirmation stays inside viewport",rect&&rect.top>=0&&rect.bottom<=innerHeight,{top:rect?.top,bottom:rect?.bottom,height:innerHeight});
 const footer=dialog?.querySelector('[data-slot="dialog-footer"]');
 const footerRect=footer?.getBoundingClientRect();
 check("long confirmation keeps actions visible",footerRect&&footerRect.bottom<=innerHeight&&footerRect.top>=0);
 view().setDialog("confirm");await pause(150);findButton("Delete fixture")?.click();await pause(100);
 check("pending action disables dismissal",Boolean(document.querySelector('[role="dialog"] [aria-label="Close"]')?.disabled));
 await pause(550);
 check("failed action stays open with error",document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes("Synthetic save failed"));
 check("failed action does not leak an unhandled rejection",!document.getElementById("fixture-errors").textContent);
 findButton("Delete fixture")?.click();await pause(650);
 check("retry succeeds and closes dialog",!document.querySelector('[role="dialog"]'));
 await show("recent");
 const permanent=document.querySelector('[aria-label="Permanently delete Synthetic deleted chat"]');
 permanent?.click();await pause(120);view().setFailure(true);findButton("Delete permanently")?.click();await pause(200);
 check("failed permanent delete remains confirmable",Boolean(document.querySelector('[role="dialog"] [role="alert"]')));
 view().setFailure(false);findButton("Delete permanently")?.click();await pause(200);
 check("permanent delete retry closes after success",!document.querySelector('[role="dialog"]'));
 view().setFailure(true);
 for(const area of ["settings","usage","devices"]){
   view().query.set("section","settings-archived");
   await show("");await show(area);
   check(area+" error has explicit retry",Boolean(document.querySelector('[role="alert"]'))&&Boolean(findButton("Retry")));
   const message=document.querySelector('[role="alert"] p');if(message){const ratio=contrast(message);check(area+" error contrast",ratio>=4.5,Number(ratio.toFixed(2)));}
   if(area==="settings")check("failed archive is not shown empty",!document.querySelector("main")?.textContent.includes("No archived chats."));
 }
 view().setFailure(false);view().query.delete("section");
 await show("cards");
 const report={width:innerWidth,height:innerHeight,theme:document.documentElement.classList.contains("dark")?"dark":"light",rows};
 await view().realFetch("/__audit/report",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(report)});
 document.getElementById("audit-results").textContent=rows.filter(row=>row.pass).length+"/"+rows.length+" passed";
 return report;
}
