import sharp from "sharp";
import { windowsDesktopMonitorsCommand, windowsDesktopPreviewCommand } from "@/remote-client/desktop-preview-command.mjs";
import { authorizeRemoteAction, getRemoteClient, type RemoteClient } from "@/lib/remote-clients";
import { requestRemoteClient } from "@/lib/remote-client-gateway";
import type { DesktopMonitor } from "@/lib/remote-desktop-view";

type CaptureRequest = typeof requestRemoteClient;
type Frame = { data: Uint8Array; capturedAt: number; width: number; height: number; monitorId?: string };
export type DesktopMonitorList = { monitors: DesktopMonitor[]; selectionSupported: boolean; reason?: string };
export class DesktopPreviewError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function validDesktopMonitorId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 &&
    value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

function previewClient(clientId: string, ownerId: string, operation: "preview" | "monitors") {
  const client = getRemoteClient(clientId, ownerId);
  if (!client) throw new DesktopPreviewError("Remote client not found", 404);
  if (client.status !== "online") throw new DesktopPreviewError("This device is offline. Start its Remote Client to view the desktop.", 409);
  const access = authorizeRemoteAction(client, "computer_use", { operation });
  if (!access.allowed) throw new DesktopPreviewError(access.reason || "Desktop access is disabled", 403);
  return client;
}

function unsupportedOperation(error: unknown) {
  return error instanceof Error && /unsupported computer use operation/i.test(error.message);
}

function selectedMonitorError(error: unknown): never {
  if (error instanceof Error && /(?:monitor|display).*(?:not found|unavailable|disconnected|unknown)|(?:unknown|invalid) (?:monitor|display)/i.test(error.message)) {
    throw new DesktopPreviewError("The selected monitor is no longer available. Refresh the monitor list.", 409);
  }
  throw error;
}

function compatibleCommandAllowed(client: RemoteClient, command: string) {
  const access = authorizeRemoteAction(client, "execute_command", { command });
  return /windows/i.test(client.os || "") && access.allowed && !access.requiresApproval;
}

async function runCompatibleCommand(request: CaptureRequest, clientId: string, ownerId: string, command: string) {
  const legacy = await request({ clientId, ownerId, action: "execute_command",
    params: { command, timeout: 15_000 }, source: "user", ephemeralPreview: true, timeoutMs: 20_000 }) as { stdout?: string };
  try { return JSON.parse(legacy.stdout || "") as unknown; }
  catch { throw new DesktopPreviewError("The device returned an invalid desktop response", 502); }
}

function normalizeMonitors(result: unknown): DesktopMonitor[] {
  const raw = result && typeof result === "object" ? (result as { monitors?: unknown }).monitors : undefined;
  if (!Array.isArray(raw) || raw.length > 64) throw new DesktopPreviewError("The device returned an invalid monitor list", 502);
  const ids = new Set<string>();
  return raw.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new DesktopPreviewError("The device returned an invalid monitor list", 502);
    const m = value as Record<string, unknown>;
    if (!validDesktopMonitorId(m.id) || ids.has(m.id) ||
        typeof m.name !== "string" || !m.name.trim() || m.name.length > 200 ||
        typeof m.primary !== "boolean" ||
        ![m.x, m.y, m.width, m.height].every(n => typeof n === "number" && Number.isSafeInteger(n)) ||
        Math.abs(m.x as number) > 1_000_000 || Math.abs(m.y as number) > 1_000_000 ||
        (m.width as number) < 1 || (m.height as number) < 1 ||
        (m.width as number) > 64_000 || (m.height as number) > 64_000) {
      throw new DesktopPreviewError("The device returned an invalid monitor list", 502);
    }
    ids.add(m.id);
    return { id: m.id, name: m.name, x: m.x as number, y: m.y as number,
      width: m.width as number, height: m.height as number, primary: m.primary };
  });
}

/** Monitor discovery is passive and uses the same owner/Computer Use boundary as frames. */
export function createDesktopMonitorList(request: CaptureRequest = requestRemoteClient) {
  const pending = new Map<string, Promise<DesktopMonitorList>>();
  return async (clientId: string, ownerId: string): Promise<DesktopMonitorList> => {
    const client = previewClient(clientId, ownerId, "monitors");
    const key = ownerId + ":" + clientId;
    const existing = pending.get(key);
    if (existing) {
      const result = await existing;
      previewClient(clientId, ownerId, "monitors");
      return result;
    }
    if (pending.size >= 32) throw new DesktopPreviewError("Too many desktop previews. Try again shortly.", 429);
    const load = async (): Promise<DesktopMonitorList> => {
      let result: unknown;
      try {
        result = await request({ clientId, ownerId, action: "computer_use",
          params: { operation: "monitors" }, source: "user", ephemeralPreview: true, timeoutMs: 15_000 });
      } catch (error) {
        if (/linux/i.test(client.os || "") && error instanceof Error &&
            error.message === "Monitor discovery needs xrandr with RandR 1.5 support on this Linux X11 desktop.") {
          return { monitors: [], selectionSupported: false,
            reason: "Install xrandr on this Linux device to choose a monitor." };
        }
        if (!unsupportedOperation(error)) throw error;
        const command = windowsDesktopMonitorsCommand();
        if (!compatibleCommandAllowed(client, command)) return { monitors: [], selectionSupported: false };
        result = await runCompatibleCommand(request, clientId, ownerId, command);
      }
      return { monitors: normalizeMonitors(result), selectionSupported: true };
    };
    const promise = load();
    pending.set(key, promise);
    try {
      const result = await promise;
      previewClient(clientId, ownerId, "monitors");
      return result;
    } finally {
      const timer = setTimeout(() => { if (pending.get(key) === promise) pending.delete(key); }, 500);
      timer.unref?.();
    }
  };
}

