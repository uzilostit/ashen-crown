import "./style.css";
import { HEARTHS, type ClientMessage, type FeedEntry, type FigureLook, type GamePlayer, type GameState, type Hearth, type RoomView, type ServerMessage } from "@ashen-crown/shared";
import { audio, type MusicPhase } from "./audio";
import { Controls, findTargets, type ControlHooks } from "./controls";
import { HEARTH_INFO, LOOKS, itemName } from "./content";
import { Net } from "./net";
import { QualityController } from "./render/quality";
import { BIOME_NAMES } from "./render/util";
import { World } from "./render/world";
import { fmtTime, h } from "./ui/dom";
import { Hud } from "./ui/hud";
import { mountHome, type Identity } from "./ui/home";
import { mountLobby } from "./ui/lobby";
import { openEmoteWheel, openInventory, openMenu, showResult } from "./ui/menus";
import { Voice } from "./voice";

const app = document.getElementById("app")!;
const SESSION = "ashen-crown-session", IDENT = "ashen-crown-identity";
const load = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) ?? "null") as T; } catch { return null; } };

/* ---------- state ---------- */
let identity: Identity = load<Identity>(IDENT) ?? { name: "", hearth: HEARTHS[Math.floor(Math.random() * HEARTHS.length)]!, look: LOOKS[Math.floor(Math.random() * LOOKS.length)]!.id };
let session = load<{ code: string; token: string }>(SESSION);
let room: RoomView | null = null;
let game: GameState | null = null;
let selfId = "";
let screen: "home" | "lobby" | "countdown" | "hud" | "resuming" = session ? "resuming" : "home";
let lastFeedId = 0, lastMessage = "", lastPhase = "", lastWarning: number | null = null, lastCollapsed = 0, lastAlive = 0, lastCount = -1;
let dmgUntil = 0, betrayArm: { id: string; until: number } | null = null;
const selected = { slot: 0 };
const params = new URLSearchParams(location.search);
const prefill = (params.get("room") ?? "").toUpperCase();
if (matchMedia("(pointer: coarse)").matches || params.get("touch") === "1") document.documentElement.classList.add("touch-ui");
// Tablets that report a fine pointer (desktop-mode browsers, keyboard cases) switch to touch controls on the first real touch.
addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") document.documentElement.classList.add("touch-ui"); }, { capture: true });

/* ---------- shell ---------- */
const quality = new QualityController();
const ui = h("div", { id: "ui" });
const toasts = h("div", { class: "toasts", "aria-live": "polite" });
const conn = h("div", { class: "conn hidden" }, "Reconnecting…");
const letterbox = h("div", { class: "letterbox" });
const cutBanner = h("div", { class: "cut-banner", "aria-live": "assertive" }, h("b"), h("span"));
const dmg = h("div", { class: "dmg" });
const channel = h("div", { class: "paper dark channel hidden" }, h("span", null, "Taking"), h("div", { class: "track" }, h("div", { class: "fill" })));
const loading = h("div", { class: "loading" }, "Folding paper…");
app.append(ui, toasts, conn, letterbox, cutBanner, dmg, channel, loading);
const world = new World(app, quality);
world.setMode("menu", 0.17);
setTimeout(() => loading.classList.add("done"), 900);
setTimeout(() => loading.remove(), 1700);

const net = new Net();
const send = (m: ClientMessage) => net.send(m);
const voice = new Voice(send);
net.onStatus = (s) => conn.classList.toggle("hidden", s === "online" || s === "idle" || !session);
net.rejoin = () => (session ? { type: "join-room", code: session.code, name: identity.name || "Kindled", hearth: identity.hearth, look: identity.look, reconnectToken: session.token } : null);

const toast = (text: string) => { const t = h("div", { class: "toast" }, text); toasts.append(t); setTimeout(() => t.remove(), 3500); };
const me = (): GamePlayer | undefined => game?.players.find((p) => p.id === selfId);
const isHost = () => !!room?.players.find((p) => p.id === selfId)?.isHost;
const leave = () => { localStorage.removeItem(SESSION); location.href = location.pathname; };

/* ---------- controls, overlays ---------- */
let inventory: ReturnType<typeof openInventory> | null = null;
let wheel: ReturnType<typeof openEmoteWheel> | null = null;
let menu: { close(): void } | null = null;
const menuCtx = { send, audio, quality, leave, fullscreen: () => toggleFullscreen() };

