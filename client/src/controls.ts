import type { ClientMessage, GamePlayer, GameState, ItemId } from "@ashen-crown/shared";
import type { World } from "./render/world";

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
export const RANGE = { loot: 2.8, ally: 5, melee: 2.5, ranged: 24 };

export interface Targets {
  enemy: GamePlayer | null;
  ally: GamePlayer | null;
  betray: GamePlayer | null;
  drop: GameState["loot"][number] | null;
  ranged: boolean;
  invite: { fromId: string } | null;
  canFlare: boolean;
}

export function findTargets(g: GameState, me: GamePlayer): Targets {
  const has = (i: ItemId) => me.inventory.some((s) => s.item === i);
  const ranged = (has("bow") || has("crossbow")) && me.inventory.some((s) => s.item === "arrows" && s.count > 0);
  const range = ranged ? RANGE.ranged : RANGE.melee;
  const others = g.players.filter((p) => p.alive && !p.escaped && p.id !== me.id).sort((a, b) => dist(a, me) - dist(b, me));
  const isAlly = (p: GamePlayer) => !!me.allianceId && p.allianceId === me.allianceId;
  const enemy = others.find((p) => !isAlly(p) && dist(p, me) <= range) ?? null;
  const betray = others.find((p) => isAlly(p) && dist(p, me) <= range) ?? null;
  const ally = others.find((p) => !isAlly(p) && dist(p, me) <= RANGE.ally) ?? null;
  const drop = g.loot.slice().sort((a, b) => dist(a, me) - dist(b, me)).find((d) => dist(d, me) <= RANGE.loot) ?? null;
  const invite = g.allianceInvites.find((i) => i.toId === me.id) ?? null;
  return { enemy, ally, betray, drop, ranged, invite, canFlare: g.phase === "helicopter" || (g.phase === "playing" && g.zone.collapsed.length >= 5 && has("flareGun")) };
}

export interface ControlHooks {
  inventory(): void;
  wheel(open: boolean): void;
  menu(): void;
  voice(down: boolean): void;
  action(kind: "strike" | "loot" | "ally" | "flare" | "accept" | "decline" | "drop-selected"): void;
  slot(i: number): void;
  help(): void;
}

