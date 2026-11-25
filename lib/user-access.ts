import path from "node:path";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { hostUserFromInfo, windowsOsUserListScript } from "@/lib/windows-os-users";
import { getDatabase } from "@/lib/sqlite";
import { config } from "@/lib/config";
import {
  assertExecutionUid,
 hostPlatform,
  isInsideWorkspace,
  isRootWorkspace,
  listAssignablePosixUsers,
 parseMacOsUserLine,
 parseWindowsUserLine,
  parsePasswdLine,
  type HostOsUser,
 type PosixIdentity,
} from "@/lib/user-isolation";

export type UserAccess = {
  userId: string;
  workspaceRoot: string;
  osUsername?: string;
  uid?: number;
  gid?: number;
  home?: string;
};

export type UserExecutionIdentity = {
  username: string;
  uid?: number;
  gid?: number;
  home?: string;
  workspaceRoot: string;
};

type AccessRow = {
  userId: string;
  workspaceRoot: string;
  osUsername?: string;
  uid?: number;
  gid?: number;
};


export function lookupPosixUser(username: string): PosixIdentity | undefined {
  try {
    const line = readFileSync("/etc/passwd", "utf8").split("\n").find((entry) =>
      entry.split(":")[0]?.toLowerCase() === username.toLowerCase());
    return line ? parsePasswdLine(line) : undefined;
  } catch {
    return undefined;
  }
}

export function currentHostOsUser(): HostOsUser | undefined {
  try {
    return hostUserFromInfo(os.userInfo(), hostPlatform());
  } catch {
    return undefined;
  }
}

function hostOsUserMatches(user: HostOsUser, username: string) {
  return user.username.toLowerCase() === username.trim().toLowerCase();
}