const toggleInventory = () => {
  if (screen !== "hud") return;
  if (inventory) { inventory.close(); inventory = null; return; }
  inventory = openInventory(app, menuCtx, me, selected, () => { inventory?.close(); inventory = null; });
};
const toggleMenu = (help = false) => {
  if (menu) { menu.close(); menu = null; return; }
  menu = openMenu(app, menuCtx, () => { menu = null; }, help);
};
let wheelHeld = false;
function showWheel(held = true) {
  if (wheel) return;
  wheelHeld = held;
  const spectator = !me()?.alive;
  wheel = openEmoteWheel(app, menuCtx, spectator, (text) => { send({ type: "game-action", action: spectator ? { type: "spectator-chat", text } : { type: "emote", text } }); audio.emote(); wheel?.close(); }, () => { wheel = null; });
}
const toggleFullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {}); };
const startVoice = () => { if (game) void voice.enable(selfId, game.players); };

const hooks: ControlHooks = {
  inventory: toggleInventory,
  menu: () => { if (inventory) { inventory.close(); inventory = null; } else toggleMenu(); },
  help: () => toggleMenu(true),
  voice: (down) => { if (down && voice.status === "off") startVoice(); else voice.setPtt(down); },
  slot: (i) => { const s = me()?.inventory[i]; if (s) { selected.slot = i; send({ type: "game-action", action: { type: "use", slot: i } }); } },
  wheel: (open) => {
    if (open && !wheel && screen === "hud") showWheel();
    else if (!open && wheel && wheelHeld) { wheel.pick(); wheel.close(); }
  },
  action: (kind) => {
    const g = game, p = me();
    if (!g || !p) return;
    const t = findTargets(g, p);
    if (kind === "strike") {
      if (t.enemy) { send({ type: "game-action", action: { type: "attack", targetId: t.enemy.id } }); world.strikeSelf(); audio.swing(); }
      else if (t.betray) {
        if (betrayArm?.id === t.betray.id && betrayArm.until > Date.now()) { send({ type: "game-action", action: { type: "attack", targetId: t.betray.id } }); world.strikeSelf(); betrayArm = null; }
        else { betrayArm = { id: t.betray.id, until: Date.now() + 2200 }; toast(`Press F again to betray ${t.betray.name}`); }
      }
    } else if (kind === "loot" && t.drop) { send({ type: "game-action", action: { type: "loot", dropId: t.drop.id } }); audio.rustle(0.3); }
    else if (kind === "ally" && t.ally) { send({ type: "game-action", action: { type: "ally-invite", targetId: t.ally.id } }); toast(`Pact offered to ${t.ally.name}`); }
    else if (kind === "accept" && t.invite) send({ type: "game-action", action: { type: "ally-respond", fromId: t.invite.fromId, accept: true } });
    else if (kind === "decline" && t.invite) send({ type: "game-action", action: { type: "ally-respond", fromId: t.invite.fromId, accept: false } });
    else if (kind === "flare" && t.canFlare) send({ type: "game-action", action: g.phase === "helicopter" ? { type: "board-helicopter" } : { type: "flare" } });
    else if (kind === "drop-selected") { const s = p.inventory[selected.slot]; if (s && s.item !== "dagger") send({ type: "game-action", action: { type: "drop", slot: selected.slot } }); }
  },
};
const controls = new Controls(world, send, hooks);
controls.enabled = false;
world.cutAllowed = () => { const p = me(); if (!p || !game) return true; const near = game.players.some((o) => o.id !== p.id && o.alive && !o.escaped && Math.hypot(o.x - p.x, o.z - p.z) < 12 && !(p.allianceId && o.allianceId === p.allianceId)); return !(near || Date.now() < dmgUntil); };
world.cutListener = (e) => {
  if (e.kind === "end") { letterbox.classList.remove("on"); cutBanner.classList.remove("on"); return; }
  const z = game?.zone;
  (cutBanner.querySelector("b") as HTMLElement).textContent = BIOME_NAMES[e.wedge] ?? "";
  (cutBanner.querySelector("span") as HTMLElement).textContent = z?.warningZone === e.wedge ? "falls in 60 seconds" : "has fallen";
  cutBanner.classList.add("on");
  if (e.cinematic) letterbox.classList.add("on");
  else setTimeout(() => cutBanner.classList.remove("on"), 3600);
};
world.listeners.push((e) => {
  if (e.type === "attack" && e.near) { e.self ? null : audio.swing(); setTimeout(() => audio.hit(false), 140); }
  else if (e.type === "hurt") { audio.hit(true); dmgUntil = Date.now() + 3000; }
  else if (e.type === "death" && e.near) audio.tear(0.7);
  else if (e.type === "pickup") audio.pickup();
  else if (e.type === "step") audio.step();
});
for (const ev of ["pointerdown", "keydown"] as const) addEventListener(ev, () => audio.start(), { once: true });
addEventListener("pointerdown", (e) => { if ((e.target as HTMLElement).closest?.("button")) audio.click(); }, true);

