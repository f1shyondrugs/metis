import { DatabaseSync } from "node:sqlite";
import {parseProtectedLoginReply,requireProtectedInput,type ProtectedLoginReply} from "../../lib/protected-login-contract";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { SecureBrowserInputs, CredentialFieldsNotVisible, browserInputSecrets, browserHasSecureInput, retainBrowserSecrets,type CredentialField } from "../../lib/browser-secure-input";
import { ProtectedLoginError } from "../../lib/protected-login-errors";
import { publicBrowserProxy } from "./public-proxy";
import { browserSecretRepresentations, loginNavigationOrigins, protectedRequestAllowed, withOperatorReturnOrigins } from "./navigation-policy";
import {ScopedCredentials} from "./scoped-credentials";
import {secureConsole} from "./console-client";
import { snapshotOperatorReturnOrigins, type OperatorReturnOrigins } from "./operator-return-origins";
import { installProtectedRedirectGuard } from "./redirect-guard";

type PublicResource={body:Buffer;headers:Record<string,string>};
function publicResourceKey(value:string){const url=new URL(value);if(/^\d+$/.test(url.searchParams.get("_")||""))url.searchParams.delete("_");return url.href;}
type Session = { browser: Browser; context: BrowserContext; page: Page; origin: string; navigationOrigins:Set<string>; declaredOrigins:ReadonlySet<string>; publicResources:Map<string,PublicResource>;resourceBytes:number; used: number };
type LoginInput = Record<string, unknown> & {
  kind?:string; origin?:string; password?:string; username?:string; email?:string;
  requestId?:string; persist?:boolean; replace?:boolean; url?:string; fields?:CredentialField[];
  selector?:string; usernameSelector?:string; emailSelector?:string; action?:string;
  text?:string; key?:string; value?:string|string[]; includeSnapshot?:boolean;
  deltaY?:number; width?:number; height?:number;
};
type Payload = { owner: string; chat?: string; operation: string; input?: LoginInput };
function requiredText(value:unknown):string {
  if(typeof value!=="string")throw Error("Missing protected login field");
  return value;
}

