import type { Hearth } from "./index.js";

export type ItemId = "dagger" | "spear" | "bow" | "arrows" | "axe" | "crossbow" | "bandage" | "splint" | "healthKit" | "waterBottle" | "ration" | "backpack" | "flareGun" | "torch" | "snare";
export interface InventoryStack { item: ItemId; count: number }
export interface GamePlayer {
  id: string; name: string; hearth: Hearth; look: string; connected: boolean;
  x: number; z: number; yaw: number; vx: number; vz: number;
  patronPoints: number; health: number; hunger: number; thirst: number; stamina: number;
  alive: boolean; escaped: boolean; inventory: InventoryStack[];
  allianceId: string | null; bleeding: number; brokenLeg: boolean;
  /** Set while a 2 second loot channel is running; any damage interrupts it. */
  looting?: { dropId: string; endsAt: number } | null;
}
export interface LootDrop { id: string; item: ItemId; count: number; x: number; z: number }
export interface Trap { id: string; ownerId: string; x: number; z: number }
export interface GameState {
  phase: "countdown" | "playing" | "flare" | "helicopter" | "ended";
  startedAt: number; endsAt: number; players: GamePlayer[];
  loot: LootDrop[]; traps: Trap[]; allianceInvites: { fromId: string; toId: string }[]; zone: { safeRadius: number; warningZone: number | null; collapseAt: number | null; collapsed: number[]; /** When each entry of `collapsed` fell. */ collapsedAt?: number[]; nextCollapseAt: number };
  flare: { x: number; z: number; shooterId: string; helicopterAt: number } | null;
  helicopter: { x: number; z: number; leavesAt: number } | null;
  winnerId: string | null; message: string;
  /** Recent announcements, newest last. `message` mirrors the latest Herald line. */
  feed?: FeedEntry[];
}
export interface FeedEntry { id: number; at: number; kind: "herald" | "emote" | "gift" | "chat"; text: string; actorId?: string }
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
 | { type: "swap"; a: number; b: number }
 | { type: "emote"; text: string }
 | { type: "spectator-gift"; targetId: string; item: "ration" | "waterBottle" | "bandage" }
 | { type: "spectator-chat"; text: string };


export interface WorldObstacle { x:number; z:number; radius:number; kind:"tree"|"rock"|"stump"; /** Wedge/biome index 0..5: marsh, cinder, pine, salt, frost, orchard. */ biome:number }

/** Wedge index (0..5) for a server-space point; wedge i is centred on angle i*60deg. */
export const biomeAt=(x:number,z:number):number=>Math.floor((((Math.atan2(z,x)+Math.PI/6)%(Math.PI*2))+Math.PI*2)%(Math.PI*2)/(Math.PI/3))%6;

/**
 * Deterministic arena collision layout shared by the server and renderer.
 * Biome-weighted density; keeps the spawn plaza (radius 23) and Base Camp clear and leaves walkable gaps between props.
 */
export const WORLD_OBSTACLES: WorldObstacle[] = (()=>{
  let seed=0x5eed1e5;
  const rnd=()=>{seed=(seed+0x6d2b79f5)>>>0;let t=seed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
  // density, then the share of tree / rock / stump
  const mix:[number,number,number,number][]=[[.55,.18,.37,.45],[.8,.28,.52,.2],[1,.72,.12,.16],[.6,.3,.45,.25],[.75,.3,.5,.2],[.85,.45,.15,.4]];
  const radius={tree:1.25,rock:.95,stump:.72};
  const out:WorldObstacle[]=[];
  for(let attempt=0;attempt<14000&&out.length<260;attempt++){
    const r=Math.sqrt(rnd())*38.5,a=rnd()*Math.PI*2,x=Math.cos(a)*r,z=Math.sin(a)*r;
    if(r<9.6||Math.abs(r-23)<2.9)continue;
    const biome=biomeAt(x,z),[density,t,k]=mix[biome]!;
    if(rnd()>density*.95)continue;
    const roll=rnd(),kind:WorldObstacle["kind"]=roll<t?"tree":roll<t+k?"rock":"stump";
    // keep a 1.9 wide walkable gap between any two props (player body is 1.24 wide)
    if(out.some(o=>Math.hypot(o.x-x,o.z-z)<o.radius+radius[kind]+1.9))continue;
    out.push({x,z,radius:radius[kind],kind,biome});
  }
  return out;
})();
