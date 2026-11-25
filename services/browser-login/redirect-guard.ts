import type { BrowserContext, Page, CDPSession } from "playwright";
import { browserHasSecureInput } from "../../lib/browser-secure-input";
import { protectedRequestAllowed } from "./navigation-policy";

type Policy = { credentialOrigin: string; origins: ReadonlySet<string> };
type Events = {
  "Target.receivedMessageFromTarget": {sessionId:string;message:string};
  "Target.detachedFromTarget": {sessionId:string};
  "Target.attachedToTarget": {sessionId:string;targetInfo:{type:string;targetId:string}};
  "Network.loadingFailed": { requestId: string; canceled?: boolean; errorText: string };
  "Fetch.requestPaused": {
    requestId:string;networkId?:string;resourceType?:string;responseErrorReason?:string;responseStatusCode?:number;responseHeaders?:Array<{name:string;value:string}>;
    request:{url:string;method:string;postData?:string;hasPostData?:boolean;
      headers?:Record<string,string>;postDataEntries?:Array<{bytes?:string}>};
  };
};
// Use only fixed protocol facts, never a site's text or a raw CDP error in output.
class InterceptionGone extends Error {}
function interceptionGone(message: unknown) {
  return typeof message === "string" &&
    /^(?:(?:cdpSession\.send: )?Protocol error \(Fetch\.continueRequest\): )?Invalid InterceptionId\.?$/.test(message);
}

type Listener = (params: unknown) => void;
type Protocol = {
  send(method:Parameters<CDPSession["send"]>[0],params?:Parameters<CDPSession["send"]>[1]):Promise<void>;
  on<K extends keyof Events>(event:K,listener:(params:Events[K])=>void):void;
};

// A child target's non-flattened transport lets us install interception before
// Chromium resumes an out-of-process iframe or worker. Every child recursively
// installs the same guard; page-only interception would leave those targets out.
function childProtocol(parent: Protocol, sessionId: string): Protocol & { receive(message: string): void; close(): void } {
  let sequence = 0;
  const pending = new Map<number, { method: string; resolve(): void; reject(error: Error): void }>();
  const listeners = new Map<string, Listener[]>();
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { method, resolve, reject });
        void parent.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) })
          .catch(() => { pending.delete(id); reject(Error("Protected redirect interception unavailable")); });
      });
    },
    on(event, listener) { listeners.set(event, [...(listeners.get(event) || []), value => listener(value as Events[typeof event])]); },
    receive(message) {
      const event = JSON.parse(message);
      if (event.id) {
        const request = pending.get(event.id);
        pending.delete(event.id);
        if (event.error) request?.reject(request.method === "Fetch.continueRequest" && interceptionGone(event.error.message)
          ? new InterceptionGone() : Error("Protected redirect interception unavailable"));
        else request?.resolve();
      } else for (const listener of listeners.get(event.method) || []) listener(event.params);
    },
    close() {
      for (const request of pending.values()) request.reject(Error("Protected redirect interception unavailable"));
      pending.clear();
    },
  };
}

