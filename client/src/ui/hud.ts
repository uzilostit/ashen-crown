import * as THREE from "three";
import type { ClientMessage, GamePlayer, GameState } from "@ashen-crown/shared";
import { biomeAt } from "@ashen-crown/shared";
import type { AudioEngine } from "../audio";
import { type Controls, findTargets, type Targets } from "../controls";
import { HEARTH_INFO, itemName } from "../content";
import { PALETTE, BIOMES, BIOME_NAMES, ARENA_R, WORLD_SCALE } from "../render/util";
import type { World } from "../render/world";
import type { Voice } from "../voice";
import { crestSvg } from "./crest";
import { fmtTime, h } from "./dom";
import { itemIcon } from "./studio";

export interface HudCtx {
  world: World; send(m: ClientMessage): void; audio: AudioEngine; voice: Voice; controls: Controls;
  selfId(): string; act(kind: "strike" | "loot" | "ally" | "flare"): void; fullscreen(): void; openInventory(): void; openEmote(): void; openMenu(): void; enableVoice(): void;
  selectedSlot(): number; selectSlot(i: number): void;
}

const BAR_COLORS: Record<string, string> = { Health: "#d9573f", Food: "#d6a24a", Water: "#4f9ac6", Stamina: "#6fae5f" };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Hud {
  readonly el: HTMLElement;
  private tags: HTMLElement;
  private card = h("div", { class: "paper hud-card" });
  private banner = h("div", { class: "paper dark zone-banner" });
  private compass = h("div", { class: "compass" });
  private mini = h("canvas", { width: 340, height: 340, "aria-label": "Arena map" }) as HTMLCanvasElement;
  private stats = h("div", { class: "paper dark stats" });
  private hotbar = h("div", { class: "paper hotbar" });
  private herald = h("div", { class: "herald" }, h("div", { class: "who" }, "The Herald"), h("div", { class: "line" }));
  private prompt = h("div", { class: "prompt" });
  private side = h("div", { class: "side-panel" });
  private bars = new Map<string, { row: HTMLElement; fill: HTMLElement; val: HTMLElement }>();
  private statusRow = h("div", { class: "status-row" });
  private invSig = "";
  private promptSig = "";
  private game: GameState | null = null;
  private targets: Targets | null = null;
  private queue: string[] = [];
  private heraldTimer = 0;
  private lastHerald = "";
  private tagEls = new Map<string, HTMLElement>();
  private bubbles = new Map<string, { el: HTMLElement; until: number }>();
  private compassEls: HTMLElement[] = [];
  private prevCounts = new Map<string, number>();
  private cardSig = "";
  private t = 0;
  private lowBeat = 0;

  constructor(parent: HTMLElement, private ctx: HudCtx) {
    this.tags = h("div", { class: "tags" });
    for (const label of ["Health", "Food", "Water", "Stamina"]) {
      const fill = h("div", { class: "fill" }), val = h("span", null, "100");
      const row = h("div", { class: "bar" }, h("span", null, label), h("div", { class: "track" }, fill), val);
      row.style.setProperty("--c", BAR_COLORS[label]!);
      this.bars.set(label, { row, fill, val });
      this.stats.append(row);
    }
    this.stats.append(this.statusRow);
    const toolbtns = h("div", { class: "toolbtns" },
      h("button", { class: "btn ghost small", onclick: () => ctx.openInventory() }, "Pack"),
      h("button", { class: "btn ghost small", onclick: () => ctx.openEmote() }, "Signal"),
      h("button", { class: "btn ghost small", onclick: () => ctx.openMenu() }, "Menu"),
      document.fullscreenEnabled ? h("button", { class: "btn ghost small", onclick: () => ctx.fullscreen() }, "Full") : null);
    const mini = h("div", { class: "paper dark mini" }, this.mini);
    this.el = h("div", { class: "screen hud" }, this.card, this.banner, this.compass, mini, toolbtns, this.side, this.stats, this.hotbar, this.herald, this.prompt, this.touch());
    parent.append(this.tags, this.el);
  }

  private touch() {
    const c = this.ctx;
    const stickKnob = h("i");
    const stick = h("div", { class: "stick" }, stickKnob);
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const len = Math.max(1, Math.hypot(dx, dy)), k = Math.min(1, len / 46);
      c.controls.stick = { x: (dx / len) * k, y: (dy / len) * k };
      stickKnob.style.transform = `translate(${c.controls.stick.x * 40}px,${c.controls.stick.y * 40}px)`;
    };
    stick.addEventListener("pointerdown", (e) => { e.preventDefault(); stick.setPointerCapture(e.pointerId); move(e); });
    stick.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "touch") move(e); });
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) stick.addEventListener(ev, () => { c.controls.stick = { x: 0, y: 0 }; stickKnob.style.transform = ""; });
    const press = (label: string, cls: string, down: () => void, up?: () => void) => {
      const b = h("button", { class: cls, "aria-label": label }, label);
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); down(); });
      if (up) for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, up);
      return b;
    };
    const act = (kind: "strike" | "loot" | "ally" | "flare") => () => c.act(kind);
    const acts = h("div", { class: "acts" },
      press("Strike", "hot", act("strike")), press("Loot", "", act("loot")), press("Pact", "", act("ally")),
      press("Dodge", "", () => c.controls.hold("dodge", true), () => c.controls.hold("dodge", false)),
      press("Block", "", () => c.controls.hold("block", true), () => c.controls.hold("block", false)),
      press("Run", "", () => c.controls.hold("run", true), () => c.controls.hold("run", false)),
      press("Flare", "", act("flare")), press("Voice", "", () => c.voice.status === "off" ? c.enableVoice() : c.voice.setPtt(true), () => c.voice.setPtt(false)));
    return h("div", { class: "touch" }, stick, acts);
  }

  herald_(text: string) { this.pushHerald(text); }
  pushHerald(text: string) {
    if (!text || text === this.lastHerald) return;
    this.lastHerald = text;
    this.queue.push(text);
    if (this.queue.length > 4) this.queue.shift();
    if (!this.heraldTimer) this.nextHerald();
  }
  private nextHerald() {
    const text = this.queue.shift();
    if (!text) { this.herald.classList.remove("on"); this.heraldTimer = 0; return; }
    (this.herald.querySelector(".line") as HTMLElement).textContent = text;
    this.herald.classList.add("on");
    this.heraldTimer = window.setTimeout(() => { this.heraldTimer = 0; this.nextHerald(); }, Math.max(3600, text.length * 55));
  }
  bubble(id: string, text: string) { this.bubbles.set(id, { el: this.bubbles.get(id)?.el ?? h("div", { class: "bubble" }), until: performance.now() + 4200 }); this.bubbles.get(id)!.el.textContent = text; }

  update(g: GameState) {
    this.game = g;
    const me = g.players.find((p) => p.id === this.ctx.selfId());
    if (!me) return;
    const now = Date.now();
    const alive = g.players.filter((p) => p.alive && !p.escaped).length;
    const info = HEARTH_INFO[me.hearth];

    const sig = `${me.name}|${me.hearth}|${me.alive}|${alive}|${g.players.length}|${me.patronPoints}`;
    if (sig !== this.cardSig) {
      this.cardSig = sig;
      const cr = crestSvg(info.crest);
      cr.style.setProperty("--c", info.color);
      this.card.replaceChildren(cr, h("div", null, h("b", null, me.name), h("small", null, me.alive ? `Alive ${alive}/${g.players.length}` : `Spectating · Patron ${me.patronPoints}`)));
    }

    // zone banner
    const z = g.zone;
    this.banner.classList.toggle("warn", z.warningZone !== null);
    let label = "", num = "";
    if (g.phase === "ended") { label = "The Winnowing is over"; num = "—"; }
    else if (g.phase === "helicopter" && g.helicopter) { label = "Helicopter leaves in"; num = fmtTime(g.helicopter.leavesAt - now); }
    else if (g.phase === "flare" && g.flare) { label = "Helicopter arrives in"; num = fmtTime(g.flare.helicopterAt - now); }
    else if (z.warningZone !== null && z.collapseAt) { label = `${BIOME_NAMES[z.warningZone]} falls in`; num = fmtTime(z.collapseAt - now); }
    else if (z.collapsed.length >= 5) { label = "Find the flare gun at Base Camp"; num = "ESCAPE"; }
    else { label = "Next collapse"; num = fmtTime(z.nextCollapseAt - now); }
    this.banner.replaceChildren(h("small", null, label), h("span", { class: "num" }, num));

    // stats
    const set = (k: string, v: number) => {
      const b = this.bars.get(k)!;
      b.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, v / 100))})`;
      b.val.textContent = String(Math.ceil(v));
      b.row.classList.toggle("low", v < 25);
    };
    set("Health", me.health); set("Food", me.hunger); set("Water", me.thirst); set("Stamina", me.stamina);
    const chips: string[] = [];
    if (me.bleeding > 0) chips.push("Bleeding: bandage it");
    if (me.brokenLeg) chips.push("Broken leg: splint it");
    if (me.hunger <= 0) chips.push("Starving");
    if (me.thirst <= 0) chips.push("Parched");
    const r = Math.hypot(me.x, me.z);
    if (me.alive && z.collapsed.includes(biomeAt(me.x, me.z)) && r > 7) chips.push("Collapsing zone: run");
    if (me.alive && r > z.safeRadius) chips.push("Past the edge");
    const csig = chips.join("|");
    if (csig !== this.statusRow.dataset.sig) { this.statusRow.dataset.sig = csig; this.statusRow.replaceChildren(...chips.map((c) => h("span", { class: "status" }, c))); }
    this.ctx.audio && this.heartbeat(me);

    this.hotbarUpdate(me);
    this.sidePanel(me, g);
    this.targets = me.alive ? findTargets(g, me) : null;
    this.ctx.world.setTarget(this.targets?.enemy?.id ?? null);
    this.promptUpdate(me);
  }

  private heartbeat(me: GamePlayer) {
    const low = me.alive && me.health < 28;
    document.querySelector(".dmg")?.classList.toggle("low", low);
    if (low && performance.now() - this.lowBeat > 1250) { this.lowBeat = performance.now(); this.ctx.audio.heartbeat(); }
  }

  private hotbarUpdate(me: GamePlayer) {
    const sig = JSON.stringify(me.inventory) + this.ctx.selectedSlot();
    if (sig === this.invSig) return;
    this.invSig = sig;
    const slots: HTMLElement[] = [];
    for (let i = 0; i < 8; i++) {
      const s = me.inventory[i];
      const b = h("button", { class: `slot ${s ? "" : "empty"} ${s?.item === "dagger" ? "locked" : ""}`, title: s ? itemName(s.item) : "Empty", "aria-label": s ? `${itemName(s.item)} ${s.count}` : "Empty slot", onclick: () => { if (s) this.ctx.send({ type: "game-action", action: { type: "use", slot: i } }); } },
        h("span", { class: "key" }, i + 1), s ? h("img", { src: itemIcon(s.item), alt: "" }) : null, s && s.count > 1 ? h("span", { class: "cnt" }, s.count) : null);
      if (s) {
        const prev = this.prevCounts.get(s.item) ?? 0;
        if (s.count > prev && this.prevCounts.size) b.classList.add("flash");
      }
      slots.push(b);
    }
    this.prevCounts = new Map(me.inventory.map((s) => [s.item, s.count]));
    this.hotbar.replaceChildren(...slots);
  }

  private sidePanel(me: GamePlayer, g: GameState) {
    const parts: HTMLElement[] = [];
    if (me.allianceId) {
      const mates = g.players.filter((p) => p.allianceId === me.allianceId && p.id !== me.id);
      parts.push(h("div", { class: "paper" }, h("h3", null, "Your pact"),
        ...mates.map((p) => h("div", { class: "ally" }, h("span", null, p.name), h("div", { class: "track" }, (() => { const f = h("div", { class: "fill" }); f.style.width = `${p.alive ? p.health : 0}%`; return f; })()))),
        h("button", { class: "btn small", onclick: () => this.ctx.send({ type: "game-action", action: { type: "leave-alliance" } }) }, "Leave pact")));
    }
    const v = this.ctx.voice;
    const talking = [...v.speaking].map((id) => g.players.find((p) => p.id === id)?.name).filter(Boolean);
    const status = { off: "Voice off", asking: "Asking for mic…", ready: v.mode === "open" ? "Open mic" : "Hold V to talk", denied: "Mic blocked: use Signal", error: "Voice link failed" }[v.status];
    parts.push(h("div", { class: "paper" },
      h("div", { class: "voice-row" }, h("span", { class: `dot ${v.speakingSelf ? "talk" : ""}` }), h("span", null, status),
        v.status === "off" ? h("button", { class: "btn small", onclick: () => this.ctx.enableVoice() }, "Enable") : null,
        v.status === "ready" ? h("button", { class: "btn small", onclick: () => v.setMode(v.mode === "ptt" ? "open" : "ptt") }, v.mode === "ptt" ? "Open mic" : "Push to talk") : null),
      ...talking.map((n) => h("div", { class: "voice-row" }, h("span", { class: "dot talk" }), h("span", null, n)))));
    const sig = parts.map((p) => p.outerHTML).join("");
    if (sig !== this.side.dataset.sig) { this.side.dataset.sig = sig; this.side.replaceChildren(...parts); }
  }

  private promptUpdate(me: GamePlayer) {
    const t = this.targets, g = this.game!;
    const rows: [string, string, boolean][] = [];
    if (!me.alive) {
      rows.push(["←→", "Switch view", false], ["Space", this.ctx.world.freeCam ? "Follow player" : "Free camera", false]);
      if (me.patronPoints > 0) rows.push(["", `Patron ${me.patronPoints}: send a parachute gift from Signal`, false]);
    } else if (t) {
      if (t.invite) { const who = g.players.find((p) => p.id === t.invite!.fromId)?.name ?? "Someone"; rows.push(["Y", `Accept ${who}'s pact`, true], ["N", "Decline", false]); }
      if (t.enemy) rows.push(["F", `Strike ${t.enemy.name}`, true]);
      else if (t.betray) rows.push(["F", `Betray ${t.betray.name}`, false]);
      if (t.drop) rows.push(["E", `Take ${itemName(t.drop.item)}`, true]);
      if (t.ally && !t.invite) rows.push(["R", `Offer pact to ${t.ally.name}`, false]);
      if (t.canFlare) rows.push(["X", g.phase === "helicopter" ? "Board helicopter" : "Fire flare", true]);
    }
    const sig = rows.map((r) => r.join("")).join("|");
    if (sig === this.promptSig) return;
    this.promptSig = sig;
    this.prompt.replaceChildren(...rows.map(([k, label, hot]) => h("div", { class: `paper dark row ${hot ? "hot" : ""}` }, k ? h("span", { class: "kbd" }, k) : null, h("span", null, label))));
  }

  /** Per render frame: floating name tags, compass tape and the map. */
  frame(dt: number) {
    this.t += dt;
    const g = this.game;
    if (!g) return;
    const me = g.players.find((p) => p.id === this.ctx.selfId());
    if (!me) return;
    this.drawTags(me, g);
    this.drawCompass(me, g);
    this.drawMap(me, g);
  }

  private drawTags(me: GamePlayer, g: GameState) {
    const seen = new Set<string>();
    const speaking = this.ctx.voice.speaking;
    const v = new THREE.Vector3();
    for (const l of this.ctx.world.labels()) {
      const p = g.players.find((x) => x.id === l.id);
      if (!p || !p.alive || p.escaped) continue;
      const show = l.self ? false : l.ally || !me.alive || l.distance < 42;
      const b = this.bubbles.get(l.id);
      if (!show && !b) continue;
      const s = this.ctx.world.project(l.pos, v);
      if (!s.visible) continue;
      let el = this.tagEls.get(l.id);
      if (!el) { el = h("div", { class: "tag" }); this.tagEls.set(l.id, el); this.tags.append(el); }
      el.textContent = l.name;
      el.className = `tag ${l.ally ? "ally" : ""} ${speaking.has(l.id) ? "talk" : ""}`;
      el.style.setProperty("--c", HEARTH_INFO[l.hearth].color);
      el.style.opacity = l.ally || !me.alive ? "1" : String(Math.max(0, Math.min(1, (42 - l.distance) / 14)));
      el.style.left = `${s.x}px`; el.style.top = `${s.y}px`;
      seen.add(l.id);
      if (b) {
        if (performance.now() > b.until) { b.el.remove(); this.bubbles.delete(l.id); }
        else { if (!b.el.isConnected) this.tags.append(b.el); b.el.style.left = `${s.x}px`; b.el.style.top = `${s.y}px`; }
      }
    }
    for (const [id, el] of this.tagEls) if (!seen.has(id)) { el.remove(); this.tagEls.delete(id); }
  }

  private drawCompass(me: GamePlayer, g: GameState) {
    const heading = -this.ctx.world.cameraYaw;
    const markers: { a: number; text: string; cls: string; color?: string }[] = [];
    [["N", 0], ["E", Math.PI / 2], ["S", Math.PI], ["W", -Math.PI / 2]].forEach(([t, a]) => markers.push({ a: a as number, text: t as string, cls: "card" }));
    const bearing = (x: number, z: number) => Math.atan2(x - me.x, -(z - me.z));
    markers.push({ a: bearing(0, 0), text: "◆", cls: "", color: "#e9c46a" });
    if (g.flare) markers.push({ a: bearing(g.flare.x, g.flare.z), text: "✦", cls: "", color: "#ff6a50" });
    if (g.zone.warningZone !== null) { const w = (g.zone.warningZone * Math.PI) / 3; markers.push({ a: bearing(Math.cos(w) * 30, Math.sin(w) * 30), text: "▲", cls: "", color: "#ff6a50" }); }
    for (const p of g.players) if (p.id !== me.id && p.alive && me.allianceId && p.allianceId === me.allianceId) markers.push({ a: bearing(p.x, p.z), text: "●", cls: "", color: "#77d9a0" });
    while (this.compassEls.length < markers.length) { const i = h("i"); this.compass.append(i); this.compassEls.push(i); }
    const w = this.compass.clientWidth || 300, half = 1.3;
    this.compassEls.forEach((el, i) => {
      const m = markers[i];
      if (!m) { el.style.display = "none"; return; }
      const d = wrap(m.a - heading);
      if (Math.abs(d) > half) { el.style.display = "none"; return; }
      el.style.display = "";
      el.textContent = m.text; el.className = m.cls; el.style.color = m.color ?? "";
      el.style.left = `${w / 2 + (d / half) * (w / 2)}px`;
    });
  }

  private drawMap(me: GamePlayer, g: GameState) {
    const cv = this.mini, ctx = cv.getContext("2d")!, S = cv.width, c = S / 2, k = (c - 8) / (ARENA_R / WORLD_SCALE);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, c - 2, 0, 7); ctx.clip();
    ctx.fillStyle = "#20292f"; ctx.fillRect(0, 0, S, S);
    const R = (ARENA_R / WORLD_SCALE) * k;
    for (let i = 0; i < 6; i++) {
      const a0 = (i * Math.PI) / 3 - Math.PI / 6, a1 = a0 + Math.PI / 3;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(a0) * R, c + Math.sin(a0) * R); ctx.lineTo(c + Math.cos(a1) * R, c + Math.sin(a1) * R); ctx.closePath();
      const dead = g.zone.collapsed.includes(i), warn = g.zone.warningZone === i;
      ctx.fillStyle = dead ? "#171b1f" : PALETTE[BIOMES[i]!].low;
      ctx.globalAlpha = dead ? 1 : 0.85; ctx.fill(); ctx.globalAlpha = 1;
      if (dead) { ctx.save(); ctx.clip(); ctx.strokeStyle = "rgba(210,72,58,.55)"; ctx.lineWidth = 2; for (let x = -S; x < S * 2; x += 14) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - S, S); ctx.stroke(); } ctx.restore(); }
      if (warn) { ctx.fillStyle = `rgba(230,50,35,${0.35 + Math.sin(this.t * 6) * 0.25})`; ctx.fill(); }
      ctx.strokeStyle = "rgba(237,228,207,.35)"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.strokeStyle = "#e9c46a"; ctx.lineWidth = 3;
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3 - Math.PI / 6; i ? ctx.lineTo(c + Math.cos(a) * R, c + Math.sin(a) * R) : ctx.moveTo(c + Math.cos(a) * R, c + Math.sin(a) * R); } ctx.closePath(); ctx.stroke();
    ctx.fillStyle = "#ede4cf"; ctx.beginPath(); ctx.arc(c, c, 6.8 * k, 0, 7); ctx.fill();
    ctx.fillStyle = "#4a4b52"; ctx.beginPath(); ctx.arc(c, c + 8.6 * k, 2.4 * k, 0, 7); ctx.fill();
    ctx.fillStyle = "#f3ead4"; ctx.font = `700 ${2.4 * k}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("H", c, c + 8.7 * k);
    if (g.flare) { const p = (this.t * 2) % 1; ctx.strokeStyle = `rgba(255,90,70,${1 - p})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(c + g.flare.x * k, c + g.flare.z * k, 6 + p * 22, 0, 7); ctx.stroke(); ctx.fillStyle = "#ff5a46"; ctx.beginPath(); ctx.arc(c + g.flare.x * k, c + g.flare.z * k, 5, 0, 7); ctx.fill(); }
    for (const p of g.players) {
      if (!p.alive || p.escaped) continue;
      const self = p.id === me.id, ally = !!me.allianceId && p.allianceId === me.allianceId;
      if (!self && !ally && me.alive) continue;
      const x = c + p.x * k, y = c + p.z * k;
      if (self) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(Math.sin(p.yaw) , Math.cos(p.yaw)) * -1 + Math.PI / 2 * 0 + Math.PI);
        ctx.fillStyle = "#fff4c9"; ctx.strokeStyle = "#1b2329"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 9); ctx.lineTo(0, 4); ctx.lineTo(-9, 9); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
      } else { ctx.fillStyle = ally ? "#77d9a0" : HEARTH_INFO[p.hearth].color; ctx.strokeStyle = "#1b2329"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke(); ctx.fill(); }
    }
    ctx.restore();
  }

  destroy() {
    clearTimeout(this.heraldTimer);
    this.el.remove(); this.tags.remove();
  }
}