/** Keyboard, mouse and touch input. Movement is relative to the orbit camera, as the server expects world-space vectors. */
export class Controls {
  readonly keys = new Set<string>();
  stick = { x: 0, y: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private timer = 0;
  private lastSent = "";
  private game: GameState | null = null;
  private me: GamePlayer | null = null;
  private touchHold = new Set<string>();
  enabled = true;

  constructor(private world: World, private send: (m: ClientMessage) => void, private hooks: ControlHooks) {
    addEventListener("keydown", this.down);
    addEventListener("keyup", this.up);
    addEventListener("blur", this.blur);
    const c = world.canvas;
    c.addEventListener("pointerdown", this.pDown);
    c.addEventListener("pointermove", this.pMove);
    c.addEventListener("pointerup", this.pUp);
    c.addEventListener("pointercancel", this.pUp);
    c.addEventListener("wheel", this.wheel, { passive: true });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    this.timer = window.setInterval(() => this.tick(), 50);
  }

  setState(g: GameState | null, me: GamePlayer | null) { this.game = g; this.me = me; }
  hold(name: string, on: boolean) { on ? this.touchHold.add(name) : this.touchHold.delete(name); }
  private isHeld(...ks: string[]) { return ks.some((k) => this.keys.has(k)) ; }

  private down = (e: KeyboardEvent) => {
    if (!this.enabled || (e.target as HTMLElement)?.tagName === "INPUT") return;
    const k = e.key.toLowerCase();
    if (e.repeat && k !== "arrowleft" && k !== "arrowright") { if (["w", "a", "s", "d", " ", "shift", "q"].includes(k)) e.preventDefault(); return; }
    this.keys.add(k);
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "tab", "shift", "q"].includes(k)) e.preventDefault();
    const alive = this.me?.alive;
    switch (k) {
      case "tab": case "i": this.hooks.inventory(); break;
      case "escape": this.hooks.menu(); break;
      case "c": this.hooks.wheel(true); break;
      case "v": this.hooks.voice(true); break;
      case "f": if (alive) this.hooks.action("strike"); break;
      case "e": if (alive) this.hooks.action("loot"); break;
      case "r": if (alive) this.hooks.action("ally"); break;
      case "x": case "z": if (alive) this.hooks.action("flare"); break;
      case "y": this.hooks.action("accept"); break;
      case "n": this.hooks.action("decline"); break;
      case "g": this.hooks.action("drop-selected"); break;
      case "h": case "?": this.hooks.help(); break;
      case "arrowright": if (!alive) this.cycle(1); break;
      case "arrowleft": if (!alive) this.cycle(-1); break;
      case " ": if (!alive) this.world.freeCam = !this.world.freeCam; break;
      default: if (/^[1-8]$/.test(k) && alive) this.hooks.slot(Number(k) - 1);
    }
  };
  private up = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    this.keys.delete(k);
    if (k === "c") this.hooks.wheel(false);
    if (k === "v") this.hooks.voice(false);
  };
  private blur = () => { this.keys.clear(); this.hooks.voice(false); };

  private cycle(d: number) {
    const alive = this.game?.players.filter((p) => p.alive && !p.escaped) ?? [];
    if (!alive.length) return;
    const i = Math.max(0, alive.findIndex((p) => p.id === this.world.spectateId));
    this.world.spectateId = alive[(i + d + alive.length) % alive.length]!.id;
    this.world.freeCam = false;
  }

  private pDown = (e: PointerEvent) => {
    this.world.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) this.pinch = this.span();
  };
  private pMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size === 2) {
      const s = this.span();
      this.world.zoom((this.pinch - s) * 0.08);
      this.pinch = s;
    } else if (this.world.mode === "game") this.world.orbit(dx * 0.006, dy * 0.004);
  };
  private pUp = (e: PointerEvent) => { this.pointers.delete(e.pointerId); };
  private span() { const [a, b] = [...this.pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; }
  private wheel = (e: WheelEvent) => { if (this.world.mode === "game") this.world.zoom(Math.sign(e.deltaY) * 2.2); };

  private tick() {
    const g = this.game, me = this.me;
    if (!g || !me || !this.enabled || (g.phase === "ended")) return;
    const held = (...k: string[]) => this.isHeld(...k);
    const x = this.stick.x + (held("d", "arrowright") ? 1 : 0) - (held("a", "arrowleft") ? 1 : 0);
    const z = this.stick.y + (held("s", "arrowdown") ? 1 : 0) - (held("w", "arrowup") ? 1 : 0);
    if (!me.alive) { this.world.panFree(x, z, 0.05); return; }
    const yaw = this.world.cameraYaw, c = Math.cos(yaw), s = Math.sin(yaw);
    const wx = x * c + z * s, wz = z * c - x * s;
    const sprint = held("shift") || this.touchHold.has("run"), block = held("q") || this.touchHold.has("block"), dodge = held(" ") || this.touchHold.has("dodge");
    this.world.setLocalPose({ block, sprint });
    const moving = Math.hypot(wx, wz) > 0.05;
    const input = { x: wx, z: wz, yaw: moving ? Math.atan2(wx, wz) : me.yaw, sprint, block, dodge };
    const key = `${wx.toFixed(2)}|${wz.toFixed(2)}|${sprint}|${block}|${dodge}`;
    // send on change, plus a keep-alive so the server never idles on a stale vector
    if (key !== this.lastSent || Date.now() % 400 < 50) { this.lastSent = key; this.send({ type: "game-input", input }); }
  }

  destroy() {
    clearInterval(this.timer);
    removeEventListener("keydown", this.down);
    removeEventListener("keyup", this.up);
    removeEventListener("blur", this.blur);
    const c = this.world.canvas;
    c.removeEventListener("pointerdown", this.pDown);
    c.removeEventListener("pointermove", this.pMove);
    c.removeEventListener("pointerup", this.pUp);
    c.removeEventListener("pointercancel", this.pUp);
    c.removeEventListener("wheel", this.wheel);
  }
}