export async function installProtectedRedirectGuard(context: BrowserContext, page: Page, policy: () => Policy) {
  const browser = context.browser();
  if (!browser) throw Error("Protected redirect interception unavailable");
  const session = await context.newCDPSession(page);
  const root: Protocol = {
    send: async (method, params) => {
      try { await session.send(method, params); }
      catch (error) {
        if (method === "Fetch.continueRequest" && error instanceof Error && interceptionGone(error.message)) throw new InterceptionGone();
        throw error;
      }
    },
    on: (event, listener) => { session.on(event, value => listener(value as Events[typeof event])); },
  };
  let closed = false;
  context.on("close", () => { closed = true; });
  let closing = false;
  const failClosed = () => {
    if (closed || closing) return;
    closing = true;
    void context.close().catch(() => {});
  };

  async function install(protocol: Protocol) {
    const children = new Map<string, ReturnType<typeof childProtocol>>();
    // Network IDs are scoped to this target. Preserve only recent terminal
    // cancellations; never resume a request to recover from an interception error.
    const canceled = new Map<string, number>();
    protocol.on("Network.loadingFailed", event => {
      if (event.canceled !== true || event.errorText !== "net::ERR_ABORTED") return;
      if (canceled.size >= 128) canceled.delete(canceled.keys().next().value!);
      canceled.set(event.requestId, performance.now());
    });
    // Some targets do not expose Network. They keep the original fail-closed
    // behavior; successful Fetch registration is still mandatory.
    const observesCancellation = await protocol.send("Network.enable").then(() => true, () => false);
    protocol.on("Target.receivedMessageFromTarget", event => {
      try { children.get(event.sessionId)?.receive(event.message); } catch { failClosed(); }
    });
    protocol.on("Target.detachedFromTarget", event => {
      children.get(event.sessionId)?.close(); children.delete(event.sessionId);
    });
    protocol.on("Target.attachedToTarget", event => {
      const child = childProtocol(protocol, event.sessionId);
      children.set(event.sessionId, child);
      void (async () => {
        if (!["page", "iframe"].includes(event.targetInfo.type)) {
          // Chromium workers do not implement Fetch interception. Never resume
          // an unguarded target, even before fill: it could outlive that fill.
          // closeTarget may resume a paused worker during teardown. Close the
          // entire credential context while it is still paused instead.
          failClosed();
          return;
        }
        await install(child);
        await child.send("Runtime.runIfWaitingForDebugger");
      })().catch(failClosed);
    });
    protocol.on("Fetch.requestPaused", event => {
      void (async () => {
        let allowed = true;
        const status = event.responseStatusCode;
        if (status !== undefined && [301, 302, 303, 307, 308].includes(status)) {
          const locations = (event.responseHeaders || []).filter((header: { name: string }) => header.name.toLowerCase() === "location");
          if (locations.length) {
            if (locations.length !== 1) allowed = false;
            else {
              try {
                const destination = new URL(locations[0].value, event.request.url);
                allowed = destination.protocol === "https:" && !destination.username && !destination.password && !destination.port;
                if (allowed && browserHasSecureInput(page)) {
                  const { credentialOrigin, origins } = policy();
                  // Chromium converts POST to GET for 301/302, and non-GET/HEAD
                  // methods to GET for 303. Other redirects preserve the body.
                  const method = event.request.method;
                  const dropsBody = ((status === 301 || status === 302) && method === "POST") ||
                    (status === 303 && method !== "GET" && method !== "HEAD");
                  const body = dropsBody ? null : event.request.postData ?? null;
                  const contentType = Object.entries(event.request.headers || {}).find(([name]) => name.toLowerCase() === "content-type")?.[1];
                  // CDP may expose multipart text while omitting file bytes.
                  // Such a representation cannot prove password absence.
                  const opaqueBody = !dropsBody && (event.request.hasPostData && body === null ||
                    /^multipart\/form-data(?:;|$)/i.test(String(contentType || "")) ||
                    event.request.postDataEntries?.some((entry: {bytes?: string}) => entry.bytes === undefined));
                  allowed = !(opaqueBody && destination.origin !== credentialOrigin) &&
                    protectedRequestAllowed(page, { url: () => destination.href, postData: () => body }, credentialOrigin, origins);
                }
              } catch { allowed = false; }
            }
          }
        }
        try {
          await protocol.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed ?
            { requestId: event.requestId } : { requestId: event.requestId, errorReason: "BlockedByClient" });
        } catch (error) {
          if (!allowed || !observesCancellation || !(error instanceof InterceptionGone) ||
              !event.networkId || event.responseErrorReason || status === undefined || status < 200 || status >= 300 ||
              (event.resourceType !== "Fetch" && event.resourceType !== "XHR") ||
              !["GET", "HEAD"].includes(event.request.method) || event.request.hasPostData ||
              event.request.postData !== undefined || event.request.postDataEntries?.length ||
              !event.responseHeaders || event.responseHeaders.some(header => /^(location|refresh)$/i.test(header.name)) ||
              new URL(event.request.url).origin !== policy().credentialOrigin) throw error;
          // DevTools may deliver the terminal cancellation just after rejecting
          // the continuation. Bound the wait and still require the exact ID.
          await new Promise(resolve => setTimeout(resolve, 30));
          const timestamp = canceled.get(event.networkId);
          if (timestamp === undefined || performance.now() - timestamp > 1000) throw error;
          canceled.delete(event.networkId);
        }
      })().catch(failClosed);
    });
    await protocol.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Response" }] });
    await protocol.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: false });
  }

  try { await install(root); }
  catch { await context.close().catch(() => {}); throw Error("Protected redirect interception unavailable"); }
}
