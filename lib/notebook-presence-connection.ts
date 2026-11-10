import {NOTEBOOK_PRESENCE_URL} from "./notebook-presence";

type Options = {
  ownerId: string;
  url: string;
  onConnected: () => void;
  onDisconnected: (code: number) => void;
  onPacket: (packet: Record<string, unknown>) => void;
};
/** One account-bound presence socket, including handshake and reconnect ownership. */
export class NotebookPresenceConnection {
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private handshake: ReturnType<typeof setTimeout> | undefined;
  private delay = 500;
  private disposed = false;
  private ready = false;
  private authBlocked = false;
  constructor(private options: Options) {}
  get connected() { return this.ready; }
  start() {
    if (this.disposed || this.socket) return;
    let ws: WebSocket;
    try { ws = new WebSocket(this.options.url + NOTEBOOK_PRESENCE_URL); }
    catch { this.disconnected(1006); return; }
    this.socket = ws;
    const current = () => !this.disposed && this.socket === ws;
    const deadline = (ms: number) => {
      clearTimeout(this.handshake);
      this.handshake = setTimeout(() => {
        if (!current()) return;
        this.socket = null;
        ws.close();
        this.disconnected(1006);
      }, ms);
    };
    // Server snapshots arrive every five seconds, including idle notebooks.
    // Neither an HTTP upgrade nor a half-open socket counts as live presence.
    deadline(10000);
    ws.onmessage = event => {
      if (!current() || typeof event.data !== "string" || event.data.length > 256 * 1024) return;
      let packet: Record<string, unknown>;
      try { packet = JSON.parse(event.data); } catch { return; }
      if (!packet || typeof packet !== "object" || Array.isArray(packet)) return;
      if (!this.ready) {
        const self = packet.self as {id?: string} | undefined;
        if (packet.type !== "presence" || self?.id !== this.options.ownerId || !Array.isArray(packet.peers)) return;
        clearTimeout(this.handshake);
        this.ready = true;
        this.delay = 500;
        this.options.onConnected();
      }
      deadline(20000);
      this.options.onPacket(packet);
    };
    ws.onerror = () => {}; // The close event or handshake deadline owns recovery.
    ws.onclose = event => {
      if (!current()) return;
      this.socket = null;
      this.disconnected(event.code);
    };
  }
  private disconnected(code: number) {
    clearTimeout(this.handshake);
    this.ready = false;
    this.authBlocked = code === 4403;
    this.options.onDisconnected(code);
    // Authentication needs the existing explicit Retry after signing in.
    if (this.disposed || code === 4403) return;
    const delay = code === 4429 ? Math.max(10000, this.delay) : this.delay;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => { this.retry = undefined; this.start(); }, delay);
    this.delay = Math.min(delay * 2, 10000);
  }
  send(value: unknown) {
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }
  wake() {
    if (this.disposed || this.ready || this.authBlocked) return;
    clearTimeout(this.retry);
    clearTimeout(this.handshake);
    const old = this.socket;
    this.socket = null;
    old?.close();
    this.start();
  }
  destroy() {
    this.disposed = true;
    this.ready = false;
    clearTimeout(this.retry);
    clearTimeout(this.handshake);
    const old = this.socket;
    this.socket = null;
    old?.close();
  }
}
