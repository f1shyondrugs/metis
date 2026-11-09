import type {Page,Locator} from "playwright";
import {browserInputSecrets,retainBrowserSecrets} from "./browser-secure-input";
import {browserSecretRepresentations} from "../services/browser-login/navigation-policy";

export const BROWSER_CREDENTIAL_SELECTOR='input[type="password"], input[type="email"], input[autocomplete="username"], input[name="username" i], input[id^="username" i], input[name="login" i], input[name="user" i], input[autocomplete*="password"], input[autocomplete="one-time-code"], input[autocomplete^="cc-"], input[name*="token" i], input[name*="secret" i], input[name*="password" i], input[name*="passwd" i], input[name="pwd" i], input[id*="password" i], input[id*="passwd" i], input[id="pwd" i], textarea[autocomplete*="password"], [data-metis-sensitive="true"]';
export async function screenshotFieldMasks(page:Page):Promise<Locator[]>{
 const frames=page.frames(),mask:Locator[]=[],observed:string[]=[];
 try{
  for(const frame of frames){
   const result=await frame.locator(BROWSER_CREDENTIAL_SELECTOR).evaluateAll(elements=>({
    values:elements.map(el=>"value" in el?String((el as HTMLInputElement).value||""):el.textContent||"").filter(Boolean),
    // Native password bullets remain visible. CSS-revealed controls still need a mask.
    unsafePasswords:elements.flatMap((el,index)=>el instanceof HTMLInputElement&&el.type==="password"&&
      !["disc","circle","square"].includes(getComputedStyle(el).getPropertyValue("-webkit-text-security"))?[index]:[]),
   }));
   observed.push(...result.values);
   retainBrowserSecrets(page,result.values);
   mask.push(frame.locator(":is("+BROWSER_CREDENTIAL_SELECTOR+'):not(input[type="password"])'));
   for(const index of result.unsafePasswords)mask.push(frame.locator(BROWSER_CREDENTIAL_SELECTOR).nth(index));
  }
  const values=[...new Set([...browserInputSecrets(page),...observed])];
  if(values.length){
   const variants=[...new Set(values.flatMap(browserSecretRepresentations))];
   for(const frame of frames){
    const reflected=await frame.locator("body").evaluate((body,{selector,variants})=>{
      const text:string[]=[];
      const visit=(node:Node)=>{
        if(node.nodeType===Node.TEXT_NODE){text.push(node.textContent||"");return;}
        if(node instanceof Element&&node.matches("script,style,template,noscript,"+selector))return;
        for(const child of node.childNodes)visit(child);
        if(node instanceof Element&&node.shadowRoot)visit(node.shadowRoot);
      };
      visit(body);
      const content=text.join("");
      return variants.some(value=>content.includes(value));
    },{selector:BROWSER_CREDENTIAL_SELECTOR,variants});
    if(reflected)throw Error("Sensitive form value is reflected outside its field");
    // A drawing can contain reflected values without DOM text.
    mask.push(frame.locator("canvas"));
   }
  }
  return mask;
 }catch{throw Error("Screenshot unavailable while sensitive form values are present or field inspection is unavailable");}
}