/* ---------- screens ---------- */
let home: ReturnType<typeof mountHome> | null = null;
let lobby: ReturnType<typeof mountLobby> | null = null;
let hud: Hud | null = null;
let countdownEl: HTMLElement | null = null;
let resultEl: HTMLElement | null = null;
let identityEl: HTMLElement | null = null;

function unmount() {
  home?.destroy(); home = null; lobby?.destroy(); lobby = null; hud?.destroy(); hud = null; countdownEl?.remove(); countdownEl = null;
  resultEl?.remove(); resultEl = null; inventory?.close(); inventory = null; wheel?.close(); wheel = null; menu?.close(); menu = null;
  controls.enabled = false;
  channel.classList.add("hidden");
}

function route() {
  const want: typeof screen = !room ? (session && screen === "resuming" ? "resuming" : "home") : room.phase === "lobby" ? "lobby" : room.phase === "starting" || (room.phase === "match" && !game) ? "countdown" : "hud";
  if (want === screen && (screen !== "home" || home) && (screen !== "lobby" || lobby) && (screen !== "hud" || hud) && (screen !== "countdown" || countdownEl)) return syncMode();
  unmount();
  screen = want;
  if (want === "home") {
    world.setMode("menu", 0.17);
    home = mountHome(ui, {
      identity, prefillCode: prefill, sfx: () => {},
      save: (i) => { identity = i; localStorage.setItem(IDENT, JSON.stringify(i)); },
      create: (i) => { session = null; send({ type: "create-room", name: i.name, hearth: i.hearth, look: i.look }); },
      join: (code, i) => { session = null; send({ type: "join-room", code, name: i.name, hearth: i.hearth, look: i.look }); },
    });
    net.open();
  } else if (want === "lobby") {
    world.setMode("lobby");
    world.lobbyFocus = null;
    lobby = mountLobby(ui, { send, selfId: () => selfId, sfx: () => audio.click(), leave,
      copy: (text, what) => { void navigator.clipboard?.writeText(text).then(() => toast(`${what} copied`), () => toast("Copy failed")); },
      edit: openIdentity });
    if (room) lobby.update(room);
  } else if (want === "countdown") {
    world.setMode("lobby");
    world.lobbyFocus = selfId;
    countdownEl = h("div", { class: "screen countdown" }, h("div", null, h("div", { class: "small" }, "Stay on your pedestal"), h("div", { class: "big" }, "15")));
    ui.append(countdownEl);
  } else if (want === "hud") {
    world.setMode("game");
    world.lobbyFocus = null;
    hud = new Hud(ui, { world, send, audio, voice, controls, selfId: () => selfId, openInventory: toggleInventory, act: (k) => hooks.action(k), fullscreen: toggleFullscreen, openEmote: () => (wheel ? wheel.close() : showWheel(false)), openMenu: () => toggleMenu(), enableVoice: startVoice, selectedSlot: () => selected.slot, selectSlot: (i) => { selected.slot = i; } });
    world.onFrame = (dt) => { hud?.frame(dt); const p = me(); if (game) voice.update(p, game.players); updateChannel(p); };
    controls.enabled = true;
  }
  syncMode();
}

function syncMode() {
  const phase: MusicPhase = screen === "home" || screen === "resuming" ? "menu" : screen === "lobby" ? "lobby" : screen === "countdown" ? "countdown"
    : game?.phase === "ended" ? "end" : game && (game.phase === "flare" || game.phase === "helicopter" || game.zone.collapsed.length >= 5) ? "escape"
    : game && (game.zone.warningZone !== null || (me()?.alive && (me()?.health ?? 100) < 30)) ? "danger" : world.tod > 0.52 && world.tod < 0.94 ? "night" : "day";
  audio.setPhase(phase);
}

