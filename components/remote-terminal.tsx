"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "@xterm/xterm/css/xterm.css";

type RemoteTerminalProps = {
  cwd: string;
  sessionId?: string;
  onSessionIdChange: (sessionId: string) => void;
};

type RemoteClientOption = {
  id: string;
  name: string;
  status: string;
  os?: string;
  hostname?: string;
};

async function readRemoteResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(body) as T & { error?: string };
  } catch {
    const contentType = response.headers.get("content-type") || "unknown";
    const preview = body.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(
      `Remote terminal returned a non-JSON response (${response.status}, ${contentType}). ` +
      `${preview || "Check that the Metis server URL and authentication are correct."}`,
    );
  }
  if (!response.ok) throw new Error(data.error || `Remote terminal request failed (${response.status})`);
  return data;
}

export function RemoteTerminal({ cwd, sessionId, onSessionIdChange }: RemoteTerminalProps) {
  const terminalElementRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const requestedSessionIdRef = useRef(sessionId);
  const onSessionIdChangeRef = useRef(onSessionIdChange);
  requestedSessionIdRef.current = sessionId;
  onSessionIdChangeRef.current = onSessionIdChange;
  const cursorRef = useRef(0);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState("");
  const [clients, setClients] = useState<RemoteClientOption[]>([]);
  const [target, setTarget] = useState("server");

  useEffect(() => {
    let disposed = false;
    void fetch("/api/remote-clients", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { clients?: RemoteClientOption[] } | null) => {
        if (!disposed) setClients(data?.clients?.filter((client) => client.status !== "revoked") || []);
      })
      .catch(() => {});
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    let disposed = false;
    let pollTimer: number | null = null;
    let dataDisposable: { dispose: () => void } | null = null;
    let resizeDisposable: { dispose: () => void } | null = null;

    async function start() {
      if (!terminalElementRef.current) return;
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !terminalElementRef.current) return;

      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        convertEol: true,
        scrollback: 10_000,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        theme: {
          background: "#09090b",
          foreground: "#e4e4e7",
          cursor: "#e4e4e7",
          selectionBackground: "#3f3f46",
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalElementRef.current);
      fitAddon.fit();
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      const size = { cols: terminal.cols, rows: terminal.rows };
      const remoteClientId = target === "server" ? undefined : target;
      const requestedSessionId = requestedSessionIdRef.current;
      let response = requestedSessionId && !remoteClientId
        ? await fetch("/api/remote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "pty-attach", sessionId: requestedSessionId, cwd, ...size }),
          })
        : null;
      if (!response?.ok) {
        response = await fetch("/api/remote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pty-create", clientId: remoteClientId, cwd, ...size }),
        });
      }
      const data = await readRemoteResponse<{ sessionId?: string }>(response);
      if (!data.sessionId) throw new Error("Remote terminal did not return a session ID");
      sessionIdRef.current = data.sessionId;
      onSessionIdChangeRef.current(data.sessionId);
      setStarting(false);

      dataDisposable = terminal.onData((input) => {
        void fetch("/api/remote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pty-input", sessionId: data.sessionId, clientId: remoteClientId, data: input }),
        });
      });
      resizeDisposable = terminal.onResize(({ cols, rows }) => {
        void fetch("/api/remote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pty-resize", sessionId: data.sessionId, clientId: remoteClientId, cols, rows }),
        });
      });

      const poll = async () => {
        if (disposed) return;
        try {
          const pollResponse = await fetch(`/api/remote?sessionId=${encodeURIComponent(data.sessionId!)}&cursor=${cursorRef.current}${remoteClientId ? `&clientId=${encodeURIComponent(remoteClientId)}` : ""}`, { cache: "no-store" });
          if (pollResponse.ok) {
            const pollData = (await pollResponse.json()) as { chunks?: Array<{ id: number; data: string }>; cursor?: number };
            for (const chunk of pollData.chunks || []) terminal.write(chunk.data);
            if (typeof pollData.cursor === "number") cursorRef.current = pollData.cursor;
          }
        } catch {
          // The next poll will retry while the PTY is alive.
        }
        pollTimer = window.setTimeout(() => void poll(), 80);
      };
      void poll();
    }

    void start().catch((nextError) => {
      if (!disposed) {
        setStarting(false);
        setError(nextError instanceof Error ? nextError.message : "Could not start terminal");
      }
    });

    const resizeObserver = new ResizeObserver(() => fitAddonRef.current?.fit());
    if (terminalElementRef.current) resizeObserver.observe(terminalElementRef.current);
    return () => {
      disposed = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      resizeObserver.disconnect();
      dataDisposable?.dispose();
      resizeDisposable?.dispose();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      sessionIdRef.current = null;
    };
    }, [cwd, target]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            cursorRef.current = 0;
            onSessionIdChange("");
          }}
          aria-label="Terminal device"
          className="h-8 max-w-[15rem] rounded-md border bg-background px-2 text-xs"
        >
          <option value="server">Metis server</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name} · {client.os || "client"} · {client.status}
            </option>
          ))}
        </select>
        <Input value={cwd} readOnly aria-label="Remote working directory" className="h-8 min-w-0 flex-1 font-mono text-xs" />
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => terminalRef.current?.clear()} aria-label="Clear terminal">
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md bg-[#09090b] p-2">
        <div ref={terminalElementRef} className="h-full w-full" aria-label="Remote terminal" />
        {starting ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#09090b]/70">
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : null}
      </div>
      {error ? <p className="whitespace-pre-wrap text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
