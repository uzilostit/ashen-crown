import type { Hearth } from "./index.js";

export type ItemId = "dagger" | "spear" | "bow" | "arrows" | "axe" | "crossbow" | "bandage" | "healthKit" | "waterBottle" | "ration" | "backpack" | "flareGun" | "torch" | "snare";
export interface InventoryStack { item: ItemId; count: number }
export interface GamePlayer {
  id: string; name: string; hearth: Hearth; look: string;
  x: number; z: number; yaw: number;
  health: number; hunger: number; thirst: number; stamina: number;
  alive: boolean; escaped: boolean; inventory: InventoryStack[];
  allianceId: string | null; bleeding: number; brokenLeg: boolean;
}
export interface LootDrop { id: string; item: ItemId; count: number; x: number; z: number }
export interface GameState {
  phase: "countdown" | "playing" | "flare" | "helicopter" | "ended";
  startedAt: number; endsAt: number; players: GamePlayer[];
  loot: LootDrop[]; zone: { safeRadius: number; warningZone: number | null; collapseAt: number | null; collapsed: number[]; nextCollapseAt: number };
  flare: { x: number; z: number; shooterId: string; helicopterAt: number } | null;
  helicopter: { x: number; z: number; leavesAt: number } | null;
  winnerId: string | null; message: string;
}
export type GameInput = { x: number; z: number; yaw: number; sprint: boolean };
export type GameAction =
 | { type: "attack"; targetId: string }
 | { type: "loot"; dropId: string }
 | { type: "use"; slot: number }
 | { type: "drop"; slot: number }
 | { type: "flare" }
 | { type: "ally-invite"; targetId: string }
 | { type: "ally-respond"; fromId: string; accept: boolean }
 | { type: "leave-alliance" };
