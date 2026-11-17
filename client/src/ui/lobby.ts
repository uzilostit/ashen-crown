import type { ClientMessage, RoomSettings, RoomView } from "@ashen-crown/shared";
import { HEARTH_INFO } from "../content";
import { crestSvg } from "./crest";
import { h } from "./dom";

export interface LobbyCtx {
  send(m: ClientMessage): void;
  selfId(): string;
  copy(text: string, what: string): void;
  leave(): void;
  edit(): void;
  sfx(): void;
}

const LENGTHS = [20, 30, 45];
const SPEEDS: RoomSettings["collapseSpeed"][] = ["slow", "standard", "fast"];

export function mountLobby(parent: HTMLElement, ctx: LobbyCtx) {
  const root = h("main", { class: "screen lobby" });
  parent.append(root);

  function update(room: RoomView) {
    const me = room.players.find((p) => p.id === ctx.selfId());
    const host = !!me?.isHost;
    const connected = room.players.filter((p) => p.connected);
    const ready = connected.filter((p) => p.ready).length;
    const invite = `${location.origin}${location.pathname}?room=${room.code}`;

    const seg = <T extends string | number>(value: T, opts: T[], label: (v: T) => string, set: (v: T) => void) =>
      h("div", { class: "seg" }, ...opts.map((o) => h("button", { "aria-pressed": String(o === value), disabled: !host, onclick: () => { ctx.sfx(); set(o); } }, label(o))));
    const change = (patch: Partial<RoomSettings>) => ctx.send({ type: "set-settings", settings: { ...room.settings, ...patch } });

    const cards = room.players.map((p) => {
      const info = HEARTH_INFO[p.hearth];
      const c = h("li", { class: `pcard ${p.id === me?.id ? "me" : ""} ${p.connected ? "" : "off"}` },
        crestSvg(info.crest),
        h("div", null, h("b", null, p.name), h("small", null, `${info.name} · ${p.look}`)),
        h("div", { style: { display: "flex", gap: ".35rem", alignItems: "center" } },
          p.isHost ? h("span", { class: "badge host" }, "Host") : null,
          h("span", { class: `badge ${!p.connected ? "wait" : p.ready ? "ready" : "wait"}` }, !p.connected ? "Away" : p.ready ? "Ready" : "Not ready"),
          host && !p.isHost ? h("button", { class: "btn small", "aria-label": `Remove ${p.name}`, onclick: () => ctx.send({ type: "kick-player", playerId: p.id }) }, "Kick") : null));
      (c.querySelector(".crest") as SVGElement).style.setProperty("--c", info.color);
      return c;
    });

    const canStart = ready >= room.minPlayers;
    const action = host
      ? [h("button", { class: "btn primary", disabled: !canStart, onclick: () => ctx.send({ type: "start-match" }) }, "Start the Winnowing"),
         h("button", { class: "btn", onclick: () => ctx.send({ type: "set-ready", ready: !me?.ready }) }, me?.ready ? "Not ready" : "I'm ready")]
      : [h("button", { class: "btn primary", onclick: () => ctx.send({ type: "set-ready", ready: !me?.ready }) }, me?.ready ? "Not ready" : "I'm ready")];
    const reason = host ? (canStart ? "Everyone ready? Begin when you like." : `Need ${room.minPlayers} ready players to start (${ready} ready).`) : "Waiting for the host to begin.";

    root.replaceChildren(
      h("div", { class: "top" },
        h("div", { class: "paper codebox" }, h("div", null, h("div", { class: "lbl" }, "Room"), h("div", { class: "lbl" }, "code")), h("div", { class: "code", "aria-label": `Room code ${room.code.split("").join(" ")}` }, ...room.code.split("").map((c) => h("i", null, c))),
          h("button", { class: "btn small", onclick: () => ctx.copy(invite, "Invite link") }, "Copy invite"), h("button", { class: "btn small", onclick: () => ctx.copy(room.code, "Code") }, "Copy code")),
        h("div", { style: { display: "flex", gap: ".5rem" } }, h("button", { class: "btn ghost", onclick: () => ctx.edit() }, "Change look"), h("button", { class: "btn ghost", onclick: () => ctx.leave() }, "Leave"))),
      h("section", { class: "paper roster" }, h("h2", null, `Kindled ${connected.length}/${room.maxPlayers}`), h("ul", null, ...cards)),
      h("div", { class: "mid" }, h("div", { class: "paper dark cast" }, "The cameras are rolling. Share the code to fill the arena.")),
      h("section", { class: "paper side" },
        h("h2", null, "Rules of the hunt"),
        h("div", { class: "field" }, h("span", { class: "lbl" }, "Match length"), seg(room.settings.matchLengthMinutes, LENGTHS, (v) => `${v} min`, (v) => change({ matchLengthMinutes: v }))),
        h("div", { class: "field" }, h("span", { class: "lbl" }, "Collapse speed"), seg(room.settings.collapseSpeed, SPEEDS, (v) => v, (v) => change({ collapseSpeed: v }))),
        h("div", { class: "field" }, h("div", { class: "toggle" }, h("button", { role: "switch", "aria-checked": String(room.settings.friendlyFire), "aria-label": "Betrayal allowed", disabled: !host, onclick: () => { ctx.sfx(); change({ friendlyFire: !room.settings.friendlyFire }); } }), h("span", null, "Betrayal allowed")), h("small", { class: "muted" }, "Allies may attack each other. The Herald announces every betrayal.")),
        !host ? h("p", { class: "muted" }, "Only the host can change the rules.") : null,
        h("div", { class: "actions" }, ...action, h("p", { class: "reason" }, reason))));
  }
  return { update, destroy() { root.remove(); } };
}
