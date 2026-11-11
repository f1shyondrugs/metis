export type RemotePermissionMode = "user" | "admin";
export type RemoteCapability =
  | "user_files"
  | "user_processes"
  | "user_directories"
  | "system_files"
  | "services"
  | "disks"
  | "admin_processes";

export const USER_CAPABILITIES: RemoteCapability[] = ["user_files", "user_processes", "user_directories"];
export const ADMIN_CAPABILITIES: RemoteCapability[] = [...USER_CAPABILITIES, "system_files", "services", "disks", "admin_processes"];

export function normalizePermissionMode(value: unknown): RemotePermissionMode {
  return value === "admin" ? "admin" : "user";
}

export function capabilitiesForPermissionMode(mode: RemotePermissionMode) {
  return mode === "admin" ? [...ADMIN_CAPABILITIES] : [...USER_CAPABILITIES];
}

const SYSTEM_COMMANDS = /(^|[\s;&|])(sc|sc\.exe|net\s+(start|stop)|powershell(?:\.exe)?|pwsh|reg(?:\.exe)?|diskpart|mountvol|format(?:\.com)?|bcdedit|wevtutil|takeown|icacls|taskkill)(?:[\s;&|]|$)/i;
const SYSTEM_PATH = /(^|[\\/])(?:windows|program files(?: \(x86\))?|programdata|system volume information)(?:[\\/]|$)/i;

export function isRiskyRemoteAction(action: string, params: Record<string, unknown> = {}) {
  if (["services", "disks", "system_files", "admin_processes"].includes(action)) return true;
  const command = typeof params.command === "string" ? params.command : "";
  const target = typeof params.path === "string" ? params.path : "";
  return SYSTEM_COMMANDS.test(command) || SYSTEM_PATH.test(command) || SYSTEM_PATH.test(target);
}

/** Runtime feature reports are advisory; policy and ownership remain authoritative. */
export function applyRuntimeCapabilities(current: string[], report: {desktopGui?: boolean; overlayAnnotations?: boolean}) {
  const next = new Set(current);
  for (const [field, capability] of [["desktopGui", "desktop_gui"], ["overlayAnnotations", "overlay_annotations"]] as const) {
    if (typeof report[field] === "boolean") { if (report[field]) next.add(capability); else next.delete(capability); }
  }
  return [...next];
}

/** Overlay capability is additive, not a shell fallback or a permission bypass. */
export function validateDesktopOverlayTarget(
  client: { ownerId: string; status: string; capabilities: readonly string[]; policy: { permissions: readonly string[] } },
  ownerId: string,
) {
  if (!ownerId || client.ownerId !== ownerId) return { allowed: false, reason: "Remote client not found" };
  if (client.status === "revoked") return { allowed: false, reason: "Client is revoked" };
  if (!client.policy.permissions.includes("computer_use")) return { allowed: false, reason: "Computer Use is switched off for this device" };
  if (!client.capabilities.includes("overlay_annotations")) return { allowed: false, reason: "Remote client update needed: overlay_annotations capability is required; no shell fallback was executed" };
  if (!client.capabilities.includes("desktop_gui")) return { allowed: false, reason: "This device has no interactive GUI" };
  return { allowed: true };
}

export function validateUserRemoteRequest(action: string, params: Record<string, unknown> = {}) {
  if (isRiskyRemoteAction(action, params)) return { allowed: false, reason: "User access blocks system areas and administrative actions" };
  for (const key of ["path", "cwd"]) {
    const value = params[key];
    if (typeof value === "string" && (/^(?:[A-Za-z]:[\\/]|\\\\|\/etc|\/root|\/var|\/usr|\/opt|\/system|\/library)/i.test(value))) {
      return { allowed: false, reason: "User access allows user directories only" };
    }
  }
  return { allowed: true };
}
