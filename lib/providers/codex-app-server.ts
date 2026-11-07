import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { codexCliExecutable } from "@/lib/providers/codex-cli";
import { providerProcessEnv } from "@/lib/providers/process-env";
import {createNativeRuntimeScope,spawnNative} from "./native-sandbox";

export type AppServerNotification = { method: string; params: Record<string, unknown> };

/** One owned stdio process. Never inherits app credentials or controls other processes. */
export class CodexAppServer {
  private child: ChildProcessWithoutNullStreams;
  private lines: Interface;
  private nextId = 0;
  private closed = false;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  onNotification?: (notification: AppServerNotification) => void;
  onExit?: (error: Error) => void;

  constructor(input: { home: string; cwd: string; mcpToken?: string;ownerId:string }) {
    this.child = spawnNative(codexCliExecutable(), ["app-server", "--stdio"], {
      cwd: input.cwd,
      env: providerProcessEnv({
        CODEX_HOME: input.home,
        ...(input.mcpToken ? { METIS_MCP_SESSION_TOKEN: input.mcpToken } : {}),
      }),
      stdio: ["pipe", "pipe", "pipe"],
    },[input.home],createNativeRuntimeScope(input.ownerId,input.cwd));
    this.lines = createInterface({ input: this.child.stdout });
    this.child.stderr.on("data", () => {});
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", () => {
      if (!this.closed) this.fail(new Error("The voice connection closed unexpectedly."));
    });
    this.lines.on("line", (line) => {
      try {
        const message = JSON.parse(line) as {
          id?: number | string; method?: string; params?: Record<string, unknown>;
          result?: unknown; error?: { message?: string };
        };
        if (message.method && message.id !== undefined) {
          // Native interactive tools must not bypass the canonical Metis gateway.
          this.child.stdin.write(JSON.stringify({
            id: message.id, error: { code: -32601, message: "Use the Metis MCP gateway for interactive tools." },
          }) + "\n");
        } else if (typeof message.id === "number") {
          const request = this.pending.get(message.id);
          if (!request) return;
          this.pending.delete(message.id);
          if (message.error) request.reject(new Error(message.error.message || "Codex voice request failed."));
          else request.resolve(message.result);
        } else if (message.method) {
          this.onNotification?.({ method: message.method, params: message.params || {} });
        }
      } catch { /* Ignore non-protocol diagnostics. */ }
    });
  }

  private fail(error: Error) {
    if (this.closed) return;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.onExit?.(error);
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}, timeout = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error("The voice connection is closed."));
    return new Promise<T>((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The voice connection timed out. Try again."));
      }, timeout);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value as T); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  async initialize() {
    await this.request("initialize", {
      clientInfo: { name: "metis-ai", title: "Metis AI", version: "1.0.0" },
      capabilities: { experimentalApi: true },
    });
    this.child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) request.reject(new Error("The voice connection is closed."));
    this.pending.clear();
    this.lines.close();
    const exited = new Promise<void>((resolve) => {
      if (!this.child.pid || this.child.exitCode !== null || this.child.signalCode !== null) { resolve(); return; }
      this.child.once("exit", () => resolve());
    });
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 2_000);
    await exited;
    clearTimeout(timer);
  }
}
