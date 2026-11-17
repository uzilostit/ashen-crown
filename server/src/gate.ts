import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const parseCookies = (value = "") => Object.fromEntries(value.split(";").map((v) => v.trim().split(/=(.*)/s, 2)).filter((v) => v.length === 2));

/**
 * Optional shared passphrase for the whole site. When SITE_PASSPHRASE is unset the gate is open.
 * A correct passphrase earns an HttpOnly cookie that the WebSocket upgrade checks, so strangers who find
 * the URL cannot create or join rooms.
 */
export class Gate {
  private attempts = new Map<string, number[]>();
  constructor(private readonly passphrase = process.env.SITE_PASSPHRASE ?? "") {}

  get required() { return this.passphrase.length > 0; }
  private token() { return createHmac("sha256", this.passphrase).update("ashen-crown-gate-v1").digest("hex"); }

  unlocked(req: IncomingMessage): boolean {
    if (!this.required) return true;
    const given = parseCookies(req.headers.cookie).ac_gate ?? "";
    const want = this.token();
    return given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
  }

  /** Returns the Set-Cookie header on success, or null. Throttled to 8 tries a minute per address. */
  attempt(ip: string, supplied: string): { cookie: string } | { error: string } {
    const now = Date.now();
    const recent = (this.attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= 8) return { error: "Too many tries. Wait a minute." };
    recent.push(now);
    this.attempts.set(ip, recent);
    const a = createHmac("sha256", "cmp").update(supplied).digest(), b = createHmac("sha256", "cmp").update(this.passphrase).digest();
    if (!timingSafeEqual(a, b)) return { error: "That isn't the passphrase." };
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return { cookie: `ac_gate=${this.token()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}` };
  }
}

export const clientIp = (req: IncomingMessage) => {
  if (process.env.TRUST_PROXY === "1") {
    const xff = req.headers["x-forwarded-for"];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
};
