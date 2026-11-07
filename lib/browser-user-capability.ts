import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";

// Process-only capability, shared by Next routes and the custom server through
// globalThis. Never persisted or inherited by worker/native agent processes.
const symbol=Symbol.for("metis.browser.user-capability");
const state=globalThis as typeof globalThis & {[symbol: symbol]: Buffer};
const secret=state[symbol] ||= randomBytes(32);
export function signBrowserUserAction(owner: string, chat: string, action: unknown) {
  return createHmac("sha256",secret).update(JSON.stringify([owner,chat,action])).digest("hex");
}
export function verifyBrowserUserAction(owner: string, chat: string, action: unknown, signature: unknown) {
  if(typeof signature!=="string" || !/^[a-f0-9]{64}$/.test(signature))return false;
  return timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(signBrowserUserAction(owner,chat,action),"hex"));
}