export function lookupHostOsUser(username: string): HostOsUser | undefined {
  const clean = username.trim();
  if (!clean) return undefined;
  const current = currentHostOsUser();
  if (current && hostOsUserMatches(current, clean)) return current;
  const listed = listHostOsUsers().find((user) => hostOsUserMatches(user, clean));
  if (listed) return listed;
  const platform = hostPlatform();
  if (platform === "linux") {
    const posix = lookupPosixUser(clean);
    return posix ? { username: posix.username, uid: posix.uid, gid: posix.gid, home: posix.home } : undefined;
  }
  if (platform === "darwin") {
    if (clean.startsWith("-")) return undefined;
    const uidText = runHostCommand("id", ["-u", clean]).trim();
    const gidText = runHostCommand("id", ["-g", clean]).trim();
    if (!/^\d+$/.test(uidText) || !/^\d+$/.test(gidText)) return undefined;
    const uid = Number(uidText);
    const gid = Number(gidText);
    const home = runHostCommand("dscl", [".", "-read", `/Users/${clean}`, "NFSHomeDirectory"]).match(/NFSHomeDirectory:\s+(.+)/)?.[1]?.trim()
      || `/Users/${clean}`;
    return { username: clean, uid, gid: Number.isInteger(gid) ? gid : undefined, home };
  }
  const named = runHostCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Get-LocalUser -Name ${"'" + clean.replaceAll("'", "''") + "'"} | ForEach-Object { $_.Name }`,
  ]).trim().split("\n").map((line) => line.trim()).find(Boolean);
  return named ? { username: named, home: "" } : undefined;
}

function runHostCommand(command: string, args: string[]) {
 try { return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 10_000 }); }
 catch { return ""; }
}

function listMacOsUsers(): HostOsUser[] {
 const current = os.userInfo().username;
 const listed = runHostCommand("dscl", [".", "-list", "/Users", "UniqueID"]);
 return listed.split("\n").map(parseMacOsUserLine).filter((user): user is HostOsUser => Boolean(user))
 .filter((user) => ((user.uid !== undefined && user.uid >= 501) || user.username === current) && !["daemon", "nobody"].includes(user.username.toLowerCase()))
 .map((user) => ({ ...user, home: runHostCommand("dscl", [".", "-read", `/Users/${user.username}`, "NFSHomeDirectory"]).match(/NFSHomeDirectory:\s+(.+)/)?.[1]?.trim() || `/Users/${user.username}` }))
 .sort((a, b) => a.username.localeCompare(b.username));
}

function listWindowsUsers(): HostOsUser[] {
 const listed = runHostCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsOsUserListScript]);
 const users = listed.split("\n").map(parseWindowsUserLine).filter((user): user is HostOsUser => Boolean(user));
 return users.sort((a, b) => a.username.localeCompare(b.username));
}

export function listHostOsUsers(platform = hostPlatform()): HostOsUser[] {
  let users: HostOsUser[] = [];
  if (platform === "darwin") users = listMacOsUsers();
  else if (platform === "win32") users = listWindowsUsers();
  else {
    try {
      users = listAssignablePosixUsers(readFileSync("/etc/passwd", "utf8"), { includeRoot: config.allowRootAgents });
    } catch {
      users = [];
    }
  }
  const current = currentHostOsUser();
  if (
    current
    && !users.some((user) => hostOsUserMatches(user, current.username))
    && (platform === "win32" || (current.uid !== undefined && current.uid > 0) || config.allowRootAgents)
  ) {
    users = [...users, current].sort((a, b) => a.username.localeCompare(b.username));
  }
  return users;
}
export function getUserAccess(userId?: string): UserAccess {
  if (!userId?.trim()) return { userId: "", workspaceRoot: path.resolve(config.agentCwd) };
  const row = getDatabase().prepare(
    `SELECT user_id AS userId, workspace_root AS workspaceRoot,
            os_username AS osUsername, uid, gid
     FROM user_workspace_access WHERE user_id = ?`,
  ).get(userId.trim()) as AccessRow | undefined;
  if (row?.workspaceRoot) {
    const posix = row.osUsername ? lookupHostOsUser(row.osUsername) : undefined;
    return {
      ...row,
      workspaceRoot: path.resolve(row.workspaceRoot),
      ...(typeof row.uid === "number" ? { uid: row.uid } : posix ? { uid: posix.uid } : {}),
      ...(typeof row.gid === "number" ? { gid: row.gid } : posix ? { gid: posix.gid } : {}),
      ...(posix?.home ? { home: posix.home } : {}),
    };
  }
  return { userId: userId.trim(), workspaceRoot: path.resolve(config.agentCwd) };
}

/** Root is a host-admin opt-in, never an account-order/username fallback. */
function explicitlyAuthorizedHostAdmin(userId: string) {
  const row = getDatabase().prepare("SELECT is_admin AS isAdmin FROM users WHERE id = ?")
    .get(userId) as { isAdmin: number } | undefined;
  return Number(row?.isAdmin) === 1;
}

function canonicalWorkspace(workspace: string) {
  // Existing directories only: resolve symlinks before checking ownership/overlap.
  return realpathSync(path.resolve(workspace));
}

/** Also used by role updates, so demotion cannot leave a privileged mapping. */
export function assertSafeUserAccess(userId: string, workspaceRoot: string, identity?: HostOsUser,
  options: { isAdmin?: boolean; execution?: boolean } = {}) {
  const admin = options.isAdmin ?? explicitlyAuthorizedHostAdmin(userId);
  if (!getDatabase().prepare("SELECT id FROM users WHERE id = ?").get(userId)) {
    throw new Error("Agent execution requires an existing authenticated account.");
  }
  if (!identity) {
    if (admin && !options.execution) return; // Admin may configure a blocked account.
    throw new Error("This account has no valid OS user mapping; an isolated unprivileged identity is required.");
  }
  if (identity.uid === 0) {
    assertExecutionUid(0, { allowRoot: config.allowRootAgents && admin, workspaceRoot, home: identity.home });
    // Preserve the explicit root admin's running access even when legacy unsafe
    // rows exist. Those rows are rejected independently at their execution guard.
    if (options.execution) return;
  }
  if (!admin && hostPlatform() === "win32") {
    // A name/profile is not proof of a restricted token, SID uniqueness or ACLs.
    // Until a Windows token/ACL verifier is integrated, fail closed.
    throw new Error("Windows nonadmin isolation requires verified restricted SID/token and workspace ACLs.");
  }
  if (hostPlatform() !== "win32") {
    assertExecutionUid(identity.uid, { allowRoot: config.allowRootAgents && admin, workspaceRoot, home: identity.home });
    if (!Number.isInteger(identity.gid) || Number(identity.gid) < 0) throw new Error("Invalid OS group mapping.");
  }
  const others = (getDatabase().prepare(
    `SELECT u.id AS userId, u.is_admin AS isAdmin, a.workspace_root AS workspaceRoot, a.os_username AS osUsername, a.uid, a.gid
     FROM users u LEFT JOIN user_workspace_access a ON a.user_id = u.id WHERE u.id <> ?`,
  ).all(userId) as Array<AccessRow & { isAdmin: number }>).filter((other) => {
    const otherIdentity = other.osUsername ? lookupHostOsUser(other.osUsername) : undefined;
    // Accounts assigned to the same host identity intentionally share its file access.
    return !((other.osUsername && other.osUsername.toLowerCase() === identity.username.toLowerCase())
      || (identity.uid !== undefined && otherIdentity?.uid === identity.uid));
  });
  let workspace = path.resolve(workspaceRoot);
  try { workspace = canonicalWorkspace(workspaceRoot); } catch (error) { if (!admin) throw error; }
  const otherWorkspaces: string[] = [];
  for (const other of others) {
    const otherWorkspace = other.workspaceRoot || config.agentCwd;
    let resolved = path.resolve(otherWorkspace);
    try { resolved = canonicalWorkspace(otherWorkspace); } catch { /* Still reject lexical overlap. */ }
    // An admin's explicit filesystem-wide workspace can coexist with scoped accounts.
    if ((admin && workspace === path.parse(workspace).root)
      || (Number(other.isAdmin) === 1 && resolved === path.parse(resolved).root)) continue;
    otherWorkspaces.push(resolved);
    if (isInsideWorkspace(resolved, workspace) || isInsideWorkspace(workspace, resolved)) {
      throw new Error("Workspace must be distinct from accounts using another OS identity (including nested or symlink paths).");
    }
  }
  if (admin) return;
  if (identity.uid === process.getuid?.() || identity.gid === 0 || identity.uid === 65534) {
    throw new Error("Nonadmin execution cannot use the service identity or a privileged group.");
  }
  if (Number(identity.uid) < (hostPlatform() === "darwin" ? 501 : 1000)) {
    throw new Error("Nonadmin execution requires a dedicated regular OS account, not a system identity.");
  }
  const info = statSync(workspace);
  if (!info.isDirectory() || info.uid !== identity.uid) {
    throw new Error("Nonadmin workspace must be a directory owned by its OS identity.");
  }
  // Linux mode group bits include the POSIX ACL mask when present. Allow
  // group read/search, but not effective group/ACL writes or access by others.
  const forbiddenWorkspaceMode = hostPlatform() === "linux" ? 0o027 : 0o077;
  if ((info.mode & forbiddenWorkspaceMode) !== 0) {
    throw new Error(hostPlatform() === "linux"
      ? "Nonadmin workspace must not allow group writes or access by others (for example, use 0750 or 0700)."
      : "Nonadmin workspace must be private (0700, no shared ACL access).");
  }
  const groups = runHostCommand("id", ["-Gn", identity.username]).trim().split(/\s+/);
  if (!groups[0] || groups.some((group) => ["root", "sudo", "wheel", "admin", "docker", "lxd", "disk", "shadow"].includes(group))) {
    throw new Error("Cannot verify an unprivileged OS identity/group membership.");
  }
  const groupIds = runHostCommand("id", ["-G", identity.username]).trim().split(/\s+/).map(Number);
  if (!groupIds.length || groupIds.some((gid) => !Number.isInteger(gid) || gid <= 0)) {
    throw new Error("Cannot verify unprivileged supplementary groups.");
  }
  // Per-user sudoers grants can exist without membership in sudo/wheel.
  // Missing sudo is harmless; unavailable/ambiguous policy checks fail closed.
  const denialPrefix = `User ${identity.username} is not allowed to run sudo on `;
  const policyDeniesSudo = (output: string) => output.trim().startsWith(denialPrefix)
    && /^[^\r\n]+\.$/.test(output.trim());
  try {
    const output = execFileSync("sudo", ["-n", "-l", "-U", identity.username], { encoding: "utf8",
      env: { NODE_ENV: "production", PATH: process.env.PATH, LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 10_000 });
    // sudo 1.9 may exit 0 when listing an explicitly denied user's policy.
    if (!policyDeniesSudo(output)) throw new Error("OS identity has sudo privileges.");
  } catch (error) {
    const failure = error as { code?: string; status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    const denied = failure.status === 1 && policyDeniesSudo(`${failure.stdout || ""}${failure.stderr || ""}`);
    if (failure.code !== "ENOENT" && !denied) throw new Error("Cannot verify an unprivileged OS identity: sudo policy permits access or is unavailable.");
  }
  // Verify effective access, including POSIX ACLs, rather than assuming chmod
  // on the workspace protects separate shared data/session/config directories.
  const protectedPaths = [...new Set([config.databasePath, config.dataDir, config.mcpStateDir,
    path.join(config.root, ".env"), path.join(config.root, ".env.local"),
    path.join(config.installDir, ".env"), currentHostOsUser()?.home,
    ...otherWorkspaces].filter((value): value is string => Boolean(value)))];
  try {
    const result = execFileSync(process.execPath, ["-e", `
      const fs = require('node:fs');
      const input = JSON.parse(process.argv[1]);
      if (process.getuid() === 0) {
        process.initgroups(input.username, input.gid);
        process.setgid(input.gid); process.setuid(input.uid);
      }
      if (process.getuid() !== input.uid || process.getgid() !== input.gid) process.exit(2);
      fs.accessSync(input.workspace, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
      for (const file of input.paths) {
        for (const mode of [fs.constants.R_OK, fs.constants.W_OK]) {
          try { fs.accessSync(file, mode); process.exit(3); } catch (error) {
            if (!['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
          }
        }
      }
      // Read-only code sharing is allowed; writable installation directories
      // would permit replacing config/code even when individual files are private.
      for (const directory of input.codeDirectories) {
        try { fs.accessSync(directory, fs.constants.W_OK); process.exit(3); } catch (error) {
          if (!['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        }
      }
      process.stdout.write('ISOLATED');
    `, JSON.stringify({ username: identity.username, uid: identity.uid, gid: identity.gid,
      workspace, paths: protectedPaths, codeDirectories: [config.root, config.installDir] })], { encoding: "utf8", cwd: workspace,
      env: { NODE_ENV: "production" }, stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 10_000 });
    if (result !== "ISOLATED") throw new Error("Unverified isolation");
  } catch {
    throw new Error("OS isolation verification failed: workspace access or shared DB/config/service directories are unsafe.");
  }
}

export function getUserExecutionIdentity(userId?: string): UserExecutionIdentity | undefined {
  if (!userId?.trim()) return undefined;
  userId = userId.trim();
  const access = getUserAccess(userId);
  let identity = access.osUsername ? lookupHostOsUser(access.osUsername) : undefined;
  if (!identity && !access.osUsername && hostPlatform() !== "win32"
    && config.allowRootAgents && explicitlyAuthorizedHostAdmin(userId)) {
    const root = lookupHostOsUser("root");
    if (root?.uid === 0 && isRootWorkspace(access.workspaceRoot, root.home)) identity = root;
  }
  if (!identity) return undefined;
  // Persisted numeric metadata must never override the host's current identity.
  if (hostPlatform() !== "win32" && ((access.uid != null && access.uid !== identity.uid)
    || (access.gid != null && access.gid !== identity.gid))) return undefined;
  assertSafeUserAccess(userId, access.workspaceRoot, identity, { execution: true });
  return { username: identity.username, uid: identity.uid, gid: identity.gid,
    home: identity.home, workspaceRoot: access.workspaceRoot };
}

export function requireUserExecutionIdentity(userId?: string): UserExecutionIdentity {
  // No Docker/service-identity bypass, and no execution-time writes/repair of
  // legacy unsafe mappings. Provisioning is an explicit management operation.
  const identity = getUserExecutionIdentity(userId);
  if (!identity) throw new Error("This account has no valid OS user mapping. Provision an isolated workspace with scripts/provision-user.ts.");
  return identity;
}

export function adminUserCount() {
  return Number(
    (getDatabase().prepare("SELECT COUNT(*) as count FROM users WHERE is_admin = 1").get() as { count: number }).count,
  );
}

export function isHostAdmin(userId?: string | null) {
  return Boolean(userId?.trim() && explicitlyAuthorizedHostAdmin(userId.trim()));
}

export function inferOsUsernameForWorkspace(workspaceRoot = config.agentCwd): string | undefined {
  if (hostPlatform() === "win32") {
    const installedBy = process.env.METIS_HOST_OS_USERNAME?.trim();
    const installer = installedBy ? lookupHostOsUser(installedBy) : undefined;
    return installer?.username || currentHostOsUser()?.username;
  }
  const current = currentHostOsUser();
  if (!current?.username) return undefined;
  if (current.uid === 0) {
    if (config.allowRootAgents && isRootWorkspace(workspaceRoot, current.home || "/root")) {
      return current.username;
    }
    return undefined;
  }
  if (current.uid !== undefined && current.uid > 0) return current.username;
  return undefined;
}

export function resolveManagedWorkspaceRoot(workspaceRoot?: string | null) {
  const resolved = path.resolve((workspaceRoot || "").trim() || config.agentCwd);
  if (!path.isAbsolute(resolved)) {
    throw new Error("Workspace path must be an absolute directory.");
  }
  if (config.docker && !isInsideWorkspace(config.dockerWorkspace, resolved)) {
    throw new Error(`Docker workspaces must be inside ${config.dockerWorkspace}.`);
  }
  return resolved;
}

export function ensureUserAccess(
  userId: string,
  workspaceRoot: string,
  osUsername?: string,
) {
  const db = getDatabase();
  db.exec("SAVEPOINT user_access_mapping");
  try {
    const identity = osUsername ? lookupHostOsUser(osUsername) : undefined;
    if (osUsername && !identity) {
      throw new Error(`OS user ${osUsername} does not exist on this host.`);
    }
    assertSafeUserAccess(userId, workspaceRoot, identity);
    db.prepare(
      `INSERT INTO user_workspace_access
         (user_id, workspace_root, os_username, uid, gid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         workspace_root = excluded.workspace_root,
         os_username = excluded.os_username,
         uid = excluded.uid,
         gid = excluded.gid,
         updated_at = excluded.updated_at`,
    ).run(
      userId,
      path.resolve(workspaceRoot),
      osUsername ?? null,
      hostPlatform() === "win32" ? null : identity?.uid ?? null,
      hostPlatform() === "win32" ? null : identity?.gid ?? null,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    db.exec("RELEASE user_access_mapping");
  } catch (error) {
    db.exec("ROLLBACK TO user_access_mapping");
    db.exec("RELEASE user_access_mapping");
    throw error;
  }
}

export function provisionAccountAccess(userId: string, username: string) {
  const posix = lookupHostOsUser(username);
  if (!posix || (hostPlatform() !== "win32" && (posix.uid === undefined || posix.uid <= 0))) return false;
  const workspace = posix.home && posix.home !== "/" && posix.home !== "/root"
    ? posix.home
    : path.join("/home", username);
  ensureUserAccess(userId, workspace, username);
  return true;
}

/** Explicit provisioning helper; execution never calls this or mutates access. */
export function provisionMissingAccountAccess(userId: string, username: string) {
  const access = getUserAccess(userId);
  if (access.osUsername) {
    const current = lookupHostOsUser(access.osUsername);
    assertSafeUserAccess(userId, access.workspaceRoot, current, { execution: true });
    return Boolean(current);
  }
  if (explicitlyAuthorizedHostAdmin(userId)) {
    const inferred = inferOsUsernameForWorkspace(access.workspaceRoot);
    if (inferred) { ensureUserAccess(userId, access.workspaceRoot, inferred); return true; }
  }
  return provisionAccountAccess(userId, username);
}
