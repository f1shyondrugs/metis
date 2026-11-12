import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";

// Created once by the custom server, before Next loads route modules. Signed
// metadata also survives Next's route bundling without trusting client headers.
const PEER_HEADER = "x-metis-network";
export function initializeRequestNetwork() {
  process.env.METIS_PRIVATE_NETWORK_KEY = randomBytes(32).toString("hex");
}

function normalizeAddress(value: string) {
  const address = value.trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
  return isIP(address) ? address : "";
}

export function isTrustedProxy(address: string, configured = process.env.AI_CHAT_TRUSTED_PROXIES || "") {
  const normalized = normalizeAddress(address);
  const family = isIP(normalized) === 4 ? "ipv4" : "ipv6";
  if (!normalized) return false;
  const ranges = new BlockList();
  for (const entry of configured.split(",").map((part) => part.trim()).filter(Boolean)) {
    const [raw, prefix, ...rest] = entry.split("/");
    const ip = normalizeAddress(raw);
    if (!ip || rest.length) throw new Error("Invalid AI_CHAT_TRUSTED_PROXIES entry.");
    const type = isIP(ip) === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) ranges.addAddress(ip, type);
    else {
      const bits = Number(prefix);
      if (!/^\d+$/.test(prefix) || bits < 0 || bits > (type === "ipv4" ? 32 : 128)) {
        throw new Error("Invalid AI_CHAT_TRUSTED_PROXIES prefix.");
      }
      ranges.addSubnet(ip, bits, type);
    }
  }
  return ranges.check(normalized, family);
}

function header(request: IncomingMessage, name: string) {
  const value = request.headers[name];
  return typeof value === "string" ? value : "";
}

export function socketClientAddress(request: IncomingMessage) {
  let address = normalizeAddress(request.socket.remoteAddress || "");
  if (!address || !isTrustedProxy(address)) return address || "unknown";
  const forwarded = header(request, "x-forwarded-for");
  if (forwarded.length > 4096) return address;
  const hops = forwarded.split(",").map(normalizeAddress);
  if (!forwarded || hops.some((hop) => !hop) || hops.length > 32) return address;
  // Walk from the actual peer toward the client; stop at the first untrusted
  // hop. Any attacker-controlled prefix further left is never selected.
  for (let index = hops.length - 1; index >= 0 && isTrustedProxy(address); index--) {
    address = hops[index];
  }
  return address;
}

export function socketRequestProtocol(request: IncomingMessage) {
  if ((request.socket as IncomingMessage["socket"] & { encrypted?: boolean }).encrypted) return "https";
  if (isTrustedProxy(request.socket.remoteAddress || "")) {
    const protocol = header(request, "x-forwarded-proto").split(",").at(-1)?.trim().toLowerCase();
    if (protocol === "https" || protocol === "http") return protocol;
  }
  return "http";
}

export function stampRequestNetwork(request: IncomingMessage) {
  const key = process.env.METIS_PRIVATE_NETWORK_KEY;
  if (!key) throw new Error("Request network key not initialized.");
  const address = socketClientAddress(request);
  const protocol = socketRequestProtocol(request);
  const payload = Buffer.from(JSON.stringify({ address, protocol })).toString("base64url");
  request.headers[PEER_HEADER] = payload + "." + createHmac("sha256", key).update(payload).digest("hex");
  // Next may consume these for URLs and middleware. Forward only values
  // established from the socket or an explicitly trusted proxy.
  request.headers["x-forwarded-for"] = address;
  request.headers["x-real-ip"] = address;
  request.headers["x-forwarded-proto"] = protocol;
  delete request.headers["x-forwarded-host"];
  delete request.headers["x-forwarded-port"];
}

function verifiedNetwork(req: Request): { address: string; protocol: string } | null {
  const key = process.env.METIS_PRIVATE_NETWORK_KEY;
  const value = req.headers.get(PEER_HEADER) || "";
  if (!key || value.length > 1024) return null;
  const [payload, signature, ...rest] = value.split(".");
  if (!payload || !/^[a-f0-9]{64}$/.test(signature || "") || rest.length) return null;
  const actual = createHmac("sha256", key).update(payload).digest();
  if (!timingSafeEqual(actual, Buffer.from(signature, "hex"))) return null;
  try {
    const result = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof result.address !== "string" || !["http", "https"].includes(result.protocol)) return null;
    return result;
  } catch { return null; }
}

export function requestClientAddress(req: Request) {
  // Direct next dev/start lacks socket metadata: one conservative bucket.
  return verifiedNetwork(req)?.address || "unknown";
}

export function requestIsSecure(req: Request) {
  const metadata = verifiedNetwork(req);
  return metadata ? metadata.protocol === "https" : new URL(req.url).protocol === "https:";
}

/**
 * HTTP mutation origin check. Next's custom-server Request URL can contain the
 * loopback listener even when the browser used the public HTTPS origin.
 * Never treat unverified forwarded headers or the caller's Origin as authority.
 * Missing Origin retains the existing non-browser API behavior.
 */
export function requestOriginAllowed(req: Request) {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  try {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) return false;
    const allowed = new Set([new URL(req.url).origin]);
    const publicUrl = process.env.AI_CHAT_PUBLIC_URL?.trim();
    if (publicUrl) {
      try {
        const configured = new URL(publicUrl);
        if (["http:", "https:"].includes(configured.protocol) && !configured.username && !configured.password)
          allowed.add(configured.origin);
      } catch { /* Invalid optional configuration grants no additional origin. */ }
    }
    const metadata = verifiedNetwork(req);
    const host = req.headers.get("host");
    if (metadata && host && !/[\s/@\\?#]/u.test(host)) {
      const external = new URL(metadata.protocol + "://" + host);
      if (!external.username && !external.password && external.pathname === "/") allowed.add(external.origin);
    }
    return allowed.has(origin);
  } catch { return false; }
}

export function browserStreamOriginAllowed(request: IncomingMessage) {
  const origin = header(request, "origin");
  if (!origin || origin === "null") return false;
  try {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) return false;
    const allowed = new Set<string>();
    for (const value of [process.env.AI_CHAT_PUBLIC_URL, ...(process.env.AI_CHAT_BROWSER_ALLOWED_ORIGINS || "").split(",")]) {
      if (value?.trim()) allowed.add(new URL(value.trim()).origin);
    }
    const host = header(request, "host");
    if (host) allowed.add(new URL(socketRequestProtocol(request) + "://" + host).origin);
    return allowed.has(parsed.origin);
  } catch { return false; }
}
