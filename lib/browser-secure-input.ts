import { randomUUID } from "node:crypto";
import type { BrowserContext, ElementHandle, Page } from "playwright";
import { ProtectedLoginError } from "./protected-login-errors";

export type CredentialField="password"|"username"|"email";
export type SecureBrowserInput = { requestId: string; origin: string; expiresAt: string; fields?:CredentialField[] };
export class CredentialFieldsNotVisible extends ProtectedLoginError {
  constructor(readonly missingFields: CredentialField[]) { super("field_not_visible"); }
}
type Pending = SecureBrowserInput & {
  owner: string; chat: string; page: Page; url: string;
  field: ElementHandle<HTMLInputElement>; filled: boolean;
  targets:Array<{kind:CredentialField;field:ElementHandle<HTMLInputElement>}>;
};

// Only the browser-engine process holds handles and transient secrets. No DB,
// chat, question answer, tool arguments, profile or environment stores passwords.
const retained = new WeakMap<BrowserContext, Set<string>>();
const passwordContexts = new WeakSet<BrowserContext>();
const enteredPasswords = new WeakMap<BrowserContext, Set<string>>();
export function browserPasswordSecrets(page: Page) { return [...(enteredPasswords.get(page.context()) ?? [])]; }
export function browserInputSecrets(page: Page) { return [...(retained.get(page.context()) ?? [])]; }
export function browserHasSecureInput(page: Page) { return passwordContexts.has(page.context()); }
export function retainBrowserSecrets(page: Page, values: string[]) {
  const context=page.context(), secrets=retained.get(context) ?? new Set<string>();
  for(const value of values)if(value && value.length<=8192 && secrets.size<512)secrets.add(value);
  retained.set(context,secrets);
}

export class SecureBrowserInputs {
  private requests = new Map<string, Pending>();
  constructor(private ttl = 5 * 60_000) {}

