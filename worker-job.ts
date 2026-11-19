// The existing supervisor invokes this file in a fresh child for every claimed job.
// Use exec, not a second child: inherit the job lease, descriptors and signal lifetime.
const source = "/root/metis-push-az6j2f";
const id = process.argv[2]?.trim();
if (!id || typeof process.execve !== "function") throw new Error("Expected a worker job and the supported Node standby runtime.");
process.execve(process.execPath, [
  process.execPath, "--import", source + "/node_modules/tsx/dist/loader.mjs", source + "/worker-job.ts", id,
], {
  ...process.env,
  AI_CHAT_SERVER_SOURCE_DIR: source,
  AI_CHAT_SKILL_ROOT: process.env.AI_CHAT_INSTALL_DIR || "/root/metis-ai",
  TSX_TSCONFIG_PATH: source + "/tsconfig.json",
});
