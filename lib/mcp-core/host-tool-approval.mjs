import { createHash } from "node:crypto";

// A grant belongs to the existing owner/chat/job lease, one exact payload and one policy revision.
export function hostApprovalScope(revision, name, args) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
    }
    return value;
  };
  return "host-tool-policy:" + revision + ":" + createHash("sha256")
    .update(JSON.stringify([name, canonical(args)])).digest("hex");
}
export function isHostApprovalScope(value) {
  return typeof value === "string" && /^host-tool-policy:\d+:[0-9a-f]{64}$/.test(value);
}
