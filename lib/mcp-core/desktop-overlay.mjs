import { OVERLAY_PRIMITIVE_GUIDANCE } from "./desktop-guidance.mjs";

/** Provider-neutral desktop overlay wire validation. No device, shell or monitor fallback. */
export const OVERLAY_MAX_BYTES = 1024 * 1024;
export const OVERLAY_MAX_ITEMS = 100;
export const OVERLAY_OPERATIONS = ["status", "add", "replace", "update", "remove", "clear", "undo", "interact"];
const types = ["rect", "ellipse", "line", "arrow", "path", "highlight", "text", "spotlight", "card"];
const fail = message => { throw new Error("desktop_overlay: " + message); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (v, k) => Object.hasOwn(v, k);
function keys(value, allowed) {
  if (!object(value)) fail("expected an object");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail("unknown field: " + key);
}
function string(value, label, nonempty = false) {
  if (typeof value !== "string" || value.length > 100000 || (nonempty && !value.trim())) fail("invalid " + label);
}
function id(value,label) { string(value,label,true);if(["__proto__","constructor","prototype"].includes(value)||!/^[-a-zA-Z0-9_:.]{1,100}$/.test(value))fail("invalid "+label); }
function paint(value,label) { string(value,label);if(!/^(#[a-fA-F0-9]{3,8}|transparent|currentColor)$/.test(value))fail("invalid "+label); }
function number(value, label, min = -Infinity, max = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail("invalid " + label);
}
/** Reject non-JSON/prototype-bearing objects before cloning, serializing or reading fields. */
export function assertOverlayJson(value) {
  let nodes = 0;
  let bytes = 0;
  const seen = new Set();
  function visit(v, depth) {
    if (++nodes > 150000 || depth > 32) fail("JSON nesting/size limit exceeded");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") {
      string(v, "string");
      bytes += Buffer.byteLength(v, "utf8");
      if (bytes > OVERLAY_MAX_BYTES) fail("JSON exceeds 1 MiB");
      return;
    }
    if (typeof v === "number") return number(v, "number");
    if (typeof v !== "object") fail("only JSON values are allowed");
    if (seen.has(v)) fail("cyclic input");
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null && !(Array.isArray(v) && proto === Array.prototype)) fail("invalid object prototype");
    if (Array.isArray(v) && (v.length > 150000 || Object.keys(v).length !== v.length)) fail("sparse/oversized arrays are not allowed");
    seen.add(v);
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === "length") continue;
      if (Array.isArray(v) && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length)) fail("invalid array key");
      if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) fail("unsafe object key");
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !("value" in d) || !d.enumerable) fail("accessors/non-enumerable fields are not allowed");
      visit(d.value, depth + 1);
    }
    seen.delete(v);
  }
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > OVERLAY_MAX_BYTES) fail("JSON exceeds 1 MiB");
}
function item(v) {
  keys(v, ["id","type","group","x","y","width","height","color","fill","opacity","strokeWidth","radius","text","fontSize","points","doubleArrow","holes","content","ttlMs"]);
  id(v.id, "item id");
  if (!types.includes(v.type)) fail("invalid item type");
  for (const k of ["x", "y", "width", "height"]) number(v[k], k, k === "width" || k === "height" ? 1 : 0);
  if(own(v,"group"))id(v.group,"group");
  if(own(v,"text"))string(v.text,"text");
  for(const k of ["color","fill"])if(own(v,k))paint(v[k],k);
  if(own(v,"strokeWidth"))number(v.strokeWidth,"strokeWidth",1,24);
  if(own(v,"radius"))number(v.radius,"radius",0,200);
  if(own(v,"fontSize"))number(v.fontSize,"fontSize",10,160);
  if (own(v,"opacity")) number(v.opacity, "opacity", 0, 1);
  if (own(v,"ttlMs")) { number(v.ttlMs, "ttlMs", 0, 3600000); if (!Number.isInteger(v.ttlMs)) fail("ttlMs must be an integer"); }
  if (own(v,"doubleArrow") && typeof v.doubleArrow !== "boolean") fail("invalid doubleArrow");
  if (own(v,"points")) {
    if (!Array.isArray(v.points) || v.points.length < 2 || v.points.length > 1024) fail("points requires 2..1024 points");
    for (const p of v.points) { keys(p, ["x","y"]); number(p.x,"point x",0); number(p.y,"point y",0); }
  }
  if (v.type === "path" && !v.points) fail("path requires points");
  if (own(v,"holes")) {
    if (v.type !== "spotlight" || !Array.isArray(v.holes) || v.holes.length > 16) fail("spotlight holes limit is 16");
    for (const h of v.holes) {
      keys(h, ["x","y","width","height","shape","radius"]);
      for (const k of ["x","y","width","height"]) number(h[k], k, k === "width" || k === "height" ? 1 : 0);
      if (!["rect","ellipse"].includes(h.shape)) fail("invalid hole shape");
      if (own(h,"radius")) number(h.radius,"hole radius",0,200);
    }
  }
  if(v.type==="text"&&!own(v,"text"))fail("text requires text");
  if(v.type==="card"&&!own(v,"content"))fail("card requires content");
  if(v.type==="spotlight"&&!own(v,"holes"))fail("spotlight requires holes (an empty array dims the full box)");
  if (own(v,"content")) {
    if (v.type !== "card") fail("content requires card type");
    const c = v.content;
    keys(c, ["kind","source","spec","file","imageFit","imagePosition"]);
    if(own(c,"imageFit")&&(c.kind!=="file"||!["contain","cover"].includes(c.imageFit)))fail("imageFit requires a file card and contain/cover");
    if(own(c,"imagePosition")){if(c.kind!=="file")fail("imagePosition requires file");keys(c.imagePosition,["x","y"]);number(c.imagePosition.x,"image x",0,100);number(c.imagePosition.y,"image y",0,100);}
    if (!["markdown","html","graph","chart","file"].includes(c.kind)) fail("invalid content kind");
    if (c.kind === "file") {
      if (own(c,"source") || own(c,"spec")) fail("file accepts only file.id");
      keys(c.file, ["id"]);
      string(c.file.id,"upload id",true);
      if (!/^[a-f0-9-]{36}$/.test(c.file.id)) fail("invalid upload id; URLs and paths are forbidden");
    } else if (c.kind === "html" || c.kind === "markdown") {
      if (own(c,"file") || own(c,"spec")) fail("text content accepts only source");
      string(c.source, "content source");
    } else {
      if (own(c,"file") || own(c,"source") === own(c,"spec")) fail("graph/chart requires exactly one of source or spec");
      if (own(c,"source")) string(c.source,"content source",true);
    }
  }
  return v;
}
export function normalizeDesktopOverlay(input, { tool = false } = {}) {
  assertOverlayJson(input);
  keys(input, ["operation","display_id","items","ids","group","all","interactive_id", ...(tool ? ["client_id"] : [])]);
  if (tool) string(input.client_id,"client_id",true);
  if (!OVERLAY_OPERATIONS.includes(input.operation)) fail("invalid operation");
  const op = input.operation;
  const allowed = ["operation", ...(tool ? ["client_id"] : []), "display_id",
    ...(["add","replace","update"].includes(op) ? ["items"] : []),
    ...(op === "remove" ? ["ids","group"] : []),
    ...(op === "clear" ? ["all"] : []),
    ...(op === "interact" ? ["interactive_id"] : [])];
  keys(input,allowed);
  if (own(input,"display_id")) string(input.display_id,"display_id",true);
  if (own(input,"all") && typeof input.all !== "boolean") fail("invalid all");
  if (op === "clear" && input.all === true && own(input,"display_id")) fail("clear targets either display_id or all, not both");
  if (op !== "status" && !(op === "clear" && input.all === true) && !own(input,"display_id")) fail("explicit display_id required; call status first");
  if (["add","replace","update"].includes(op)) {
    if (!Array.isArray(input.items) || input.items.length > OVERLAY_MAX_ITEMS || (op !== "replace" && !input.items.length)) fail("items limit is 100");
    input.items.forEach(item);
    if (new Set(input.items.map(i => i.id)).size !== input.items.length) fail("duplicate item IDs");
  }
  if (op === "remove") {
    if (own(input,"ids") === own(input,"group")) fail("remove requires ids or group, not both");
    if (own(input,"group")) id(input.group,"group");
    else {
      if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 100) fail("invalid ids");
      input.ids.forEach(value => id(value,"id"));
      if (new Set(input.ids).size !== input.ids.length) fail("duplicate IDs");
    }
  }
  if (op === "interact") {
    if (!own(input,"interactive_id")) fail("interactive_id required (null disables interaction)");
    if (input.interactive_id !== null) id(input.interactive_id,"interactive_id");
  }
  const result = JSON.parse(JSON.stringify(input));
  if (tool) delete result.client_id;
  return result;
}
/** Content is deliberately excluded from audit logs (including native status responses). */
export function summarizeDesktopOverlay(value) {
  if (!object(value)) return {};
  return {
    ...(typeof value.operation === "string" ? { operation: value.operation } : {}),
    ...(typeof value.display_id === "string" ? { display_id: value.display_id } : {}),
    ...(typeof value.revision === "number" ? { revision: value.revision } : {}),
    ...(typeof value.all === "boolean" ? { all: value.all } : {}),
    ...(Array.isArray(value.items) ? { itemCount: value.items.length, ids: value.items.slice(0,100).map(i => typeof i?.id === "string" ? i.id : "") } : {}),
    ...(Array.isArray(value.ids) ? { ids: value.ids.slice(0,100) } : {}),
    ...(own(value,"interactive_id") ? { interactive_id: value.interactive_id } : {}),
  };
}
const str = { type: "string", maxLength: 100000 };
const num = { type: "number" };
const ident = {type:"string",minLength:1,maxLength:100,pattern:"^(?!__proto__$|constructor$|prototype$)[-a-zA-Z0-9_:.]+$"};
const color = {type:"string",pattern:"^(#[a-fA-F0-9]{3,8}|transparent|currentColor)$"};
const point = { type:"object", properties:{x:{...num,minimum:0},y:{...num,minimum:0}}, required:["x","y"], additionalProperties:false };
export const DESKTOP_OVERLAY_INPUT_SCHEMA = {
  type:"object",
  properties:{
    client_id:{...str,minLength:1,description:"Exact current server-resolved Assistant origin or account-scoped discovery ID; this does not grant permissions."}, operation:{type:"string",enum:OVERLAY_OPERATIONS,description:"status reads authoritative display geometry/state. Prefer add/update and your own IDs/group; replace clears the entire selected display scene."},
    display_id:{...str,minLength:1,description:"Real display ID from status. Coordinates are relative to this monitor in DIP, not screenshot/global pixels."}, all:{type:"boolean"}, group:ident,
    interactive_id:{...ident,type:["string","null"]},
    ids:{type:"array",items:ident,minItems:1,maxItems:100},
    items:{type:"array",maxItems:100,items:{
      type:"object",properties:{
        id:ident,type:{type:"string",enum:types,description:Object.entries(OVERLAY_PRIMITIVE_GUIDANCE).map(([type,use])=>type+": "+use).join(" ")},group:ident,x:{...num,minimum:0},y:{...num,minimum:0},width:{...num,minimum:1},height:{...num,minimum:1},
        color,fill:color,opacity:{...num,minimum:0,maximum:1},strokeWidth:{...num,minimum:1,maximum:24},radius:{...num,minimum:0,maximum:200},text:str,fontSize:{...num,minimum:10,maximum:160},
        points:{type:"array",items:point,minItems:2,maxItems:1024},doubleArrow:{type:"boolean"},
        holes:{type:"array",maxItems:16,description:"Spotlight cutouts in monitor-relative DIP. Keep the chosen target visible. Empty holes dims the entire box and is not appropriate for pointing out a visible target.",items:{type:"object",properties:{x:{...num,minimum:0},y:{...num,minimum:0},width:{...num,minimum:1},height:{...num,minimum:1},shape:{type:"string",enum:["rect","ellipse"]},radius:{...num,minimum:0,maximum:200}},required:["x","y","width","height","shape"],additionalProperties:false}},
        content:{type:"object",properties:{kind:{type:"string",enum:["markdown","html","graph","chart","file"]},source:str,spec:{},imageFit:{type:"string",enum:["contain","cover"]},imagePosition:{type:"object",properties:{x:{type:"number",minimum:0,maximum:100},y:{type:"number",minimum:0,maximum:100}},required:["x","y"],additionalProperties:false},file:{type:"object",properties:{id:{type:"string",pattern:"^[a-f0-9-]{36}$"}},required:["id"],additionalProperties:false}},required:["kind"],additionalProperties:false},
        ttlMs:{type:"integer",minimum:0,maximum:3600000,description:"Prefer a positive finite lifetime for transient explanations. Zero is persistent and should be used only when the task calls for it."}
      },required:["id","type","x","y","width","height"],additionalProperties:false
    }}
  },required:["client_id","operation"],additionalProperties:false
};
