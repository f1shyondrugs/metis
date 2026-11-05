import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildWindowsDesktopPreviewScript, windowsDesktopMonitorsScript, validateDesktopMonitorId } from "./desktop-preview-command.mjs";
export { windowsDesktopPreviewScript, windowsDesktopPreviewCommand, windowsDesktopMonitorsCommand } from "./desktop-preview-command.mjs";
const exec = promisify(execFile);

function optionsFor(signal, env) {
  return { signal, env, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 };
}

export function parseXrandrMonitors(text) {
  const monitors = String(text).split("\n").flatMap(line => {
    const m = line.match(/^\s*\d+:\s+([+*]*)(\S+)\s+(\d+)(?:\/\d+)?x(\d+)(?:\/\d+)?([+-]\d+)([+-]\d+)(?:\s+.*)?$/);
    if (!m) return [];
    return [{ id: m[2], name: m[2], width: Number(m[3]), height: Number(m[4]), x: Number(m[5]), y: Number(m[6]), primary: m[1].includes("*") }];
  });
  if (!monitors.length) throw new Error("No active monitors found on this X11 display");
  return monitors;
}

function validateMonitors(result) {
  if (!result || !Array.isArray(result.monitors) || !result.monitors.length || result.monitors.length > 64) throw new Error("The device returned an invalid monitor list");
  const ids = new Set();
  return { monitors: result.monitors.map(m => {
    if (!m || typeof m.id !== "string") throw new Error("The device returned an invalid monitor list");
    validateDesktopMonitorId(m.id);
    if (typeof m.name !== "string" || !m.name.length || m.name.length > 300 || ids.has(m.id) ||
      ![m.x, m.y, m.width, m.height].every(Number.isFinite) || m.width <= 0 || m.height <= 0 || typeof m.primary !== "boolean") throw new Error("The device returned an invalid monitor list");
    ids.add(m.id);
    return { id: m.id, name: m.name, x: m.x, y: m.y, width: m.width, height: m.height, primary: m.primary };
  }) };
}

async function availableUnix(signal, platform, env, run) {
  const { unixComputerUse } = await import("./computer-use-unix.mjs");
  const state = await unixComputerUse({ operation: "status" }, { signal, platform, env, run });
  if (!state.available) throw new Error(state.reason || "Desktop capture is unavailable");
  return unixComputerUse;
}

export async function listDesktopMonitors({ signal, platform = process.platform, run = exec, env = process.env } = {}) {
  const options = optionsFor(signal, env);
  if (platform === "win32") {
    const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(windowsDesktopMonitorsScript, "utf16le").toString("base64")], { ...options, windowsHide: true });
    return validateMonitors(JSON.parse(String(result.stdout).trim()));
  }
  if (platform === "darwin") {
    const unixComputerUse = await availableUnix(signal, platform, env, run);
    return validateMonitors(await unixComputerUse({ operation: "monitors" }, { signal, platform, env, run }));
  }
  if (platform === "linux") {
    await availableUnix(signal, platform, env, run);
    let result;
    try { result = await run("xrandr", ["--listmonitors"], { ...options, encoding: "utf8" }); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw new Error("Monitor discovery needs xrandr with RandR 1.5 support on this Linux X11 desktop.");
    }
    return validateMonitors({ monitors: parseXrandrMonitors(result.stdout) });
  }
  throw new Error("Desktop preview is unavailable on this operating system");
}

export async function captureDesktopPreview({ signal, monitorId, platform = process.platform, run = exec, env = process.env } = {}) {
  validateDesktopMonitorId(monitorId);
  const options = optionsFor(signal, env);
  if (platform === "win32") {
    const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(buildWindowsDesktopPreviewScript(monitorId), "utf16le").toString("base64")], { ...options, windowsHide: true });
    const frame = JSON.parse(String(result.stdout).trim());
    if (monitorId !== undefined && frame.monitorId !== monitorId) throw new Error("Selected monitor is unavailable");
    return frame;
  }
  if (platform === "darwin" || platform === "linux") {
    let monitors;
    try {
      ({ monitors } = await listDesktopMonitors({ signal, platform, env, run }));
    } catch (error) {
      // Older X11 installations can preview the root desktop without RandR.
      // Preserve that default only; a requested monitor must never fall back.
      if (platform !== "linux" || monitorId !== undefined ||
          !(error instanceof Error) || !error.message.startsWith("Monitor discovery needs xrandr ")) throw error;
      const result = await run("import", ["-window", "root", "-resize", "1600x1600>", "jpeg:-"],
        { ...options, encoding: "buffer" });
      return { image_base64: Buffer.from(result.stdout).toString("base64"), mimeType: "image/jpeg" };
    }
    const selected = monitorId === undefined ? (monitors.find(m => m.primary) ?? monitors[0]) : monitors.find(m => m.id === monitorId);
    if (!selected) throw new Error("Selected monitor is unavailable");
    if (platform === "darwin") {
      // Native global display bounds select this display without focusing an app.
      const fs = await import("node:fs/promises"), os = await import("node:os"), path = await import("node:path");
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "metis-preview-"));
      try {
        const file = path.join(dir, "screen.jpg");
        await run("/usr/sbin/screencapture", ["-x", "-R", [selected.x, selected.y, selected.width, selected.height].join(","), "-t", "jpg", file], options);
        return { image_base64: (await fs.readFile(file)).toString("base64"), mimeType: "image/jpeg", monitorId: selected.id };
      } finally { await fs.rm(dir, { recursive: true, force: true }); }
    }
    // ImageMagick crop offsets are relative to the root image, whereas RandR
    // monitor bounds can use a signed virtual-desktop origin.
    const rootX = Math.min(0, ...monitors.map(m => m.x));
    const rootY = Math.min(0, ...monitors.map(m => m.y));
    const geometry = selected.width + "x" + selected.height + "+" + (selected.x - rootX) + "+" + (selected.y - rootY);
    const result = await run("import", ["-window", "root", "-crop", geometry, "+repage", "-resize", "1600x1600>", "jpeg:-"],
      { ...options, encoding: "buffer" });
    return { image_base64: Buffer.from(result.stdout).toString("base64"), mimeType: "image/jpeg", monitorId: selected.id };
  }
  throw new Error("Desktop preview is unavailable on this operating system");
}
