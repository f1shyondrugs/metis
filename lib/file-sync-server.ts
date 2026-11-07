import { callNativeDevelopmentBroker } from "@/lib/native-development-broker";
import { spawn } from "node:child_process";
import { buildFileIOProgram } from "@/lib/file-io-program.mjs";
export { buildFileIOProgram } from "@/lib/file-io-program.mjs";
export type FileIORequest = { action: "snapshot" | "save"; path: string; root: string; revision?: string; content?: string };
/** Fixed filesystem program, isolated OS identity; stdin avoids command argument limits. */
export async function runFileIO(input: FileIORequest, identity: { uid?: number; gid?: number; home?: string }) {
  if (process.env.METIS_DEVELOPMENT_BROKER) {
    return callNativeDevelopmentBroker({ action: "file", uid: identity.uid, root: input.root, input });
  }
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(process.execPath, ["-"], { stdio: ["pipe","pipe","pipe"], uid: identity.uid, gid: identity.gid,
      cwd: input.root, env: { NODE_ENV: process.env.NODE_ENV || "production", LANG: process.env.LANG || "C.UTF-8", ...(identity.home ? { HOME: identity.home } : {}), ...(process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) } });
    let output = "", errors = "", settled = false;
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error("The file operation timed out.")); }, 30_000);
    child.on("error", error => finish(error));
    child.stdout.on("data", chunk => { output += chunk.toString(); if (output.length > 8_000_000) { child.kill(); finish(new Error("The file snapshot is too large.")); } });
    child.stderr.on("data", chunk => { errors = (errors + chunk.toString()).slice(-4000); });
    child.on("close", code => {
      if (code !== 0) return finish(new Error(errors || "The file operation failed."));
      try { finish(undefined, JSON.parse(output)); } catch { finish(new Error("The file server did not return a complete snapshot.")); }
    });
    child.stdin.on("error", error => finish(error));
    child.stdin.end(buildFileIOProgram(input));
  });
}