function updateChannel(p: GamePlayer | undefined) {
  const l = p?.looting;
  channel.classList.toggle("hidden", !l);
  if (l) {
    const k = Math.max(0, Math.min(1, 1 - (l.endsAt - Date.now()) / 2000));
    (channel.querySelector(".fill") as HTMLElement).style.transform = `scaleX(${k})`;
    const d = game?.loot.find((x) => x.id === l.dropId);
    (channel.firstChild as HTMLElement).textContent = d ? `Taking ${itemName(d.item)}` : "Taking";
  }
}

function openIdentity() {
  if (identityEl) return;
  const draft = { ...identity };
  const name = h("input", { type: "text", maxlength: 18, value: identity.name, "aria-label": "Name" }) as HTMLInputElement;
  const pick = <T extends string>(label: string, values: readonly T[], get: () => T, set: (v: T) => void, text: (v: T) => string) => {
    const seg = h("div", { class: "seg", style: { flexWrap: "wrap" } });
    const draw = () => seg.replaceChildren(...values.map((v) => h("button", { "aria-pressed": String(get() === v), onclick: () => { set(v); draw(); } }, text(v))));
    draw();
    return h("div", { class: "field" }, h("span", { class: "lbl" }, label), seg);
  };
  const body = h("div", { class: "paper menu", role: "dialog", "aria-label": "Change look" }, h("h2", null, "Change look"), h("div", { class: "field" }, h("label", null, "Name"), name),
    pick("Hearth", HEARTHS, () => draft.hearth, (v) => (draft.hearth = v as Hearth), (v) => HEARTH_INFO[v as Hearth].name),
    pick("Paper figure", LOOKS.map((l) => l.id), () => draft.look, (v) => (draft.look = v as FigureLook), (v) => LOOKS.find((l) => l.id === v)!.name),
    h("div", { style: { display: "flex", gap: ".6rem" } },
      h("button", { class: "btn primary", onclick: () => { identity = { ...draft, name: name.value.trim() || identity.name }; localStorage.setItem(IDENT, JSON.stringify(identity)); send({ type: "set-profile", name: identity.name, hearth: identity.hearth, look: identity.look }); close(); } }, "Save"),
      h("button", { class: "btn", onclick: () => close() }, "Cancel")));
  const o = h("div", { class: "overlay", onclick: (e: Event) => { if (e.target === o) close(); } }, body);
  const close = () => { o.remove(); identityEl = null; };
  identityEl = o;
  app.append(o);
}

/* ---------- server messages ---------- */
function handleFeed(g: GameState) {
  const feed: FeedEntry[] = g.feed ?? (g.message && g.message !== lastMessage ? [{ id: lastFeedId + 1, at: Date.now(), kind: "herald", text: g.message }] : []);
  lastMessage = g.message;
  for (const f of feed) {
    if (f.id <= lastFeedId) continue;
    lastFeedId = f.id;
    if (f.kind === "herald") {
      hud?.pushHerald(f.text);
      if (/cannon|night falls|fallen/i.test(f.text)) audio.cannon();
    } else if (f.kind === "emote" || f.kind === "chat") {
      const a = g.players.find((p) => p.id === f.actorId), mine = me();
      const heard = !!a && !!mine && (a.id === mine.id || (!!mine.allianceId && mine.allianceId === a.allianceId) || !mine.alive || Math.hypot(a.x - mine.x, a.z - mine.z) < 30);
      if (heard && a) { hud?.bubble(a.id, f.text.replace(/^[^:]+:\s*/, "").replace(/^.*\(spectator\):\s*/, "")); audio.emote(); }
    } else toast(f.text);
  }
}

