import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { totalmem } from "node:os";
import { spawn } from "node:child_process";

function positiveInteger(value, fallback, min, max, label) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`Invalid ${label}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`Invalid ${label}`);
  return number;
}

/** Scopes move the existing process; unlike transient services they preserve
 * the caller's mount namespace, environment, cwd and stdio. No shell/secret
 * serialization, manager environment import or unsandboxed fallback is used. */
export function resourceScopePlan(command, args, options, timeoutSec, {
  platform = process.platform,
  systemd = existsSync("/run/systemd/system"),
  uid = process.getuid?.(),
  config = process.env,
  memory = totalmem(),
  id = randomUUID(),
} = {}) {
  if (platform !== "linux" || !systemd) return {command, args, options, unit: null};
  const memoryMB = positiveInteger(config.METIS_TOOL_MEMORY_MAX_MB,
    Math.max(128, Math.min(8192, Math.floor(memory / 1024 / 1024 / 4))), 16, 1048576, "tool memory limit");
  const cpu = positiveInteger(config.METIS_TOOL_CPU_QUOTA_PERCENT, 200, 1, 10000, "tool CPU quota");
  const tasks = positiveInteger(config.METIS_TOOL_TASKS_MAX, 512, 16, 65536, "tool task limit");
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid resource scope ID");
  const unit = `metis-tool-${id}.scope`;
  const userManager = uid !== 0;
  const scopeArgs = [
    ...(userManager ? ["--user"] : []), "--scope", "--quiet", "--collect",
    "--no-ask-password", "--description=Metis isolated tool invocation", `--unit=${unit}`,
    `--property=MemoryMax=${memoryMB}M`,
    `--property=CPUQuota=${cpu}%`,
    `--property=TasksMax=${tasks}`,
    `--property=RuntimeMaxSec=${Math.max(1, Math.ceil(timeoutSec))}s`,
  ];
  if (options.uid !== undefined) {
    if (userManager && options.uid !== uid) throw new Error("Cannot isolate a different OS identity with a user manager");
    if (!userManager) {
      scopeArgs.push(`--uid=${options.uid}`);
      if (options.gid !== undefined) scopeArgs.push(`--gid=${options.gid}`);
    }
  }
  // The manager client may run as root, but systemd-run drops groups/UID before
  // executing any untrusted command. Existing filesystem sandboxing is retained.
  const scopeOptions = {...options};
  delete scopeOptions.uid;
  delete scopeOptions.gid;
  if (userManager) {
    scopeOptions.env = {...options.env, XDG_RUNTIME_DIR: `/run/user/${uid}`};
  }
  return {
    command: "/usr/bin/systemd-run", args: [...scopeArgs, "--", command, ...args],
    options: scopeOptions, unit, userManager,
  };
}

export function signalResourceScope(plan, signal, spawnProcess = spawn) {
  if (!plan.unit) return;
  const child = spawnProcess("/usr/bin/systemctl", [
    ...(plan.userManager ? ["--user"] : []), "--no-ask-password",
    "kill", `--signal=${signal}`, "--kill-who=all", plan.unit,
  ], {stdio: "ignore", env: plan.options.env});
  child.on("error", () => {}); // The unit may already have been collected.
  child.unref();
}
