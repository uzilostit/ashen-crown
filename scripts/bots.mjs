#!/usr/bin/env node
// Load-test and smoke-test bots: node scripts/bots.mjs --url ws://localhost:3000/ws --count 14 [--code ABC123] [--duration 120] [--pass phrase]
import WebSocket from "ws";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]] : a), []));
const url = args.url ?? "ws://localhost:3000/ws";
const count = Number(args.count ?? 14);
const duration = Number(args.duration ?? 120);
const HEARTHS = ["marsh", "cinder", "pine", "salt", "frost", "orchard"];
const LOOKS = ["scout", "warden", "ranger", "duelist"];
const rnd = (n) => Math.floor(Math.random() * n);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const wedge = (x, z) => Math.floor((((Math.atan2(z, x) + Math.PI / 6) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 3)) % 6;

let cookie = "";
if (args.pass) {
  const http = url.replace(/^ws/, "http").replace(/\/ws$/, "");
  const r = await fetch(`${http}/api/gate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passphrase: args.pass }) });
  if (!r.ok) { console.error("passphrase rejected"); process.exit(1); }
  cookie = r.headers.get("set-cookie")?.split(";")[0] ?? "";
}

const stats = { msgs: 0, states: 0, maxGap: 0, errors: new Map(), phase: "", alive: 0, collapsed: 0, winner: null, joined: 0 };
const bots = [];
let roomCode = args.code ?? "";

class Bot {
  constructor(i) {
    this.i = i; this.id = ""; this.state = null; this.lastState = 0; this.wp = null; this.lastAct = 0; this.nextWp = 0;
    this.ws = new WebSocket(url, { headers: cookie ? { cookie } : {} });
    this.ws.on("message", (d) => this.onMessage(JSON.parse(d.toString())));
    this.ws.on("error", (e) => bump(`socket: ${e.message}`));
    this.ready = new Promise((r) => this.ws.on("open", r));
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  join(code) {
    const base = { name: `Bot${this.i}`, hearth: HEARTHS[this.i % 6], look: LOOKS[this.i % 4] };
    this.send(code ? { type: "join-room", code, ...base } : { type: "create-room", ...base });
  }
  onMessage(m) {
    stats.msgs++;
    if (m.type === "welcome") { this.id = m.playerId; this.room = m.room; stats.joined++; if (!roomCode) roomCode = m.room.code; this.send({ type: "set-ready", ready: true }); }
    else if (m.type === "room-update") this.room = m.room;
    else if (m.type === "error") bump(m.message);
    else if (m.type === "game-state") {
      const now = Date.now();
      if (this.i === 0) { if (this.lastState) stats.maxGap = Math.max(stats.maxGap, now - this.lastState); this.lastState = now; stats.states++; }
      this.state = m.state;
      if (this.i === 0) { stats.phase = m.state.phase; stats.alive = m.state.players.filter((p) => p.alive && !p.escaped).length; stats.collapsed = m.state.zone.collapsed.length; stats.winner = m.state.winnerId; }
    }
  }
  think() {
    const g = this.state, me = g?.players.find((p) => p.id === this.id);
    if (!g || !me || !me.alive || me.escaped || g.phase === "ended") return;
    const now = Date.now(), has = (item) => me.inventory.some((s) => s.item === item);
    const act = (action) => { if (now - this.lastAct > 260) { this.lastAct = now; this.send({ type: "game-action", action }); } };
    const useItem = (item) => { const slot = me.inventory.findIndex((s) => s.item === item); if (slot >= 0) act({ type: "use", slot }); };
    for (const inv of g.allianceInvites) if (inv.toId === this.id) this.send({ type: "game-action", action: { type: "ally-respond", fromId: inv.fromId, accept: Math.random() < 0.7 } });
    if (me.bleeding > 0 && has("bandage")) return useItem("bandage");
    if (me.brokenLeg && has("splint")) return useItem("splint");
    if (me.health < 55 && has("healthKit")) return useItem("healthKit");
    if (me.hunger < 35 && has("ration")) return useItem("ration");
    if (me.thirst < 35 && has("waterBottle")) return useItem("waterBottle");
    let target = null, attack = null;
    const hot = new Set(g.zone.collapsed); if (g.zone.warningZone !== null) hot.add(g.zone.warningZone);
    if (g.phase === "helicopter" && g.helicopter) { target = g.helicopter; if (dist(me, g.helicopter) < 6) act({ type: "board-helicopter" }); }
    else if (g.phase === "flare" && g.flare) target = g.flare;
    else if (g.zone.collapsed.length >= 5 && has("flareGun")) { target = { x: 0, z: 9 }; if (dist(me, target) < 4) act({ type: "flare" }); }
    else if (hot.has(wedge(me.x, me.z)) && Math.hypot(me.x, me.z) > 8) {
      const safe = [0, 1, 2, 3, 4, 5].filter((w) => !hot.has(w)); const w = safe[this.i % Math.max(1, safe.length)] ?? 0;
      target = { x: Math.cos((w * Math.PI) / 3) * 20, z: Math.sin((w * Math.PI) / 3) * 20 };
    } else {
      const enemy = g.players.filter((p) => p.alive && !p.escaped && p.id !== me.id && !(me.allianceId && p.allianceId === me.allianceId)).sort((a, b) => dist(a, me) - dist(b, me))[0];
      const loot = me.inventory.length < 7 ? g.loot.slice().sort((a, b) => dist(a, me) - dist(b, me))[0] : null;
      if (enemy && dist(enemy, me) < 3.2 && Math.random() < 0.02) act({ type: "ally-invite", targetId: enemy.id });
      if (loot && dist(loot, me) < 2.5) act({ type: "loot", dropId: loot.id });
      if (enemy && dist(enemy, me) < 2.4) act({ type: "attack", targetId: enemy.id });
      if (loot && dist(loot, me) < 26) target = loot;
      else if (enemy && dist(enemy, me) < 16 && me.health > 35) target = enemy;
      if (Math.random() < 0.004) act({ type: "emote", text: ["Danger", "Come here", "Need supplies"][rnd(3)] });
    }
    if (!target) { if (!this.wp || now > this.nextWp || dist(me, this.wp) < 2) { const a = Math.random() * 6.28, r = 6 + Math.random() * 32; this.wp = { x: Math.cos(a) * r, z: Math.sin(a) * r }; this.nextWp = now + 6000; } target = this.wp; }
    const dx = target.x - me.x, dz = target.z - me.z, len = Math.hypot(dx, dz) || 1;
    const stop = len < 1.4;
    this.send({ type: "game-input", input: { x: stop ? 0 : dx / len, z: stop ? 0 : dz / len, yaw: Math.atan2(dx, dz), sprint: len > 12 && me.stamina > 40, block: false, dodge: false } });
  }
}
function bump(msg) { stats.errors.set(msg, (stats.errors.get(msg) ?? 0) + 1); }

const first = new Bot(0);
await first.ready;
bots.push(first);
if (roomCode) first.join(roomCode); else first.join();
while (!roomCode) await new Promise((r) => setTimeout(r, 50));
for (let i = 1; i < count; i++) { const b = new Bot(i); await b.ready; bots.push(b); b.join(roomCode); await new Promise((r) => setTimeout(r, 40)); }
console.log(`room ${roomCode}: ${bots.length} bots connecting`);

const t0 = Date.now();
let started = false;
setInterval(() => bots.forEach((b) => b.think()), 200);
const log = setInterval(() => {
  const el = Math.round((Date.now() - t0) / 1000);
  if (!started && stats.joined >= count && first.room?.players.every((p) => p.ready || p.isHost)) { started = true; first.send({ type: "start-match" }); console.log("starting match"); }
  const errs = [...stats.errors].map(([k, v]) => `${k} x${v}`).join("; ");
  console.log(`[${el}s] phase=${stats.phase || first.room?.phase} alive=${stats.alive} collapsed=${stats.collapsed} states=${stats.states} maxGap=${stats.maxGap}ms msgs=${stats.msgs}${errs ? ` errors: ${errs}` : ""}`);
  stats.maxGap = 0;
  if (el >= duration || stats.phase === "ended") { console.log(`done. winner=${stats.winner ?? "none"} errors=${stats.errors.size}`); bots.forEach((b) => b.ws.close()); clearInterval(log); setTimeout(() => process.exit(stats.errors.size ? 1 : 0), 300); }
}, 5000);
