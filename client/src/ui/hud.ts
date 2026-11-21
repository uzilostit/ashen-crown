import * as THREE from "three";
import type { ClientMessage, GamePlayer, GameState } from "@ashen-crown/shared";
import { biomeAt } from "@ashen-crown/shared";
import type { AudioEngine } from "../audio";
import { type Controls, findTargets, type Targets } from "../controls";
import { HEARTH_INFO, itemName } from "../content";
import { bestWeapon } from "../render/items";
import { ARENA_R, BIOMES, BIOME_NAMES, PALETTE, WORLD_SCALE } from "../render/util";
import type { World } from "../render/world";
import type { Voice } from "../voice";
import { fmtTime, h } from "./dom";
import { icon } from "./icons";
import { itemIcon } from "./studio";

type Act = "strike" | "loot" | "ally" | "flare" | "accept" | "decline";
export interface HudCtx {
  world: World; send(m: ClientMessage): void; audio: AudioEngine; voice: Voice; controls: Controls;
  selfId(): string; act(kind: Act): void; fullscreen(): void; openInventory(): void; openEmote(): void; openMenu(): void; enableVoice(): void;
  selectedSlot(): number; selectSlot(i: number): void;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const DEG = Math.PI / 180;

/** In-match HUD laid out like a mobile battle-royale: squad top-left, compass and map up top, vitals and slots at the bottom, thumb buttons on the right. */
export class Hud {
  readonly el: HTMLElement;
  private tags: HTMLElement;
  private score = h("div", { class: "glass h-score" });
  private squad = h("div", { class: "h-squad" });
  private feed = h("div", { class: "h-feed" });
  private compass = h("div", { class: "glass h-compass" });
  private zone = h("div", { class: "glass h-zone" });
  private mini = h("canvas", { width: 340, height: 340, "aria-label": "Arena map" }) as HTMLCanvasElement;
  private place = h("div", { class: "h-place" });
  private loot = h("div", { class: "h-loot" });
  private prompt = h("div", { class: "h-prompt" });
  private herald = h("div", { class: "h-herald" }, h("b", null, "The Herald"), h("span"));
  private hpCells: HTMLElement[] = [];
  private hpNum = h("b", null, "100");
  private minis = new Map<string, { fill: HTMLElement; row: HTMLElement }>();
  private status = h("div", { class: "h-status" });
  private weapon = h("div", { class: "glass h-weapon" });
  private slots = h("div", { class: "h-slots" });
  private micBtn: HTMLElement;
  private game: GameState | null = null;
  private targets: Targets | null = null;
  private queue: string[] = [];
  private heraldTimer = 0;
  private lastHerald = "";
  private sig: Record<string, string> = {};
  private tagEls = new Map<string, HTMLElement>();
  private bubbles = new Map<string, { el: HTMLElement; until: number }>();
  private compassEls: HTMLElement[] = [];
  private prevCounts = new Map<string, number>();
  private t = 0;
  private lowBeat = 0;
  private lootRows = new Map<string, HTMLElement>();
  private actBtns = new Map<string, HTMLElement>();

