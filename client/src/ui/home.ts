import { HEARTHS, ROOM_CODE_ALPHABET, type FigureLook, type Hearth } from "@ashen-crown/shared";
import { HEARTH_INFO, LOOKS, TITLE } from "../content";
import { crestSvg } from "./crest";
import { h } from "./dom";
import { getStudio } from "./studio";

export interface Identity { name: string; hearth: Hearth; look: FigureLook }
export interface HomeCtx {
  identity: Identity;
  prefillCode: string;
  save(i: Identity): void;
  create(i: Identity): void;
  join(code: string, i: Identity): void;
  sfx(kind: "click"): void;
}

/** Character creator and the two doors: create a room, or join one with a code. */
export function mountHome(parent: HTMLElement, ctx: HomeCtx) {
  const id = { ...ctx.identity };
  const err = h("p", { class: "error", role: "alert" });
  const motto = h("p", { class: "motto" });
  const lookNote = h("p", { class: "motto" });
  const name = h("input", { type: "text", maxlength: 18, placeholder: "Your name", autocomplete: "nickname", "aria-label": "Your name", value: id.name }) as HTMLInputElement;
  const avatar = h("canvas", { class: "avatar", width: 340, height: 500, "aria-hidden": "true" }) as HTMLCanvasElement;
  const code = h("input", { type: "text", class: "code-in", maxlength: 7, placeholder: "ABC234", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", "aria-label": "Room code", value: ctx.prefillCode }) as HTMLInputElement;

  const hearthBtns = HEARTHS.map((hh) => {
    const info = HEARTH_INFO[hh];
    const b = h("button", { class: "hearth-chip", role: "radio", style: { "--c": info.color } as unknown as Record<string, string>, onclick: () => { id.hearth = hh; ctx.sfx("click"); sync(); } }, crestSvg(info.crest), info.name);
    b.style.setProperty("--c", info.color);
    return [hh, b] as const;
  });
  const lookBtns = LOOKS.map((l) => [l.id, h("button", { class: "look-chip", role: "radio", onclick: () => { id.look = l.id; ctx.sfx("click"); sync(); } }, h("b", null, l.name))] as const);

  const sync = () => {
    for (const [k, b] of hearthBtns) b.setAttribute("aria-checked", String(k === id.hearth));
    for (const [k, b] of lookBtns) b.setAttribute("aria-checked", String(k === id.look));
    motto.textContent = `“${HEARTH_INFO[id.hearth].motto}”`;
    lookNote.textContent = LOOKS.find((l) => l.id === id.look)?.blurb ?? "";
  };
  sync();

  const read = (): Identity | null => {
    const n = name.value.trim().replace(/\s+/g, " ");
    if (!n) { err.textContent = "Enter a name first."; name.focus(); return null; }
    id.name = n;
    ctx.save({ ...id });
    return { ...id };
  };
  const cleanCode = () => code.value.toUpperCase().replace(new RegExp(`[^${ROOM_CODE_ALPHABET}]`, "g"), "");
  const create = h("button", { class: "btn primary", onclick: () => { const i = read(); if (i) { err.textContent = ""; ctx.create(i); } } }, "Create room");
  const joinBtn = h("button", { class: "btn", onclick: () => { const c = cleanCode(); if (c.length !== 6) { err.textContent = "Room codes have six characters."; code.focus(); return; } const i = read(); if (i) { err.textContent = ""; ctx.join(c, i); } } }, "Join");
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") joinBtn.click(); });
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") (cleanCode().length === 6 ? joinBtn : create).click(); });
  if (ctx.prefillCode) { joinBtn.classList.add("primary"); create.classList.remove("primary"); }

  const el = h("main", { class: "screen home" },
    h("header", { class: "hero" }, h("h1", { class: "title", "aria-label": TITLE }, h("span", null, "Ashen "), h("span", null, "Crown")), h("p", { class: "tagline" }, "The Regent Council invites you to the Winnowing.")),
    h("section", { class: "paper identity" },
      h("div", null,
        h("div", { class: "field" }, h("label", null, "Name"), name),
        h("div", { class: "field" }, h("span", { class: "lbl" }, "Hearth"), h("div", { class: "hearths", role: "radiogroup", "aria-label": "Hearth" }, ...hearthBtns.map(([, b]) => b)), motto),
        h("div", { class: "field" }, h("span", { class: "lbl" }, "Paper figure"), h("div", { class: "looks", role: "radiogroup", "aria-label": "Paper figure" }, ...lookBtns.map(([, b]) => b)), lookNote)),
      avatar),
    h("section", { class: "doors" },
      h("div", { class: "paper door" }, h("h2", null, "Host a game"), h("p", { class: "muted" }, "Get a code and an invite link for your friends."), create),
      h("div", { class: "paper door" }, h("h2", null, "Have a code?"), code, joinBtn)),
    err,
    h("p", { class: "foot-note" }, "Private rooms for 2 to 15 players. Headphones recommended."));
  parent.append(el);

  let raf = 0;
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    if (avatar.offsetParent) getStudio().avatar(avatar, id.hearth, id.look, t / 1000, "me");
  };
  raf = requestAnimationFrame(loop);
  if (ctx.prefillCode) code.focus();
  return { destroy() { cancelAnimationFrame(raf); el.remove(); }, error(m: string) { err.textContent = m; } };
}
