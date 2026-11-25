import type {SharedBrowserAction} from "./shared-browser-client";
import type {ProtectedLoginReply} from "./protected-login-contract";
import { ProtectedLoginError } from "./protected-login-errors";

type LoginRequest = (owner: string, chat: string, operation: string, input?: Record<string, unknown>, management?: boolean) => Promise<ProtectedLoginReply>;
type TrustedLoginTarget=string|{url:string;entryOrigin?:string};
type LoginTarget = (owner: string, chat: string, tabId?: string) => TrustedLoginTarget | Promise<TrustedLoginTarget>;

// Own the transition from the ordinary tab to the chat's private login browser.
// Preparing again never reseeds an active private session from a stale public URL.
export class ProtectedBrowserRouting {
  private chats = new Set<string>();
  constructor(private request: LoginRequest, private target: LoginTarget) {}
  has(owner: string, chat: string) { return this.chats.has(`${owner}:${chat}`); }
  async prepare(owner: string, chat: string, action: Partial<SharedBrowserAction>) {
    const key = `${owner}:${chat}`;
    const active = this.chats.has(key) || action.tabId === "protected";
    const target = active ? undefined : await this.target(owner, chat, action.tabId);
    const url=typeof target==="string"?target:target?.url;
    try {
      const result = await this.request(owner, chat, action.credentialId?"prepare_named":"prepare", {
        ...(url ? {url,...(typeof target==="object"&&target.entryOrigin?{entryOrigin:target.entryOrigin}:{})} : {}), selector:action.selector, usernameSelector:action.usernameSelector,
        emailSelector:action.emailSelector, fields:action.fields, replace:action.replace,
        ...(action.credentialId?{credentialId:action.credentialId}:{}),
      });
      this.chats.add(key);
      return result;
    } catch (error) {
      if (error instanceof ProtectedLoginError && error.code === "session_unavailable") this.chats.delete(key);
      // These failures occur after opening the private page. Inspection and
      // selector corrections must keep using that same private page.
      if (error instanceof ProtectedLoginError && ["invalid_fields","field_ambiguous","unsafe_target","field_not_visible","protected_form_changed","credential_target_changed","credential_binding_mismatch","credential_unavailable"].includes(error.code)) this.chats.add(key);
      throw error;
    }
  }
  async captureFrame(owner:string,chat:string,quality=70){
    const {screenshot,...state}=await this.action(owner,chat,{action:"screenshot",tabId:"protected",includeScreenshot:true,quality,source:"user"});
    if(typeof screenshot!=="string"||!screenshot)throw new ProtectedLoginError("screenshot_unavailable");
    return {...state,tabId:"protected",activeTabId:"protected",data:Buffer.from(screenshot,"base64")};
  }
  async action(owner: string, chat: string, action: Partial<SharedBrowserAction>) {
    const key = `${owner}:${chat}`;
    // An explicit protected tab also restores routing after an app restart.
    this.chats.add(key);
    const closing=action.action==="close"||action.action==="close_tab";
    try {
      const ownerView = !closing && action.source === "user";
      const result = await this.request(owner, chat, closing ? "close" : ownerView ? "owner_action" : "action", action, ownerView);
      if (closing) this.chats.delete(key);
      return result;
    } catch (error) {
      if (error instanceof ProtectedLoginError && error.code === "session_unavailable") this.chats.delete(key);
      throw error;
    }
  }
}