/** Share one capture per selected monitor; never queue frames behind a slow device. */
export function createDesktopCapture(request: CaptureRequest = requestRemoteClient) {
  const pending = new Map<string, Promise<Frame>>();
  const legacyUntil = new Map<string, number>();
  return async (clientId: string, ownerId: string, monitorId?: string): Promise<Frame> => {
    if (monitorId !== undefined && !validDesktopMonitorId(monitorId)) throw new DesktopPreviewError("Invalid monitor ID", 400);
    const client = previewClient(clientId, ownerId, "preview");
    const deviceKey = ownerId + ":" + clientId;
    const key = JSON.stringify([ownerId, clientId, monitorId ?? null]);
    const existing = pending.get(key);
    if (existing) {
      const result = await existing;
      previewClient(clientId, ownerId, "preview");
      return result;
    }
    if (pending.size >= 32) throw new DesktopPreviewError("Too many desktop previews. Try again shortly.", 429);
    const capture = async () => {
      const nativeKey = deviceKey + ":" + (client.version || "") + ":" + (monitorId === undefined ? "primary" : "selected");
      const markLegacy = () => {
        if (legacyUntil.size >= 200) legacyUntil.delete(legacyUntil.keys().next().value!);
        legacyUntil.set(nativeKey, Date.now() + 180_000);
      };
      let result: unknown;
      if ((legacyUntil.get(nativeKey) || 0) < Date.now()) {
        try {
          result = await request({ clientId, ownerId, action: "computer_use",
            params: { operation: "preview", ...(monitorId === undefined ? {} : { monitorId }) },
            source: "user", ephemeralPreview: true, timeoutMs: 15_000 });
          // Older clients accept preview but ignore unknown parameters. Never
          // present their primary image as the explicitly selected monitor.
          if (monitorId !== undefined && (!result || typeof result !== "object" ||
              (result as { monitorId?: unknown }).monitorId !== monitorId)) {
            result = undefined; markLegacy();
          }
        } catch (error) {
          if (!unsupportedOperation(error)) selectedMonitorError(error);
          markLegacy();
        }
      }
      if (!result) {
        const command = windowsDesktopPreviewCommand(monitorId);
        if (!compatibleCommandAllowed(client, command)) {
          throw new DesktopPreviewError("Update this Remote Client to enable monitor selection and passive desktop preview. Its current permissions do not allow the compatible capture.", 409);
        }
        try { result = await runCompatibleCommand(request, clientId, ownerId, command); }
        catch (error) { selectedMonitorError(error); }
      }
      const image = result as { image_base64?: unknown; mimeType?: unknown; monitorId?: unknown };
      if (monitorId !== undefined && image?.monitorId !== monitorId) {
        throw new DesktopPreviewError("Update this Remote Client to capture the selected monitor.", 409);
      }
      if (!image || typeof image.image_base64 !== "string" || image.image_base64.length > 12 * 1024 * 1024 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(image.image_base64)) throw new DesktopPreviewError("The device returned an invalid desktop frame", 502);
      const buffer = Buffer.from(image.image_base64, "base64");
      const { data, info } = await sharp(buffer, { limitInputPixels: 64_000_000 })
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 75 }).toBuffer({ resolveWithObject: true });
      return { data: new Uint8Array(data), capturedAt: Date.now(), width: info.width, height: info.height,
        ...(validDesktopMonitorId(image.monitorId) ? { monitorId: image.monitorId } : {}) };
    };
    const promise = capture();
    pending.set(key, promise);
    try {
      const result = await promise;
      previewClient(clientId, ownerId, "preview");
      return result;
    } finally {
      const timer = setTimeout(() => { if (pending.get(key) === promise) pending.delete(key); }, 500);
      timer.unref?.();
    }
  };
}
const globals = globalThis as typeof globalThis & {
  __metisDesktopCapture?: ReturnType<typeof createDesktopCapture>;
  __metisDesktopMonitorList?: ReturnType<typeof createDesktopMonitorList>;
};
export const captureRemoteDesktop = globals.__metisDesktopCapture ??= createDesktopCapture();
export const listRemoteDesktopMonitors = globals.__metisDesktopMonitorList ??= createDesktopMonitorList();