export class SavedBrowserLogins {
  private db: DatabaseSync;
  private credentials:ScopedCredentials;
  private sessions = new Map<string, Session>();
  private locks = new Map<string, Promise<unknown>>();
  private inputs = new SecureBrowserInputs();
  private requests = new Map<string, { owner: string; chat: string; origin: string; persist?:boolean }>();
  private proxy: Awaited<ReturnType<typeof publicBrowserProxy>> | undefined;
  private consoleRequests=new Map<string,{owner:string;chat:string;target:string;label:string;persist?:boolean}>();
  private readonly operatorReturnOrigins: OperatorReturnOrigins;
  constructor(private key: Buffer, database: string, private testProxy?: string, operatorReturnOrigins: OperatorReturnOrigins = {}) {
    if (key.length !== 32) throw Error("Invalid key");
    this.operatorReturnOrigins = snapshotOperatorReturnOrigins(operatorReturnOrigins);
    this.db = new DatabaseSync(database);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS website_logins(owner TEXT NOT NULL, origin TEXT NOT NULL, envelope TEXT NOT NULL, PRIMARY KEY(owner,origin));");
    this.credentials=new ScopedCredentials(key,this.db);
  }
  private site(value: string | undefined) {
    let url: URL;
    try { url = new URL(requiredText(value)); } catch { throw new ProtectedLoginError("https_required"); }
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") throw new ProtectedLoginError("https_required");
    return url;
  }
  private scrub<T>(page: Page, value: T): T {
    const secrets = browserInputSecrets(page);
    const variants = secrets.flatMap(browserSecretRepresentations).sort((a,b) => b.length-a.length);
    if (typeof value === "string") return variants.reduce((text, secret) => text.split(secret).join("[REDACTED]"), value) as T;
    if (Array.isArray(value)) return value.map(item => this.scrub(page,item)) as T;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,this.scrub(page,item)])) as T;
    return value;
  }
  private async session(owner: string, chat: string, url?: string) {
    const key = `${owner}:${chat}`;
    for (const [id, old] of this.sessions) if (Date.now()-old.used > 15*60_000) {
      this.sessions.delete(id); await old.browser.close();
    }
    let session = this.sessions.get(key);
    if (!session) {
      if (!url) throw new ProtectedLoginError("session_unavailable");
      if (this.sessions.size >= 8) throw new ProtectedLoginError("session_limit");
      const target = this.site(url);
      const declaredOrigins = loginNavigationOrigins(target);
      const navigationOrigins = withOperatorReturnOrigins(declaredOrigins, this.operatorReturnOrigins[target.origin]);
      this.proxy ??= this.testProxy ? undefined : await publicBrowserProxy();
      const browser = await chromium.launch({ headless:true, chromiumSandbox:true,
        proxy:{server:this.testProxy || this.proxy!.url, bypass:"<-loopback>"},
        args:["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"] });
      const context = await browser.newContext({serviceWorkers:"block",acceptDownloads:false,ignoreHTTPSErrors:Boolean(this.testProxy)});
      const page = await context.newPage();
      session = { browser, context, page, origin:target.origin, navigationOrigins, declaredOrigins, publicResources:new Map(),resourceBytes:0,used:Date.now() };
      const current = session;
      context.on("close",()=>{
        if(this.sessions.get(key)===current)this.sessions.delete(key);
        void browser.close().catch(()=>{});
      });
      context.setDefaultTimeout(8000); context.setDefaultNavigationTimeout(20_000);
      context.on("response",response=>{void(async()=>{
        const request=response.request();
        if(browserHasSecureInput(page)||request.method()!=="GET"||request.isNavigationRequest()||response.status()!==200||new URL(response.url()).origin===current.origin||current.publicResources.size>=64)return;
        const headers=await response.allHeaders();
        if(Number(headers["content-length"]||0)>1024*1024)return;
        const body=await response.body();
        if(body.length>1024*1024||current.resourceBytes+body.length>16*1024*1024)return;
        for(const name of ["set-cookie","content-encoding","content-length","transfer-encoding"])delete headers[name];
        const key=publicResourceKey(request.url());
        current.resourceBytes-=current.publicResources.get(key)?.body.length||0;
        current.publicResources.set(key,{body,headers});current.resourceBytes+=body.length;
      })().catch(()=>{});});
      await context.route("**/*", async route => {
        try {
          const request = route.request();
          const destination = this.site(request.url());
          // Keep arbitrary third parties blocked, while permitting the declared
          // SSO return site without forwarding the password to that site.
          if (browserHasSecureInput(page) && !protectedRequestAllowed(page,request,current.origin,current.navigationOrigins)) {
            // Re-render public school metadata/assets already received before
            // credentials. No live request, cookie or password leaves the process.
            const cached=request.method()==="GET"&&!request.isNavigationRequest()?current.publicResources.get(publicResourceKey(request.url())):undefined;
            if(cached)return route.fulfill({status:200,...cached});
            return route.abort();
          }
          return route.continue();
        } catch { return route.abort(); }
      });
      await context.routeWebSocket("**/*", socket => socket.close());
      context.on("page", extra => { if (extra !== page) void extra.close(); });
      try { await installProtectedRedirectGuard(context,page,()=>({credentialOrigin:current.origin,origins:current.navigationOrigins})); }
      catch { await browser.close(); throw new ProtectedLoginError("page_unavailable"); }
      this.sessions.set(key, session);
      try { await page.goto(target.href, {waitUntil:"domcontentloaded"}); }
      catch { this.sessions.delete(key); await browser.close(); throw new ProtectedLoginError("page_unavailable"); }
    }
    // A supplied URL seeds a new private context only. Repeated preparation
    // must preserve school selection, identifier steps and authenticated state.
    session.used = Date.now(); return session;
  }
  private async state(session: Session):Promise<ProtectedLoginReply> {
    const {page} = session;
    retainBrowserSecrets(page,(await session.context.cookies()).map(cookie=>cookie.value));
    retainBrowserSecrets(page,await page.locator('input[type="hidden"]').evaluateAll(elements=>elements.map(el=>(el as HTMLInputElement).value)).catch(()=>[]));
    const url=new URL(page.url());
    retainBrowserSecrets(page,[...url.searchParams.values(),...new URLSearchParams(url.hash.slice(1)).values()]);
    // Auth codes in redirect queries/fragments must never enter model context.
    const publicUrl=url.origin+url.pathname;
    return this.scrub(page,{sessionId:"protected",tabId:"protected",activeTabId:"protected",url:publicUrl,title:await page.title(),tabs:[{id:"protected",url:publicUrl,title:await page.title()}],viewport:page.viewportSize()});
  }
  async dispatch(payload: Payload, management: boolean) {
    if (!/^[\w-]{1,200}$/.test(payload.owner) || payload.chat && !/^[\w-]{1,200}$/.test(payload.chat)) throw Error("Invalid identity");
    // Serialize revocation with all of this owner's in-flight fills, including
    // other chats. A concurrent delete/update must never be undone by a fill.
    const lock = payload.owner;
    const previous = this.locks.get(lock) ?? Promise.resolve();
    const next = previous.catch(()=>{}).then(()=>this.perform(payload,management));
    this.locks.set(lock,next);
    try { return await next; } finally { if (this.locks.get(lock)===next) this.locks.delete(lock); }
  }
  private async perform({owner,chat,operation,input={}}: Payload, management: boolean): Promise<ProtectedLoginReply> {
    if (operation === "list" && management) return parseProtectedLoginReply({credentials:this.credentials.list(owner)});
    if (operation === "delete" && management) {
      if(input.kind==="console"){
        this.credentials.delete(owner,"console",String(input.origin));
        return {status:"deleted"};
      }
      const origin = this.site(input.origin).origin;
      this.credentials.delete(owner,"browser",origin);
      for (const [id,s] of this.sessions) if (id.startsWith(`${owner}:`) && s.origin===origin) {this.sessions.delete(id);await s.browser.close();}
      return {status:"deleted"};
    }
    if (operation === "update" && management) {
      if(input.kind==="console"){
        const target=String(input.origin);
        const existing=this.db.prepare("SELECT label FROM console_logins WHERE owner=? AND target=?").get(owner,target) as {label:string}|undefined;
        if(!existing)throw Error("Credential unavailable");
        this.credentials.save(owner,"","console",target,requiredText(input.password),true,existing.label);
        this.credentials.clearTemporary(owner,"console",target);input.password="";
        return {status:"updated"};
      }
      const origin=this.site(input.origin).origin;
      if(!["password","username","email"].some(key=>typeof input[key]==="string"&&input[key]))throw Error("Invalid credentials");
      const result=this.db.prepare("SELECT 1 FROM website_logins WHERE owner=? AND origin=?").get(owner,origin);
      if(!result)throw Error("Credential unavailable");
      this.credentials.saveValues(owner,"","browser",origin,Object.fromEntries(["password","username","email"].filter(key=>input[key]!==undefined).map(key=>[key,input[key]])),true);
      input.password="";
      this.credentials.clearTemporary(owner,"browser",origin);
      for(const [id,s] of this.sessions)if(id.startsWith(`${owner}:`)&&s.origin===origin){this.sessions.delete(id);await s.browser.close();}
      return {status:"updated"};
    }
    if (!chat) throw Error("Chat required");
    if(operation==="console_prepare"||operation==="console_elevate"){
      const prepared=await secureConsole(owner,chat,operation==="console_elevate"?"elevate":"prepare",input);
      if(prepared.status!=="input_required")return prepared;
      if(this.consoleRequests.size>=100)this.consoleRequests.delete(this.consoleRequests.keys().next().value!);
      const secureInput=requireProtectedInput(prepared),target=requiredText(prepared.target),label=requiredText(prepared.label);
      this.consoleRequests.set(secureInput.requestId,{owner,chat,target,label});
      const saved=this.credentials.get(owner,chat,"console",target);
      if(saved&&!input.replace){await secureConsole(owner,chat,"fill",{requestId:secureInput.requestId,password:saved.password});return {status:"console_password_entered",sessionId:prepared.sessionId};}
      return prepared;
    }
    if(operation==="console_fill"&&management){
      const request=this.consoleRequests.get(input.requestId ?? "");
      if(!request||request.owner!==owner||request.chat!==chat)throw Error("Request unavailable");
      await secureConsole(owner,chat,"fill",{requestId:input.requestId,password:input.password});
      this.credentials.save(owner,chat,"console",request.target,requiredText(input.password),input.persist===true,request.label);
      request.persist=input.persist===true;
      input.password="";return {status:input.persist===true?"filled_and_saved":"filled_for_chat"};
    }
    if(operation==="console_status"&&management){const result=await secureConsole(owner,chat,"status",input);const saved=this.consoleRequests.get(input.requestId ?? "");return {filled:result.filled&&saved?.persist!==undefined,scope:saved?.persist?"permanent":"chat"};}
    if(["console_read","console_input","console_close"].includes(operation))return secureConsole(owner,chat,operation.slice(8),input);
    if(operation==="forget_chat"){
      this.credentials.forgetChat(owner,chat);
      await secureConsole(owner,chat,"close").catch(()=>{});
      const id=`${owner}:${chat}`,s=this.sessions.get(id);this.sessions.delete(id);await s?.browser.close();return {status:"forgotten"};
    }
    if (operation === "close") {
      const key=`${owner}:${chat}`, s=this.sessions.get(key);this.sessions.delete(key);await s?.browser.close();return {closed:true};
    }
    if (operation === "fill" && management) {
      const request=this.requests.get(input.requestId ?? "");
      if (!request || request.owner!==owner || request.chat!==chat) throw Error("Request unavailable");
      const supplied=Object.fromEntries(["password","username","email"].filter(key=>input[key]!==undefined).map(key=>[key,input[key]]));
      const values={...this.credentials.get(owner,chat,"browser",request.origin),...supplied} as Partial<Record<CredentialField,string>>;
      await this.inputs.fillValues(owner,chat,requiredText(input.requestId),values);
      this.credentials.saveValues(owner,chat,"browser",request.origin,supplied,input.persist===true);
      request.persist=input.persist===true;
      input.password="";input.username="";input.email="";return {status:input.persist===true?"filled_and_saved":"filled_for_chat"};
    }
    if (operation === "status" && management) {const saved=this.requests.get(input.requestId ?? "");return {filled:this.inputs.status(owner,chat,requiredText(input.requestId))&&saved?.persist!==undefined,scope:saved?.persist?"permanent":"chat"};}
    if (operation === "prepare") {
      const session=await this.session(owner,chat,input.url);
      const origin=this.site(session.page.url()).origin;
      if (origin!==session.origin) {
        if(browserHasSecureInput(session.page))throw Error("Website changed; open its login page again");
        const navigationOrigins=withOperatorReturnOrigins(new Set([...session.declaredOrigins,origin]),this.operatorReturnOrigins[origin]);
        session.origin=origin;
        session.navigationOrigins=navigationOrigins;
      }
      const fields:CredentialField[]=input.fields??["password"];
      let request;
      try {
        request = await this.inputs.prepare(owner,chat,session.page,input.selector,{fields,usernameSelector:input.usernameSelector,emailSelector:input.emailSelector});
      } catch (error) {
        if (!(error instanceof CredentialFieldsNotVisible)) throw error;
        return {
          status:"protected_browser_ready", code:"credential_fields_not_visible",
          missingFields:error.missingFields, ...await this.state(session),
          instruction:"The private browser has a separate website session. Inspect browser_form_state and complete any school, tenant or earlier login step here, then retry browser_request_login with selectors for visible fields. Request username/email through browser_request_login too. Never request credentials through ordinary chat or ask_user. No credentials were entered and no login dialog was created.",
        };
      }
      const saved=this.credentials.get(owner,chat,"browser",origin);
      if (saved && !input.replace&&fields.every(field=>typeof saved[field]==="string"&&saved[field])) {
        await this.inputs.fillValues(owner,chat,request.requestId,saved as Partial<Record<CredentialField,string>>);
        return {status:"filled_saved",origin};
      }
      if (this.requests.size>=100) this.requests.delete(this.requests.keys().next().value!);
      this.requests.set(request.requestId,{owner,chat,origin});
      return {status:"input_required",secureInput:request};
    }
    if (operation !== "action") throw Error("Denied");
    const session=await this.session(owner,chat),{page}=session;
    const action=input.action;
    if (action === "navigate") {
      const target=this.site(input.url);
      if (!session.navigationOrigins.has(target.origin)) throw Error("Protected login is bound to its website and declared return site; close browser before changing sites");
      await page.goto(target.href,{waitUntil:"domcontentloaded"});
    } else if (action === "click") {
      if (!input.selector) throw Error("Use a DOM selector");
      await page.locator(input.selector).click();
    } else if (action === "type") {
      if (!input.selector) throw Error("Use a DOM selector");
      const target=page.locator(input.selector);
      if (await target.evaluate((el: Element)=>el instanceof HTMLInputElement && el.type==="password")) throw Error("Use browser_request_login for passwords");
      await target.fill(String(input.text ?? ""));
    } else if (action === "press") await (input.selector?page.locator(input.selector):page.locator("body")).press(requiredText(input.key));
    else if (action === "back") await page.goBack();
    else if (action === "forward") await page.goForward();
    else if (action === "reload") await page.reload();
    else if (action === "select_option") await page.locator(requiredText(input.selector)).selectOption(input.value ?? "");
    else if (action === "wait_for") await page.locator(requiredText(input.selector)).waitFor();
    else if (action === "scroll") await page.evaluate(y=>scrollBy(0,y),Number(input.deltaY)||600);
    else if (action === "resize") await page.setViewportSize({width:Math.max(320,Math.min(2560,Number(input.width)||1280)),height:Math.max(240,Math.min(1600,Number(input.height)||800))});
    else if (action === "screenshot" || action === "download" || action === "batch" || action === "upload_file" || action === "upload_files" || action === "drop_files") throw Error("This operation is unavailable in a protected login; use DOM tools and individual actions");
    else if (!["snapshot","extract_text","form_state","select_tab"].includes(action ?? "")) throw Error("Unsupported protected-browser action");
    if(action==="click"||action==="press")await page.waitForLoadState("domcontentloaded",{timeout:8000});
    const result=await this.state(session);
    if (action==="form_state") {
      const reference = randomUUID();
      const controls = await page.locator("input,textarea,select,button,a[href]").evaluateAll((elements, prefix) => elements.slice(0,300).map((el,index) => {
        el.setAttribute("data-metis-login-ref", `${prefix}-${index}`);
        return {
          index, selector:"", tag:el.tagName.toLowerCase(), type:(el as HTMLInputElement).type,
          visible:el.getBoundingClientRect().width>0 && el.getBoundingClientRect().height>0 && !["hidden","collapse"].includes(getComputedStyle(el).visibility),
          id:el.id, name:(el as HTMLInputElement).name, label:(el.textContent||"").slice(0,200),
          value:el instanceof HTMLInputElement && el.type==="password" ? "[REDACTED]" : (el as HTMLInputElement).value,
          options:el instanceof HTMLSelectElement ? Array.from(el.options).map(option => ({value:option.value,text:option.text,selected:option.selected,disabled:option.disabled})) : undefined,
        };
      }), reference);
      result.form = this.scrub(page,{text:await page.locator("body").innerText(),controls});
      // Only these engine-generated selectors bypass value redaction. Raw DOM
      // ids/names/options remain scrubbed, including secrets that are very short.
      result.form!.controls.forEach((control:Record<string,unknown>, index:number) => {
        control.selector = `[data-metis-login-ref="${reference}-${index}"]`;
      });
    }
    if (["snapshot","extract_text"].includes(action ?? "") || input.includeSnapshot) result.snapshot=this.scrub(page,(await page.locator("body").innerText()).slice(0,120000));
    return result;
  }
  async close() { for(const s of this.sessions.values())await s.browser.close();this.sessions.clear();this.credentials.clear();this.proxy?.close();this.db.close(); }
}
