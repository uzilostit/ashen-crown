import type { ClientMessage, ServerMessage } from "@ashen-crown/shared";

export type NetStatus = "idle" | "connecting" | "online" | "reconnecting";

/** WebSocket wrapper that reconnects and re-joins with the saved token. */
export class Net {
  status: NetStatus = "idle";
  onMessage: (m: ServerMessage) => void = () => {};
  onStatus: (s: NetStatus) => void = () => {};
  /** Returns the message that re-joins the current room, or null when not in one. */
  rejoin: () => ClientMessage | null = () => null;
  private socket: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private retry = 0;
  private want = false;
  private timer = 0;

  private url() {
    const host = import.meta.env.DEV ? `${location.hostname}:3000` : location.host;
    return `${location.protocol === "https:" ? "wss" : "ws"}://${host}/ws`;
  }
  private set(s: NetStatus) { this.status = s; this.onStatus(s); }

  open() {
    this.want = true;
    if (this.socket && this.socket.readyState <= 1) return;
    this.set(this.retry ? "reconnecting" : "connecting");
    const ws = new WebSocket(this.url());
    this.socket = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set("online");
      const again = this.rejoin();
      if (again) ws.send(JSON.stringify(again));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (e) => { try { this.onMessage(JSON.parse(e.data) as ServerMessage); } catch { /* ignore malformed frames */ } };
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      if (!this.want) return this.set("idle");
      this.retry++;
      this.set("reconnecting");
      this.timer = window.setTimeout(() => this.open(), Math.min(4000, 500 * this.retry));
    };
  }
  send(m: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(m));
    else { this.queue.push(m); this.open(); }
  }
  close() {
    this.want = false;
    clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
    this.set("idle");
  }
}