  constructor(parent: HTMLElement, private ctx: HudCtx) {
    this.tags = h("div", { class: "tags" });
    for (let i = 0; i < 20; i++) this.hpCells.push(h("i"));
    const vitals = h("div", { class: "h-vitals" }, h("div", { class: "glass h-hp" }, h("span", { class: "lbl" }, "HP"), h("div", { class: "cells" }, ...this.hpCells), this.hpNum));
    const meter = (key: string, ic: string, color: string) => {
      const fill = h("div", { class: "fill" });
      const row = h("div", { class: "m", title: key }, icon(ic, 14), h("div", { class: "track" }, fill));
      row.style.setProperty("--c", color);
      this.minis.set(key, { fill, row });
      return row;
    };
    const meters = h("div", { class: "glass h-meters" }, meter("Food", "food", "#e5a94a"), meter("Water", "drop", "#5ab0e6"), meter("Stamina", "bolt", "#7ed05f"));

    this.micBtn = this.round("mic", "Voice", () => (ctx.voice.status === "off" ? ctx.enableVoice() : ctx.voice.setMode(ctx.voice.mode === "ptt" ? "open" : "ptt")));
    const icons = h("div", { class: "h-icons" }, this.micBtn, this.round("bubble", "Signals", () => ctx.openEmote()), this.round("pack", "Pack", () => ctx.openInventory()),
      document.fullscreenEnabled ? this.round("fullscreen", "Fullscreen", () => ctx.fullscreen()) : null, this.round("gear", "Menu", () => ctx.openMenu()));
    const map = h("div", { class: "glass h-map" }, this.mini, this.place);

    this.el = h("div", { class: "screen hud" },
      h("div", { class: "h-topleft" }, this.score, this.squad, this.feed),
      h("div", { class: "h-topcenter" }, this.compass, this.zone),
      h("div", { class: "h-topright" }, icons, map),
      this.loot, this.prompt, this.herald,
      h("div", { class: "h-bottom" }, this.status, h("div", { class: "h-vrow" }, this.weapon, vitals, meters), this.slots),
      this.stick(), this.actions());
    parent.append(this.tags, this.el);
  }

  private round(ic: string, label: string, fn: () => void) {
    const b = h("button", { class: "glass round", "aria-label": label, title: label, onclick: fn }, icon(ic, 20));
    return b;
  }

