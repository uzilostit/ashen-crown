import type { FigureLook, Hearth, ItemId } from "@ashen-crown/shared";
import itemData from "../../config/items.json";
import lore from "../../config/lore.json";

export type Crest = "reed" | "flame" | "pine" | "sun" | "shard" | "fruit";

export interface HearthInfo { name: string; color: string; accent: string; crest: Crest; motto: string; zone: string; tone: string }
const crestOf: Record<string, Crest> = { reeds: "reed", ember: "flame", fir: "pine", "sun disk": "sun", shard: "shard", "fallen fruit": "fruit" };
const extra: Record<Hearth, { name: string; accent: string; motto: string; zone: string }> = {
  marsh: { name: "Marshlight", accent: "#d9c45a", motto: "Follow the small light.", zone: "Marsh" },
  cinder: { name: "Cindermere", accent: "#f2b24a", motto: "We keep what burns.", zone: "Cinder Flats" },
  pine: { name: "Pinewatch", accent: "#dcc27a", motto: "Stand and be quiet.", zone: "Pine Forest" },
  salt: { name: "Saltreach", accent: "#4a6f8c", motto: "Patience is a tide.", zone: "Salt Dunes" },
  frost: { name: "Frostholm", accent: "#3f607d", motto: "Cold clears the mind.", zone: "Frost Ridge" },
  orchard: { name: "Rosehollow", accent: "#f0d98c", motto: "Bloom where you land.", zone: "Orchard Ruins" },
};
export const HEARTH_INFO = Object.fromEntries(
  (Object.keys(extra) as Hearth[]).map((h) => {
    const l = (lore.hearths as Record<string, { color: string; crest: string; announcerTone: string }>)[h]!;
    return [h, { ...extra[h], color: l.color, crest: crestOf[l.crest] ?? "flame", tone: l.announcerTone }];
  }),
) as Record<Hearth, HearthInfo>;

export const LOOKS: { id: FigureLook; name: string; blurb: string }[] = [
  { id: "scout", name: "Scout", blurb: "Scarf, satchel and a short cut. Light on its feet." },
  { id: "warden", name: "Warden", blurb: "Hooded cape and steel shoulders. Hard to ignore." },
  { id: "ranger", name: "Ranger", blurb: "Green hood and a quiver of folded arrows." },
  { id: "duelist", name: "Duelist", blurb: "Plume, sash and polished belt. Made for the cameras." },
];

export interface ItemInfo { type: string; stackLimit: number; name: string; desc: string; droppable?: boolean }
export const ITEMS = itemData as unknown as Record<ItemId, ItemInfo>;
export const itemName = (id: ItemId) => ITEMS[id]?.name ?? id;

const SKINS = ["#f0d3b0", "#e2b88f", "#c99468", "#a8734a", "#7d5236", "#5a3a28"];
export const skinFor = (key: string) => {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SKINS[h % SKINS.length]!;
};

export const EMOTES = ["Enemy spotted", "Need supplies", "Come here", "Danger", "I'm moving"];
export const SPECTATOR_CHEERS = ["Good luck, Kindled", "The Council sees all", "Keep moving"];
export const TITLE = lore.title;
