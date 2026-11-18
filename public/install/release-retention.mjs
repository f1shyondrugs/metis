// Shared by the native CLI synchronizer and the standalone Unix client installer.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function liveProcessReferences() {
  try {
    if (process.platform === "linux") {
      const references = [];
      for (const pid of fs.readdirSync("/proc").filter(name => /^\d+$/.test(name))) {
        try {
          const sameUser = fs.statSync(`/proc/${pid}`).uid === process.getuid();
          references.push(fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " "));
          for (const kind of ["cwd", "exe"]) {
            try { references.push(fs.readlinkSync(`/proc/${pid}/${kind}`)); }
            catch (error) {
              // Ordinary service users cannot ptrace foreign-user cwd/exe links.
              // Their command paths are still included; require full visibility
              // for this user's own processes, which own these installations.
              if (!sameUser && ["EACCES", "EPERM"].includes(error.code)) continue;
              if (!["ENOENT", "ESRCH"].includes(error.code)) throw error;
            }
          }
        } catch (error) {
          if (!["ENOENT", "ESRCH"].includes(error.code)) return null;
        }
      }
      return references;
    }
    if (process.platform === "darwin") {
      // Include cwd and open/mapped files as well as executable/command paths.
      const commands = execFileSync("/bin/ps", ["-axo", "command="], { encoding: "utf8", timeout: 10000 });
      const files = execFileSync("/usr/sbin/lsof", ["-n", "-P", "-Fn"], { encoding: "utf8", timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
      return [commands, files];
    }
    if (process.platform === "win32") {
      const script = "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | ForEach-Object { if ($_.ProcessId -gt 4 -and -not $_.ExecutablePath) { throw 'Incomplete process visibility' }; $_.ExecutablePath; $_.CommandLine }) | ConvertTo-Json -Compress";
      const result = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 10000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }));
      return Array.isArray(result) ? result.filter(value => typeof value === "string") : null;
    }
  } catch { /* No reliable process snapshot means no deletion. */ }
  return null;
}

export function pruneManagedReleases({
  root, active, previous, pattern, requiredFiles,
  minAgeMs = 24 * 60 * 60 * 1000, now = Date.now(),
  references = liveProcessReferences(),
}) {
  const result = { removed: [], skipped: [] };
  root = path.resolve(root);
  if (!Array.isArray(references)) return { ...result, reason: "Process visibility unavailable" };
  // Refuse symlinked roots, symlinked releases, and paths outside this exact layout.
  if (!fs.lstatSync(root).isDirectory() || fs.realpathSync(root) !== root) {
    return { ...result, reason: "Release root is not a canonical directory" };
  }
  const directChild = value => value && path.dirname(path.resolve(value)) === root;
  if (!directChild(active) || !fs.lstatSync(active).isDirectory() || fs.realpathSync(active) !== path.resolve(active)) {
    return { ...result, reason: "Active release is invalid" };
  }
  if (previous && !directChild(previous)) return { ...result, reason: "Previous release is outside the root" };
  const protectedPaths = new Set([active, previous].filter(Boolean).map(value => path.resolve(value)));
  const normalize = value => process.platform === "win32" ? value.toLowerCase().replaceAll("/", "\\") : value;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (!entry.isDirectory() || !pattern.test(entry.name) || protectedPaths.has(candidate)) continue;
    const info = fs.lstatSync(candidate);
    if (!info.isDirectory() || info.dev !== fs.statSync(root).dev || fs.realpathSync(candidate) !== candidate) continue;
    if (now - info.mtimeMs < minAgeMs || references.some(value => normalize(value).includes(normalize(candidate)))) {
      result.skipped.push(entry.name);
      continue;
    }
    // Only recognize completed managed layouts; never arbitrary user directories.
    if (!requiredFiles.every(file => fs.existsSync(path.join(candidate, file)))) continue;
    // Recheck inode identity immediately before deleting. rm does not follow nested symlinks.
    const current = fs.lstatSync(candidate);
    if (current.ino !== info.ino || current.dev !== info.dev || !current.isDirectory()) continue;
    fs.rmSync(candidate, { recursive: true });
    result.removed.push(entry.name);
  }
  return result;
}