  private stick() {
    const c = this.ctx;
    const knob = h("i");
    const ring = h("div", { class: "ring" }, knob);
    const move = (e: PointerEvent) => {
      const r = ring.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const len = Math.max(1, Math.hypot(dx, dy)), k = Math.min(1, len / (r.width * 0.36));
      c.controls.stick = { x: (dx / len) * k, y: (dy / len) * k };
      knob.style.transform = `translate(${c.controls.stick.x * r.width * 0.3}px,${c.controls.stick.y * r.width * 0.3}px)`;
    };
    ring.addEventListener("pointerdown", (e) => { e.preventDefault(); ring.setPointerCapture(e.pointerId); move(e); });
    ring.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "touch") move(e); });
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) ring.addEventListener(ev, () => { c.controls.stick = { x: 0, y: 0 }; knob.style.transform = ""; });
    const run = this.btn("run", "Run", "run", "Shift", () => c.controls.hold("run", true), () => c.controls.hold("run", false));
    return h("div", { class: "h-left touch" }, ring, run);
  }

  private btn(name: string, label: string, ic: string, hint: string, down: () => void, up?: () => void, cls = "") {
    const b = h("button", { class: `act ${name} ${cls}`, "aria-label": label }, icon(ic, name === "strike" ? 34 : 24), h("small", { class: "lbl" }, label), h("small", { class: "hint" }, hint));
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.classList.add("down"); down(); });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => { if (b.classList.contains("down")) { b.classList.remove("down"); up?.(); } });
    this.actBtns.set(name, b);
    return b;
  }

  private actions() {
    const c = this.ctx;
    const tap = (k: Act) => () => c.act(k);
    return h("div", { class: "h-actions" },
      this.btn("flare", "Flare", "flare", "X", tap("flare")),
      this.btn("pact", "Pact", "pact", "R", tap("ally")),
      this.btn("loot", "Loot", "hand", "E", tap("loot")),
      this.btn("dodge", "Dodge", "dash", "Space", () => c.controls.hold("dodge", true), () => c.controls.hold("dodge", false)),
      this.btn("block", "Block", "shield", "Q", () => c.controls.hold("block", true), () => c.controls.hold("block", false)),
      this.btn("strike", "Strike", "sword", "F", tap("strike")));
  }

  // ---------- Herald ----------
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
    (this.herald.querySelector("span") as HTMLElement).textContent = text;
    this.herald.classList.add("on");
    this.heraldTimer = window.setTimeout(() => { this.heraldTimer = 0; this.nextHerald(); }, Math.max(3600, text.length * 55));
  }
  bubble(id: string, text: string) {
    const b = this.bubbles.get(id) ?? { el: h("div", { class: "bubble" }), until: 0 };
    b.el.textContent = text;
    b.until = performance.now() + 4200;
    this.bubbles.set(id, b);
  }

  private setIf(key: string, value: string, apply: () => void) {
    if (this.sig[key] === value) return;
    this.sig[key] = value;
    apply();
  }

  // ---------- per-snapshot update ----------
  update(g: GameState) {
    this.game = g;
    const me = g.players.find((p) => p.id === this.ctx.selfId());
    if (!me) return;
    const now = Date.now();
    const alive = g.players.filter((p) => p.alive && !p.escaped).length;

    this.setIf("score", `${alive}|${g.players.length}|${g.zone.collapsed.length}|${me.alive}`, () =>
      this.score.replaceChildren(h("div", null, h("small", null, me.alive ? "Alive" : "Spectating"), h("b", null, alive)), h("div", null, h("small", null, "Zones"), h("b", null, `${g.zone.collapsed.length}/5`))));

    // squad: you and your pact members
    const mates = g.players.filter((p) => p.id === me.id || (!!me.allianceId && p.allianceId === me.allianceId));
    this.setIf("squad", mates.map((p) => `${p.id}:${Math.ceil(p.health)}:${p.alive}`).join("|"), () =>
      this.squad.replaceChildren(...mates.map((p, i) => {
        const fill = h("div", { class: "fill" });
        fill.style.width = `${p.alive ? p.health : 0}%`;
        const row = h("div", { class: `glass sq ${p.id === me.id ? "me" : ""}` }, h("em", null, i + 1), h("span", null, p.name), h("div", { class: "track" }, fill));
        row.style.setProperty("--c", HEARTH_INFO[p.hearth].color);
        return row;
      })));

    // zone pill
    const z = g.zone;
    let label = "", num = "";
    if (g.phase === "ended") { label = "The Winnowing is over"; num = ""; }
    else if (g.phase === "helicopter" && g.helicopter) { label = "Helicopter leaves"; num = fmtTime(g.helicopter.leavesAt - now); }
    else if (g.phase === "flare" && g.flare) { label = "Helicopter arrives"; num = fmtTime(g.flare.helicopterAt - now); }
    else if (z.warningZone !== null && z.collapseAt) { label = `${BIOME_NAMES[z.warningZone]} falls`; num = fmtTime(z.collapseAt - now); }
    else if (z.collapsed.length >= 5) { label = "Find the flare gun"; num = ""; }
    else { label = "Next collapse"; num = fmtTime(z.nextCollapseAt - now); }
    this.zone.classList.toggle("warn", z.warningZone !== null);
    this.zone.replaceChildren(h("small", null, label), ...(num ? [h("b", null, num)] : []));

    // vitals
    const cells = Math.ceil(me.health / 5);
    this.hpCells.forEach((c, i) => c.classList.toggle("on", i < cells));
    this.hpNum.textContent = String(Math.ceil(me.health));
    const hp = (this.hpNum.parentElement as HTMLElement);
    hp.dataset.level = me.health > 60 ? "ok" : me.health > 30 ? "mid" : "low";
    const set = (k: string, v: number) => { const m = this.minis.get(k)!; m.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, v / 100))})`; m.row.classList.toggle("low", v < 25); };
    set("Food", me.hunger); set("Water", me.thirst); set("Stamina", me.stamina);
    const chips: string[] = [];
    if (me.bleeding > 0) chips.push("Bleeding: bandage");
    if (me.brokenLeg) chips.push("Broken leg: splint");
    if (me.hunger <= 0) chips.push("Starving");
    if (me.thirst <= 0) chips.push("Parched");
    const r = Math.hypot(me.x, me.z);
    if (me.alive && z.collapsed.includes(biomeAt(me.x, me.z)) && r > 7) chips.push("Collapsing zone: run");
    if (me.alive && r > z.safeRadius) chips.push("Past the edge");
    this.setIf("status", chips.join("|"), () => this.status.replaceChildren(...chips.map((c) => h("span", null, c))));
    this.heartbeat(me);

    this.weaponUpdate(me);
    this.slotsUpdate(me);
    this.lootUpdate(me, g);
    this.targets = me.alive ? findTargets(g, me) : null;
    this.ctx.world.setTarget(this.targets?.enemy?.id ?? null);
    this.promptUpdate(me);
    this.feedUpdate(g);
    this.micState();
    const wedge = BIOME_NAMES[biomeAt(me.x, me.z)] ?? "";
    this.setIf("place", `${wedge}|${Math.hypot(me.x, me.z) < 7 ? "c" : ""}`, () => (this.place.textContent = Math.hypot(me.x, me.z) < 7.2 ? "Base Camp" : wedge));
    // contextual thumb buttons
    const t = this.targets;
    this.actBtns.get("flare")?.classList.toggle("show", !!t?.canFlare);
    this.actBtns.get("pact")?.classList.toggle("show", !!t?.ally || !!t?.invite);
    this.actBtns.get("loot")?.classList.toggle("ready", !!t?.drop);
    this.actBtns.get("strike")?.classList.toggle("ready", !!(t?.enemy));
    const fl = this.actBtns.get("flare")?.querySelector(".lbl");
    if (fl) fl.textContent = g.phase === "helicopter" ? "Board" : "Flare";
  }

  private heartbeat(me: GamePlayer) {
    const low = me.alive && me.health < 28;
    document.querySelector(".dmg")?.classList.toggle("low", low);
    if (low && performance.now() - this.lowBeat > 1250) { this.lowBeat = performance.now(); this.ctx.audio.heartbeat(); }
  }

  private micState() {
    const v = this.ctx.voice;
    this.micBtn.classList.toggle("on", v.status === "ready");
    this.micBtn.classList.toggle("bad", v.status === "denied" || v.status === "error");
    this.micBtn.title = { off: "Enable voice", asking: "Asking for mic…", ready: v.mode === "open" ? "Open mic (click for push-to-talk)" : "Push-to-talk: hold V", denied: "Mic blocked", error: "Voice link failed" }[v.status];
  }

  private weaponUpdate(me: GamePlayer) {
    const w = bestWeapon(me.inventory);
    const ranged = w === "bow" || w === "crossbow";
    const ammo = me.inventory.find((s) => s.item === "arrows")?.count ?? 0;
    this.setIf("weapon", `${w}|${ammo}`, () => this.weapon.replaceChildren(h("img", { src: itemIcon(w), alt: "" }), h("div", null, h("b", null, itemName(w)), h("small", null, ranged ? `Arrows ${ammo}` : "Melee"))));
  }

  private slotsUpdate(me: GamePlayer) {
    const sig = JSON.stringify(me.inventory) + this.ctx.selectedSlot();
    this.setIf("slots", sig, () => {
      const out: HTMLElement[] = [];
      for (let i = 0; i < 8; i++) {
        const s = me.inventory[i];
        const b = h("button", { class: `slot ${s ? "" : "empty"}`, title: s ? itemName(s.item) : "Empty", "aria-label": s ? `${itemName(s.item)} ${s.count}` : "Empty slot", onclick: () => { if (s) this.ctx.send({ type: "game-action", action: { type: "use", slot: i } }); } },
          h("span", { class: "key" }, i + 1), s ? h("img", { src: itemIcon(s.item), alt: "" }) : null, s && s.count > 1 ? h("span", { class: "cnt" }, s.count) : null);
        if (s && s.count > (this.prevCounts.get(s.item) ?? 0) && this.prevCounts.size) b.classList.add("flash");
        out.push(b);
      }
      this.prevCounts = new Map(me.inventory.map((s) => [s.item, s.count]));
      this.slots.replaceChildren(...out);
    });
  }

  /** Nearby drops as a tappable list, like opening a crate. */
  private lootUpdate(me: GamePlayer, g: GameState) {
    const near = me.alive ? g.loot.map((d) => ({ d, dist: Math.hypot(d.x - me.x, d.z - me.z) })).filter((x) => x.dist < 5.5).sort((a, b) => a.dist - b.dist).slice(0, 6) : [];
    this.setIf("loot", near.map((x) => x.d.id).join(","), () => {
      this.lootRows.clear();
      this.loot.classList.toggle("on", near.length > 0);
      this.loot.replaceChildren(...(near.length ? [h("div", { class: "head" }, h("span", null, "Nearby"), h("small", null, `${near.length} item${near.length > 1 ? "s" : ""}`))] : []),
        ...near.map(({ d }, i) => {
          const row = h("button", { class: `row ${i === 0 ? "first" : ""}`, onclick: () => this.ctx.send({ type: "game-action", action: { type: "loot", dropId: d.id } }) }, h("img", { src: itemIcon(d.item), alt: "" }), h("span", null, itemName(d.item)), h("em", null, d.count > 1 ? `x${d.count}` : ""), h("div", { class: "prog" }));
          this.lootRows.set(d.id, row);
          return row;
        }));
    });
    const ch = me.looting;
    for (const [id, row] of this.lootRows) row.style.setProperty("--p", ch?.dropId === id ? String(Math.max(0, Math.min(1, 1 - (ch.endsAt - Date.now()) / 2000))) : "0");
  }

  private promptUpdate(me: GamePlayer) {
    const t = this.targets, g = this.game!;
    const rows: { k: string; label: string; hot: boolean; act?: Act }[] = [];
    if (!me.alive) {
      rows.push({ k: "← →", label: "Switch view", hot: false }, { k: "Space", label: this.ctx.world.freeCam ? "Follow player" : "Free camera", hot: false });
      if (me.patronPoints > 0) rows.push({ k: "", label: `Patron ${me.patronPoints}: send a gift from Signals`, hot: false });
    } else if (t) {
      if (t.invite) { const who = g.players.find((p) => p.id === t.invite!.fromId)?.name ?? "Someone"; rows.push({ k: "Y", label: `Accept ${who}'s pact`, hot: true, act: "accept" }, { k: "N", label: "Decline", hot: false, act: "decline" }); }
      if (t.enemy) rows.push({ k: "F", label: `Strike ${t.enemy.name}`, hot: true, act: "strike" });
      else if (t.betray) rows.push({ k: "F", label: `Betray ${t.betray.name}`, hot: false, act: "strike" });
      if (t.ally && !t.invite) rows.push({ k: "R", label: `Offer pact to ${t.ally.name}`, hot: false, act: "ally" });
    }
    this.setIf("prompt", rows.map((r) => r.k + r.label).join("|"), () =>
      this.prompt.replaceChildren(...rows.map((r) => {
        const el = h(r.act ? "button" : "div", { class: `glass chip ${r.hot ? "hot" : ""}`, onclick: r.act ? () => this.ctx.act(r.act!) : undefined }, r.k ? h("span", { class: "kbd" }, r.k) : null, h("span", null, r.label));
        return el;
      })));
  }

  private feedUpdate(g: GameState) {
    const now = Date.now();
    const items = (g.feed ?? []).filter((f) => f.kind !== "emote" && now - f.at < 14_000).slice(-4);
    this.setIf("feed", items.map((f) => f.id).join(","), () => this.feed.replaceChildren(...items.map((f) => h("div", { class: "line" }, f.text))));
  }

  // ---------- per-frame ----------
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

  /** Compass tape with degree readouts every 15 degrees, plus markers for the camp, flare, falling zone and pact members. */
  private drawCompass(me: GamePlayer, g: GameState) {
    const heading = -this.ctx.world.cameraYaw;
    const items: { a: number; text: string; cls: string; color?: string }[] = [];
    for (let d = 0; d < 360; d += 15) {
      const card = d % 90 === 0;
      items.push({ a: d * DEG, text: card ? "NESW"[d / 90]! : String(d), cls: card ? "card" : "deg" });
    }
    const bearing = (x: number, z: number) => Math.atan2(x - me.x, -(z - me.z));
    const mk = (a: number, text: string, color: string) => items.push({ a, text, cls: "mk", color });
    mk(bearing(0, 0), "◆", "#f0c030");
    if (g.flare) mk(bearing(g.flare.x, g.flare.z), "✦", "#ff6a50");
    if (g.zone.warningZone !== null) { const w = g.zone.warningZone * (Math.PI / 3); mk(bearing(Math.cos(w) * 30, Math.sin(w) * 30), "▲", "#ff6a50"); }
    for (const p of g.players) if (p.id !== me.id && p.alive && me.allianceId && p.allianceId === me.allianceId) mk(bearing(p.x, p.z), "●", "#77d9a0");
    while (this.compassEls.length < items.length) { const i = h("i"); this.compass.append(i); this.compassEls.push(i); }
    const w = this.compass.clientWidth || 340, half = 70 * DEG;
    this.compassEls.forEach((el, i) => {
      const m = items[i];
      if (!m) { el.style.display = "none"; return; }
      const d = wrap(m.a - heading);
      if (Math.abs(d) > half) { el.style.display = "none"; return; }
      el.style.display = "";
      el.textContent = m.text; el.className = m.cls; el.style.color = m.color ?? "";
      el.style.left = `${w / 2 + (d / half) * (w / 2)}px`;
    });
  }

  private drawMap(me: GamePlayer, g: GameState) {
    const cv = this.mini, ctx = cv.getContext("2d")!, S = cv.width, c = S / 2, k = (c - 10) / (ARENA_R / WORLD_SCALE);
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "rgba(10,14,18,.78)"; ctx.fillRect(0, 0, S, S);
    const R = (ARENA_R / WORLD_SCALE) * k;
    for (let i = 0; i < 6; i++) {
      const a0 = (i * Math.PI) / 3 - Math.PI / 6, a1 = a0 + Math.PI / 3;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(a0) * R, c + Math.sin(a0) * R); ctx.lineTo(c + Math.cos(a1) * R, c + Math.sin(a1) * R); ctx.closePath();
      const dead = g.zone.collapsed.includes(i), warn = g.zone.warningZone === i;
      ctx.fillStyle = dead ? "#171b1f" : PALETTE[BIOMES[i]!].low;
      ctx.globalAlpha = dead ? 1 : 0.85; ctx.fill(); ctx.globalAlpha = 1;
      if (dead) { ctx.save(); ctx.clip(); ctx.strokeStyle = "rgba(210,72,58,.55)"; ctx.lineWidth = 2; for (let x = -S; x < S * 2; x += 14) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - S, S); ctx.stroke(); } ctx.restore(); }
      if (warn) { ctx.fillStyle = `rgba(230,50,35,${0.35 + Math.sin(this.t * 6) * 0.25})`; ctx.fill(); }
      ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.strokeStyle = "#f0c030"; ctx.lineWidth = 3;
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
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI - p.yaw);
        ctx.fillStyle = "#fff4c9"; ctx.strokeStyle = "#1b2329"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 9); ctx.lineTo(0, 4); ctx.lineTo(-9, 9); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
      } else { ctx.fillStyle = ally ? "#77d9a0" : HEARTH_INFO[p.hearth].color; ctx.strokeStyle = "#1b2329"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke(); ctx.fill(); }
    }
  }

  destroy() {
    clearTimeout(this.heraldTimer);
    this.el.remove();
    this.tags.remove();
  }
}
