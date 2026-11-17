import type { GamePlayer, GameState, ClientMessage } from "@ashen-crown/shared";
import type { AudioEngine } from "../audio";
import { EMOTES, HEARTH_INFO, ITEMS, SPECTATOR_CHEERS, itemName } from "../content";
import { PROFILES, type QualityController } from "../render/quality";
import { crestSvg } from "./crest";
import { h } from "./dom";
import { itemIcon } from "./studio";

export interface MenuCtx { send(m: ClientMessage): void; audio: AudioEngine; quality: QualityController; leave(): void }

/** Closeable overlay. Click the backdrop or press Escape to dismiss. */
function overlay(parent: HTMLElement, body: HTMLElement, onClose: () => void) {
  const o = h("div", { class: "overlay", onclick: (e: Event) => { if (e.target === o) onClose(); } }, body);
  parent.append(o);
  return o;
}

export function openInventory(parent: HTMLElement, ctx: MenuCtx, getMe: () => GamePlayer | undefined, selected: { slot: number }, onClose: () => void) {
  const grid = h("div", { class: "grid" });
  const detail = h("div", { class: "detail" });
  const body = h("div", { class: "paper inv", role: "dialog", "aria-label": "Pack" }, h("div", null, h("h2", null, "Pack"), grid), detail);
  const o = overlay(parent, body, onClose);
  let drag: { from: number; ghost: HTMLElement } | null = null;

  const render = () => {
    const me = getMe();
    if (!me) return;
    const cap = me.inventory.some((s) => s.item === "backpack") ? 12 : 8;
    grid.replaceChildren(...Array.from({ length: cap }, (_, i) => {
      const s = me.inventory[i];
      const b = h("button", { class: `slot ${s ? "" : "empty"} ${selected.slot === i ? "sel" : ""}`, "data-i": i, "aria-label": s ? `${itemName(s.item)} ${s.count}` : "Empty slot", onclick: () => { selected.slot = i; ctx.audio.click(); render(); } },
        h("span", { class: "key" }, i < 8 ? i + 1 : ""), s ? h("img", { src: itemIcon(s.item), alt: "" }) : null, s && s.count > 1 ? h("span", { class: "cnt" }, s.count) : null);
      if (s) b.addEventListener("pointerdown", (e) => startDrag(e, i, s.item));
      return b;
    }));
    const s = me.inventory[selected.slot];
    if (!s) { detail.replaceChildren(h("h3", null, "Empty slot"), h("p", { class: "muted" }, "Pick things up with E. Drag items to rearrange them, or drag out of the pack to drop.")); return; }
    const info = ITEMS[s.item];
    detail.replaceChildren(h("img", { src: itemIcon(s.item), alt: "" }), h("h2", null, info.name), h("small", { class: "muted" }, `${info.type} · stack ${info.stackLimit}`), h("p", null, info.desc),
      h("button", { class: "btn primary small", onclick: () => ctx.send({ type: "game-action", action: { type: "use", slot: selected.slot } }) }, "Use"),
      s.item === "dagger" ? h("small", { class: "muted" }, "The dagger can't be dropped.") : h("button", { class: "btn small", onclick: () => ctx.send({ type: "game-action", action: { type: "drop", slot: selected.slot } }) }, "Drop"));
  };

  const startDrag = (e: PointerEvent, from: number, item: Parameters<typeof itemIcon>[0]) => {
    const ghost = h("img", { class: "ghost-drag", src: itemIcon(item), alt: "" });
    let moved = false;
    const move = (ev: PointerEvent) => { moved = true; if (!ghost.isConnected) document.body.append(ghost); ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`; };
    const up = (ev: PointerEvent) => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      ghost.remove();
      if (!moved) return;
      const target = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>(".inv .slot");
      if (target) { const to = Number(target.dataset.i); if (to !== from) ctx.send({ type: "game-action", action: { type: "swap", a: from, b: to } }); }
      else if (!(document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest(".inv")) ctx.send({ type: "game-action", action: { type: "drop", slot: from } });
    };
    drag = { from, ghost };
    void drag;
    addEventListener("pointermove", move); addEventListener("pointerup", up);
    void e;
  };
  render();
  return { el: o, render, close: () => o.remove() };
}

export function openEmoteWheel(parent: HTMLElement, ctx: MenuCtx, spectator: boolean, onPick: (text: string) => void) {
  const items = spectator ? SPECTATOR_CHEERS : EMOTES;
  const el = h("div", { class: "wheel", role: "menu" }, h("div", { class: "hub" }, spectator ? "Cheer" : "Signal"));
  items.forEach((t, i) => {
    const a = (i / items.length) * Math.PI * 2 - Math.PI / 2;
    const b = h("button", { role: "menuitem", style: { left: `${50 + Math.cos(a) * 38}%`, top: `${50 + Math.sin(a) * 38}%` }, onclick: () => { onPick(t); } }, t);
    b.dataset.i = String(i);
    el.append(b);
  });
  parent.append(el);
  const hover = (e: PointerEvent) => {
    const r = el.getBoundingClientRect(), a = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    const i = Math.round((((a + Math.PI / 2) / (Math.PI * 2)) * items.length + items.length) % items.length) % items.length;
    el.querySelectorAll("button").forEach((b, k) => b.classList.toggle("hot", k === i));
  };
  addEventListener("pointermove", hover);
  void ctx;
  return {
    pick() { const hot = el.querySelector<HTMLElement>("button.hot"); if (hot) onPick(items[Number(hot.dataset.i)]!); },
    close() { removeEventListener("pointermove", hover); el.remove(); },
  };
}

export function openMenu(parent: HTMLElement, ctx: MenuCtx, onClose: () => void, helpOnly = false) {
  const a = ctx.audio;
  const slider = (k: "master" | "music" | "sfx", label: string) => h("div", { class: "row" }, h("span", null, label), h("input", { type: "range", min: 0, max: 1, step: 0.05, value: a.settings[k], "aria-label": label, oninput: (e: Event) => a.set({ [k]: Number((e.target as HTMLInputElement).value) }) }));
  const q = ctx.quality;
  const qBtns = ["auto", ...PROFILES.map((_, i) => i)].map((v) => h("button", { "aria-pressed": String(v === "auto" ? q.auto : !q.auto && q.tier === v), onclick: () => { q.set(v as "auto" | number); close(); openMenu(parent, ctx, onClose); } }, v === "auto" ? "Auto" : PROFILES[v as number]!.name));
  const keys: [string, string][] = [["WASD / stick", "Move"], ["Shift", "Run"], ["Space", "Dodge"], ["Q (hold)", "Block"], ["F", "Strike nearest rival"], ["E", "Take loot"], ["R", "Offer a pact"], ["Y / N", "Accept / decline pact"], ["X", "Fire flare / board helicopter"], ["1–8", "Use hotbar item"], ["Tab", "Pack"], ["C (hold)", "Signals"], ["V (hold)", "Push to talk"], ["Drag / wheel", "Orbit and zoom"]];
  const body = h("div", { class: "paper menu", role: "dialog", "aria-label": "Menu" },
    h("h2", null, helpOnly ? "How to survive" : "Menu"),
    helpOnly ? null : h("div", null, h("h3", null, "Sound"), slider("master", "Master"), slider("music", "Music"), slider("sfx", "Effects"),
      h("div", { class: "row" }, h("span", null, "Mute"), h("div", { class: "toggle" }, h("button", { role: "switch", "aria-checked": String(a.settings.muted), "aria-label": "Mute", onclick: (e: Event) => { const b = e.currentTarget as HTMLElement; const m = !a.settings.muted; a.set({ muted: m }); b.setAttribute("aria-checked", String(m)); } }))),
      h("h3", null, "Graphics"), h("div", { class: "seg" }, ...qBtns), h("p", { class: "muted" }, q.auto ? `Adapting automatically. Now: ${q.profile.name}.` : `Fixed at ${q.profile.name}.`)),
    h("h3", null, "Controls"), h("div", { class: "keys keys-help" }, ...keys.flatMap(([k, v]) => [h("span", { class: "kbd" }, k), h("span", null, v)])),
    h("p", { class: "muted" }, "Stay out of collapsing zones, loot Base Camp at your own risk, and only two seats fly out."),
    helpOnly ? null : h("div", { style: { display: "flex", gap: ".6rem" } }, h("button", { class: "btn primary", onclick: () => { close(); onClose(); } }, "Resume"), h("button", { class: "btn", onclick: () => { close(); ctx.leave(); } }, "Leave match")),
    helpOnly ? h("button", { class: "btn primary", onclick: () => { close(); onClose(); } }, "Got it") : null);
  const o = overlay(parent, body, () => { close(); onClose(); });
  const close = () => o.remove();
  return { close };
}

export function showResult(parent: HTMLElement, g: GameState, selfId: string, isHost: boolean, ctx: { playAgain(): void; leave(): void }) {
  const winner = g.players.find((p) => p.id === g.winnerId);
  const me = g.players.find((p) => p.id === selfId);
  const escaped = g.players.filter((p) => p.escaped);
  const won = !!winner && winner.id === selfId;
  const survived = !!me && (me.escaped || (me.alive && won));
  const info = winner ? HEARTH_INFO[winner.hearth] : null;
  const cr = info ? crestSvg(info.crest) : null;
  cr?.style.setProperty("--c", info!.color);
  const body = h("div", { class: "paper result", role: "dialog", "aria-label": "Match result" },
    cr,
    h("h2", null, won ? "The Crown is yours" : survived ? "You escaped" : winner ? "The Winnowing is over" : "No one survived"),
    h("p", null, winner ? `${winner.name} of ${info!.name} ${g.phase === "ended" && escaped.length ? "leaves the Quillwood." : "survives the Quillwood."}` : "The Quillwood keeps its dead."),
    escaped.length ? h("p", { class: "muted" }, `Escaped by helicopter: ${escaped.map((p) => p.name).join(" and ")}.`) : null,
    h("div", { style: { display: "flex", gap: ".6rem", justifyContent: "center", marginTop: ".8rem" } },
      isHost ? h("button", { class: "btn primary", onclick: ctx.playAgain }, "Play again") : h("p", { class: "muted" }, "Waiting for the host to play again."),
      h("button", { class: "btn", onclick: ctx.leave }, "Leave")));
  const o = h("div", { class: "overlay" }, body);
  parent.append(o);
  return o;
}