  async prepare(owner: string, chat: string, page: Page, selector?: string, options:{fields?:CredentialField[];usernameSelector?:string;emailSelector?:string}={}): Promise<SecureBrowserInput> {
    for (const [id, item] of this.requests) if (Date.parse(item.expiresAt) <= Date.now() || item.page.isClosed()) {
      for(const target of item.targets)void target.field.dispose().catch(() => {}); this.requests.delete(id);
    }
    if (this.requests.size >= 100) throw new ProtectedLoginError("session_limit");
    const origin = new URL(page.url()).origin;
    if (!origin.startsWith("https://")) throw new ProtectedLoginError("https_required");
    const requested = options.fields ?? ["password"];
    if (!Array.isArray(requested) || !requested.length || requested.some(kind => !["password","username","email"].includes(kind))) {
      throw new ProtectedLoginError("invalid_fields");
    }
    const username = 'input:not([type="email"])[autocomplete="username"],input:not([type="email"])[name^="username" i],input:not([type="email"])[id^="username" i],input:not([type="email"])[name="login" i],input:not([type="email"])[name="user" i],input:not([type="email"])[id="loginname" i]';
    const selectors = {password:selector || 'input[type="password"]', username:options.usernameSelector || username, email:options.emailSelector || 'input[type="email"],input[name="email" i]'};
    const kinds = [...new Set([...requested, ...(requested.includes("password") ? ["username","email"] as const : [])])];
    // One bounded wait for the whole form. A chooser can contain matching hidden
    // inputs indefinitely; it must become an actionable pre-login state.
    const deadline = Date.now() + 8000;
    while (true) {
      const targets: Pending["targets"] = [];
      let kept = false;
      try {
        if (page.isClosed() || new URL(page.url()).origin !== origin) throw new ProtectedLoginError("page_unavailable");
        const missing: CredentialField[] = [];
        for (const kind of kinds) {
          const fields: ElementHandle<HTMLInputElement>[] = [];
          try {
            for (const frame of page.frames()) {
              if (!frame.url().startsWith("https://") || new URL(frame.url()).origin !== origin) continue;
              let candidates = frame.locator(selectors[kind]);
              if (kind === "email" && requested.includes("email") && !options.emailSelector && !await candidates.count()) candidates = frame.locator(username);
              if (await candidates.count() > 30) throw new ProtectedLoginError("field_ambiguous");
              for (const candidate of await candidates.all()) {
                if (!await candidate.isVisible()) continue;
                const handle = await candidate.elementHandle();
                if (handle && await handle.evaluate((el,k) => el instanceof HTMLInputElement && (k === "password" ? el.type === "password" : ["text","email","tel"].includes(el.type)), kind)) {
                  fields.push(handle as ElementHandle<HTMLInputElement>);
                } else await handle?.dispose();
              }
            }
            if (fields.length > 1 && requested.includes(kind)) throw new ProtectedLoginError("field_ambiguous");
            if (fields.length !== 1) {
              if (requested.includes(kind)) missing.push(kind);
              continue;
            }
            const field = fields[0];
            if (!await this.safeTarget(field, origin, kind)) {
              if (requested.includes(kind)) throw new ProtectedLoginError("unsafe_target");
              continue;
            }
            targets.push({kind,field});
            fields.splice(0); // Ownership transfers to targets.
          } finally {
            await Promise.all(fields.map(field => field.dispose().catch(() => {})));
          }
        }
        if (missing.length) {
          if (Date.now() >= deadline) throw new CredentialFieldsNotVisible(missing);
        } else {
          const input = {requestId:randomUUID(), origin, expiresAt:new Date(Date.now() + this.ttl).toISOString(), fields:[...new Set(requested)]};
          this.requests.set(input.requestId, {...input, owner, chat, page, url:page.url(), field:targets[0].field, targets, filled:false});
          kept = true;
          return input;
        }
      } catch (error) {
        if (error instanceof ProtectedLoginError) throw error;
        throw new ProtectedLoginError("invalid_fields");
      } finally {
        if (!kept) await Promise.all(targets.map(target => target.field.dispose().catch(() => {})));
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async safeTarget(field: ElementHandle<HTMLInputElement>, origin: string,kind:CredentialField) {
    if (!await field.isVisible().catch(() => false)) return false;
    return field.evaluate((el, expected) => {
      if (!el.isConnected || !(el instanceof HTMLInputElement) || el.disabled || el.readOnly || (expected.kind==="password"?el.type!=="password":!["text","email","tel"].includes(el.type)) || location.origin !== expected.origin) return false;
      if (!el.form) return true; // JavaScript forms remain owned by the displayed HTTPS site.
      const target = new URL(el.form.action || location.href);
      return target.origin === expected.origin && target.protocol === "https:" && el.form.method.toLowerCase() === "post";
    }, {origin,kind}).catch(() => false);
  }

  private get(owner: string, chat: string, requestId: string) {
    const input = this.requests.get(requestId);
    if (!input || input.owner !== owner || input.chat !== chat || Date.parse(input.expiresAt) <= Date.now()) {
      throw new Error("Login request expired or unavailable");
    }
    return input;
  }

  status(owner: string, chat: string, requestId: string) { return this.get(owner, chat, requestId).filled; }

  async fill(owner: string, chat: string, requestId: string, password: string) {
    return this.fillValues(owner,chat,requestId,{password});
  }

  async fillValues(owner:string,chat:string,requestId:string,values:Partial<Record<CredentialField,string>>) {
    const input = this.get(owner, chat, requestId);
    if (input.filled) throw new Error("Login request already used");
    if((input.fields??["password"]).some(kind=>typeof values[kind]!=="string"||!values[kind]||values[kind]!.length>4096))throw Error("Missing credential field");
    if(Object.values(values).some(value=>typeof value!=="string"||value.length>4096))throw Error("Invalid credential");
    if (input.page.isClosed() || input.page.url() !== input.url || !(await Promise.all(input.targets.map(target=>this.safeTarget(target.field,input.origin,target.kind)))).every(Boolean)) {
      throw new Error("Website changed; request a new login dialog");
    }
    const context = input.page.context();
    if(values.password){const passwords=enteredPasswords.get(context)??new Set<string>();passwords.add(values.password);enteredPasswords.set(context,passwords);}
    const secrets = retained.get(context) ?? new Set<string>();
    if (secrets.size >= 512) throw new Error("Close browser before entering more passwords");
    for(const [kind,value] of Object.entries(values))if(value){secrets.add(value);if(kind!=="password"){secrets.add(value.toLowerCase());secrets.add(value.normalize("NFKC"));}} retained.set(context, secrets);
    passwordContexts.add(context);
    // Consume before awaiting browser I/O: concurrent/replayed submissions cannot fill twice.
    input.filled = true;
    try {for(const target of input.targets){const value=values[target.kind]??(target.kind==="username"?values.email:undefined);if(value!==undefined){if(!await this.safeTarget(target.field,input.origin,target.kind))throw Error();await target.field.fill(value,{timeout:5000});}}}
    catch { input.filled = false; throw new Error("Password could not be entered; request a new login dialog"); }
    return { status: "filled" as const };
  }
}

export const secureBrowserInputs = new SecureBrowserInputs();