function onGame(g: GameState) {
  const first = !game;
  game = g;
  world.setGame(g, selfId, room?.players.length ?? g.players.length);
  controls.setState(g, me() ?? null);
  if (first || screen !== "hud") route();
  hud?.update(g);
  if (first) { lastFeedId = (g.feed ?? []).reduce((m, f) => Math.max(m, f.id), 0); lastMessage = g.message; lastCollapsed = g.zone.collapsed.length; lastWarning = g.zone.warningZone; lastAlive = g.players.filter((p) => p.alive).length; hud?.pushHerald(g.message); audio.gong(); }
  else handleFeed(g);
  if (g.zone.warningZone !== null && g.zone.warningZone !== lastWarning) audio.siren(3.2);
  if (g.zone.collapsed.length > lastCollapsed) audio.collapse();
  lastWarning = g.zone.warningZone; lastCollapsed = g.zone.collapsed.length;
  const alive = g.players.filter((p) => p.alive && !p.escaped).length;
  if (alive < lastAlive) audio.cannon();
  lastAlive = alive;
  if (g.phase !== lastPhase) {
    if (g.phase === "flare") audio.flare();
    audio.helicopter(g.phase === "flare" || g.phase === "helicopter", 1);
    if (g.phase === "ended" && !resultEl) { resultEl = showResult(app, g, selfId, isHost(), { playAgain: () => send({ type: "play-again" }), leave }); audio.gong(); }
    lastPhase = g.phase;
  }
  syncMode();
}

net.onMessage = (m: ServerMessage) => {
  switch (m.type) {
    case "welcome":
      selfId = m.playerId; room = m.room; session = { code: m.room.code, token: m.reconnectToken };
      localStorage.setItem(SESSION, JSON.stringify(session));
      history.replaceState(null, "", location.pathname);
      screen = "resuming"; route(); roomChanged();
      break;
    case "room-update": room = m.room; roomChanged(); break;
    case "game-state": onGame(m.state); break;
    case "notice": toast(m.message); break;
    case "voice-signal": void voice.signal(m.fromId, m.signal); break;
    case "error":
      if (screen === "resuming" || /no room|no longer belongs|expired/i.test(m.message)) { localStorage.removeItem(SESSION); session = null; room = null; screen = "home"; route(); }
      if (home) home.error(m.message); else toast(m.message);
      break;
  }
};

function roomChanged() {
  if (!room) return;
  if (room.phase === "lobby") {
    if (game) { game = null; lastFeedId = 0; lastPhase = ""; resultEl?.remove(); resultEl = null; voice.reset(); audio.helicopter(false); world.setMode("lobby"); }
    route();
    lobby?.update(room);
    world.setLobby(room.players, selfId);
  } else if (room.phase === "starting") {
    route();
    world.setLobby(room.players, selfId);
  } else route();
  syncMode();
}

/* ---------- countdown tick ---------- */
setInterval(() => {
  if (!countdownEl || !room?.countdownEndsAt) return;
  const left = Math.max(0, Math.ceil((room.countdownEndsAt - Date.now()) / 1000));
  (countdownEl.querySelector(".big") as HTMLElement).textContent = String(left);
  if (left !== lastCount) { lastCount = left; audio.tick(left <= 3); }
}, 100);

/* ---------- boot ---------- */
/** If the host set SITE_PASSPHRASE, ask for it before any socket opens. */
async function ensureUnlocked() {
  if (import.meta.env.DEV) return;
  let state = { required: false, unlocked: true };
  try { state = await (await fetch("/api/gate", { credentials: "same-origin" })).json(); } catch { return; }
  if (!state.required || state.unlocked) return;
  await new Promise<void>((done) => {
    const err = h("p", { class: "error", role: "alert" });
    const input = h("input", { type: "password", placeholder: "Passphrase", autocomplete: "current-password", "aria-label": "Passphrase" }) as HTMLInputElement;
    const go = async () => {
      const r = await fetch("/api/gate", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ passphrase: input.value }) });
      if (r.ok) { card.remove(); done(); } else err.textContent = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Try again.";
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") void go(); });
    const card = h("div", { class: "overlay" }, h("div", { class: "paper menu", role: "dialog", "aria-label": "Passphrase" }, h("h2", null, "Private game"), h("p", { class: "muted" }, "Ask the host for the passphrase."), input, err, h("button", { class: "btn primary", onclick: () => void go() }, "Enter")));
    app.append(card);
    input.focus();
  });
}
void ensureUnlocked().then(() => {
  if (session) { screen = "resuming"; net.open(); setTimeout(() => { if (screen === "resuming") { localStorage.removeItem(SESSION); session = null; route(); } }, 8000); }
  else route();
});
void fmtTime;
(window as unknown as { __ashen: unknown }).__ashen = { world, controls, get game() { return game; }, get room() { return room; } };
