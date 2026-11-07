import type {SharedBrowserAction} from "./shared-browser-client";
import type {ProtectedLoginReply} from "./protected-login-contract";
import { ProtectedLoginError } from "./protected-login-errors";

type LoginRequest = (owner: string, chat: string, operation: string, input?: Record<string, unknown>) => Promise<ProtectedLoginReply>;
type LoginTarget = (owner: string, chat: string, tabId?: string) => string | Promise<string>;

// Own the transition from the ordinary tab to the chat's private login browser.
// Preparing again never reseeds an active private session from a stale public URL.
export class ProtectedBrowserRouting {
  private chats = new Set<string>();
  constructor(private request: LoginRequest, private target: LoginTarget) {}
  has(owner: string, chat: string) { return this.chats.has(`${owner}:${chat}`); }
  async prepare(owner: string, chat: string, action: Partial<SharedBrowserAction>) {
    const key = `${owner}:${chat}`;
    const active = this.chats.has(key) || action.tabId === "protected";
    const url = active ? undefined : await this.target(owner, chat, action.tabId);
    try {
      const result = await this.request(owner, chat, "prepare", {
        ...(url ? {url} : {}), selector:action.selector, usernameSelector:action.usernameSelector,
        emailSelector:action.emailSelector, fields:action.fields, replace:action.replace,
      });
      this.chats.add(key);
      return result;
    } catch (error) {
      if (error instanceof ProtectedLoginError && error.code === "session_unavailable") this.chats.delete(key);
      // These failures occur after opening the private page. Inspection and
      // selector corrections must keep using that same private page.
      if (error instanceof ProtectedLoginError && ["invalid_fields","field_ambiguous","unsafe_target","field_not_visible"].includes(error.code)) this.chats.add(key);
      throw error;
    }
  }
  async action(owner: string, chat: string, action: Partial<SharedBrowserAction>) {
    const key = `${owner}:${chat}`;
    // An explicit protected tab also restores routing after an app restart.
    this.chats.add(key);
    try {
      const result = await this.request(owner, chat, action.action === "close" ? "close" : "action", action);
      if (action.action === "close") this.chats.delete(key);
      return result;
    } catch (error) {
      if (error instanceof ProtectedLoginError && error.code === "session_unavailable") this.chats.delete(key);
      throw error;
    }
  }
}
