import { dictationAllowed, insertFieldTranscript } from "./field-dictation";

export type EmbedDictationField = { field: string; left: number; top: number; width: number; height: number };
export function embedDictationFields(value: unknown, width: number, height: number): EmbedDictationField[] {
  if (!Array.isArray(value) || value.length > 30) return [];
  const seen = new Set<string>();
  return value.filter((field): field is EmbedDictationField => {
    if (!field || typeof field !== "object" || typeof field.field !== "string" || !/^field-\d{1,6}$/.test(field.field) || seen.has(field.field)) return false;
    if (![field.left, field.top, field.width, field.height].every(n => typeof n === "number" && Number.isFinite(n))) return false;
    if (field.left < 0 || field.top < 0 || field.width < 44 || field.height < 32 || field.left + field.width > width + 1 || field.top + 32 > height) return false;
    seen.add(field.field); return true;
  }).map(({field,left,top,width,height}) => ({field,left,top,width,height}));
}

/** Serialized into an opaque offline frame. No microphone, API or parent DOM access. */
function installEmbedDictation(id: string, allowed: typeof dictationAllowed, insert: typeof insertFieldTranscript) {
  type Field = HTMLInputElement | HTMLTextAreaElement;
  const fields = new Map<string, Field>();
  const identities = new WeakMap<Field, string>();
  const revisions = new WeakMap<Field, number>();
  const captures = new Map<string, { field: Field; value: string; revision: number; original: string; start: number; end: number }>();
  let count = 0, scheduled = false, last = "";
  const state = {
    eligible(element: Element): element is Field {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || element.disabled || element.readOnly || element.closest("[hidden],[inert],[data-metis-sensitive]")) return false;
      const label = [...(element.labels || [])].map(label => label.textContent || "").join(" ") + " " + (element.getAttribute("aria-labelledby") || "").split(/\s+/).map(key => document.getElementById(key)?.textContent || "").join(" ");
      return allowed(element instanceof HTMLTextAreaElement ? "textarea" : element.type, [element.id, element.name, element.getAttribute("aria-label"), element.placeholder, label].join(" "), element.autocomplete);
    },
    scan() {
      scheduled = false;
      const visible = [];
      for (const element of [...document.querySelectorAll("input,textarea")].slice(0, 200)) {
        if (!state.eligible(element)) { element.removeAttribute("data-metis-dictation-field"); continue; }
        let field = identities.get(element);
        if (!field) { field = "field-" + (++count); identities.set(element, field); fields.set(field, element); }
        if (!element.hasAttribute("data-metis-dictation-field")) element.setAttribute("data-metis-dictation-field", "");
        const rect = element.getBoundingClientRect();
        const left=Math.max(0,rect.left),top=Math.max(0,rect.top),right=Math.min(innerWidth,rect.right),bottom=Math.min(innerHeight,rect.bottom);
        if (right-left >= 44 && bottom-top >= 32 && visible.length < 30) visible.push({field,left,top,width:right-left,height:bottom-top});
      }
      for (const [field, element] of fields) if (!element.isConnected) { fields.delete(field); captures.delete(field); }
      const signature = JSON.stringify(visible);
      if (signature !== last) { last = signature; parent.postMessage({type:"metis-html-dictation-fields",id,fields:visible},"*"); }
    },
    // Offscreen iframes can suspend animation frames; the initial handshake must still complete.
    schedule() { if (!scheduled) { scheduled = true; setTimeout(() => state.scan(), 0); } },
    receive(event: MessageEvent) {
      const message = event.data;
      if (event.source !== parent || !message || message.id !== id || message.type !== "metis-html-dictation") return;
      if (message.action === "refresh") { last = ""; state.schedule(); return; }
      if (typeof message.field !== "string") return;
      const field = fields.get(message.field);
      if (!field || !field.isConnected || !state.eligible(field)) return;
      if (message.action === "begin") {
        captures.clear();
        captures.set(message.field, {field,value:field.value,original:field.value,revision:revisions.get(field)||0,start:field.selectionStart??field.value.length,end:field.selectionEnd??field.value.length});
        return;
      }
      const capture = captures.get(message.field);
      if (message.action !== "commit" || !capture || typeof message.text !== "string" || !message.text.trim() || message.text.length > 100_000) return;
      if (capture.value !== field.value || capture.revision !== (revisions.get(field)||0)) { captures.delete(message.field); return; }
      const next = insert(capture.original,message.text,capture.start,capture.end,field.maxLength>=0?Math.min(100_000,field.maxLength):100_000);
      const revision = revisions.get(field)||0;
      field.value = next;
      field.dispatchEvent(new Event("input",{bubbles:true}));
      field.dispatchEvent(new Event("change",{bubbles:true}));
      if (field.value !== next || (revisions.get(field)||0) !== revision+1) { captures.delete(message.field); return; }
      capture.value = next; capture.revision = revision+1;
    }
  };
  addEventListener("input", event => { const field=event.target; if(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement)revisions.set(field,(revisions.get(field)||0)+1); },true);
  addEventListener("message", event => state.receive(event));
  addEventListener("scroll", () => state.schedule(),true);
  addEventListener("resize", () => state.schedule());
  addEventListener("DOMContentLoaded", () => {
    const style=document.createElement("style");
    style.textContent="[data-metis-dictation-field]{padding-right:48px!important;min-height:44px!important}";
    document.head.append(style);
    new MutationObserver(() => state.schedule()).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["type","disabled","readonly","hidden","inert","class","style","autocomplete","aria-label","name","id","placeholder","data-metis-sensitive"]});
    new ResizeObserver(() => state.schedule()).observe(document.body);
    state.schedule();
  });
}

export function htmlEmbedDictationScript(id: string) {
  return "<script>(" + installEmbedDictation.toString() + ")(" + JSON.stringify(id).replace(/</g,"\\u003c") + "," + dictationAllowed.toString() + "," + insertFieldTranscript.toString() + ");</script>";
}
