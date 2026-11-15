import type { Hearth } from "./index.js";

export type ItemId = "dagger" | "spear" | "bow" | "arrows" | "axe" | "crossbow" | "bandage" | "splint" | "healthKit" | "waterBottle" | "ration" | "backpack" | "flareGun" | "torch" | "snare";
export interface InventoryStack { item: ItemId; count: number }
export interface GamePlayer {
  id: string; name: string; hearth: Hearth; look: string; connected: boolean;
  x: number; z: number; yaw: number; vx: number; vz: number;
  patronPoints: number; health: number; hunger: number; thirst: number; stamina: number;
  alive: boolean; escaped: boolean; inventory: InventoryStack[];
  allianceId: string | null; bleeding: number; brokenLeg: boolean;
}
export interface LootDrop { id: string; item: ItemId; count: number; x: number; z: number }
export interface Trap { id: string; ownerId: string; x: number; z: number }
export interface GameState {
  phase: "countdown" | "playing" | "flare" | "helicopter" | "ended";
  startedAt: number; endsAt: number; players: GamePlayer[];
  loot: LootDrop[]; traps: Trap[]; allianceInvites: { fromId: string; toId: string }[]; zone: { safeRadius: number; warningZone: number | null; collapseAt: number | null; collapsed: number[]; nextCollapseAt: number };
  flare: { x: number; z: number; shooterId: string; helicopterAt: number } | null;
  helicopter: { x: number; z: number; leavesAt: number } | null;
  winnerId: string | null; message: string;
}
export type GameInput = { x: number; z: number; yaw: number; sprint: boolean; block: boolean; dodge: boolean };
export type GameAction =
 | { type: "attack"; targetId: string }
 | { type: "loot"; dropId: string }
 | { type: "use"; slot: number }
 | { type: "drop"; slot: number }
 | { type: "flare" }
 | { type: "ally-invite"; targetId: string }
 | { type: "ally-respond"; fromId: string; accept: boolean }
 | { type: "leave-alliance" }
 | { type: "board-helicopter" }
 | { type: "emote"; text: string }
 | { type: "spectator-gift"; targetId: string; item: "ration" | "waterBottle" | "bandage" }
 | { type: "spectator-chat"; text: string };

\nexport interface WorldObstacle { x:number; z:number; radius:number; kind:"tree"|"rock"|"stump" }\n
// Deterministic arena collision layout shared by the server and renderer.
export const WORLD_OBSTACLES: WorldObstacle[] = Array.from({length:92},(_,i)=>{
  const angle=i*2.399963229728653;
  const radius=9+((i*37)%290)/10;
  const kind:WorldObstacle["kind"]=i%5===0?"rock":i%7===0?"stump":"tree";
  return {x:Math.cos(angle)*radius,z:Math.sin(angle)*radius,radius:kind==="tree"?1.25:kind==="rock"?.95:.72,kind};
}).filter(o=>Math.hypot(o.x,o.z)<39);
